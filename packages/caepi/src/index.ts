import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { setTimeout as sleep } from "node:timers/promises";
import { crc32, createInflateRaw } from "node:zlib";
import AdmZip from "adm-zip";
import { Client as FtpClient } from "basic-ftp";
import { canonicalJson, normalizeCaNumber, onlyDigits } from "@preventbase/contracts";
import type { Prisma, PrismaClient } from "@preventbase/database";

export interface CaepiRecord {
  caNumber: string;
  validUntil: Date | null;
  situation: string | null;
  processNumber: string | null;
  manufacturerCnpj: string | null;
  manufacturerName: string | null;
  nature: string | null;
  equipmentName: string | null;
  equipmentDescription: string | null;
  brand: string | null;
  reference: string | null;
  color: string | null;
  approvedFor: string | null;
  restrictions: string | null;
  observations: string | null;
  labCnpj: string | null;
  labName: string | null;
  reportNumber: string | null;
  standard: string | null;
}

type Field = keyof CaepiRecord;

/** Arquivo não é uma base CAEPI íntegra; a base local não é alterada. */
export class CaepiFileError extends Error {
  override name = "CaepiFileError";
}

/** Já existe sincronização em andamento. */
export class CaepiBusyError extends Error {
  override name = "CaepiBusyError";
}

/** Ordem oficial do tgg_export_caepi.txt (usada se o cabeçalho não for reconhecido). */
const POSITIONAL: Field[] = [
  "caNumber",
  "validUntil",
  "situation",
  "processNumber",
  "manufacturerCnpj",
  "manufacturerName",
  "nature",
  "equipmentName",
  "equipmentDescription",
  "brand",
  "reference",
  "color",
  "approvedFor",
  "restrictions",
  "observations",
  "labCnpj",
  "labName",
  "reportNumber",
  "standard",
];

const HEADER_ALIASES: Record<string, Field> = {
  nrregistroca: "caNumber",
  ca: "caNumber",
  datavalidade: "validUntil",
  datadevalidade: "validUntil",
  situacao: "situation",
  nrprocesso: "processNumber",
  nrdoprocesso: "processNumber",
  cnpj: "manufacturerCnpj",
  razaosocial: "manufacturerName",
  natureza: "nature",
  nomeequipamento: "equipmentName",
  equipamento: "equipmentName",
  descricaoequipamento: "equipmentDescription",
  marcaca: "brand",
  referencia: "reference",
  cor: "color",
  aprovadoparalaudo: "approvedFor",
  restricaolaudo: "restrictions",
  observacaoanaliselaudo: "observations",
  cnpjlaboratorio: "labCnpj",
  razaosociallaboratorio: "labName",
  nrlaudo: "reportNumber",
  norma: "standard",
};

const MERGE_FIELDS: Field[] = ["approvedFor", "restrictions", "observations", "labCnpj", "labName", "reportNumber", "standard"];

/** Acima disso o arquivo é tratado como corrompido (ex.: cauda truncada/repetida no FTP do MTE). */
const MAX_REJECTED_RATIO = 0.01;
/** Base nova com menos da metade dos CAs já conhecidos é tratada como arquivo incompleto. */
const MIN_RECORDS_RATIO = 0.5;
const STALE_SYNC_MS = 30 * 60_000;

function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseBrDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

/** Cópia própria: substrings do V8 referenciam a string-mãe e manteriam vivo cada bloco lido do arquivo. */
function detach(s: string): string {
  return Buffer.from(s, "utf8").toString("utf8");
}

function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.replace(/\s+/g, " ").trim();
  return v === "" ? null : detach(v);
}

/** Separa por `|`; campo iniciado por aspas pode conter `|` e termina em `"|` ou `"` no fim da linha (`""` = aspas literais). */
export function splitCaepiLine(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let j = i + 1;
      let buf = "";
      for (;;) {
        const k = line.indexOf('"', j);
        if (k < 0) {
          buf += line.slice(j);
          j = n;
          break;
        }
        if (line[k + 1] === '"') {
          buf += line.slice(j, k + 1);
          j = k + 2;
          continue;
        }
        if (k + 1 === n || line[k + 1] === "|") {
          buf += line.slice(j, k);
          j = k + 1;
          break;
        }
        buf += line.slice(j, k + 1);
        j = k + 1;
      }
      out.push(buf);
      if (j >= n) return out;
      i = j + 1;
    } else {
      const k = line.indexOf("|", i);
      if (k < 0) {
        out.push(line.slice(i));
        return out;
      }
      out.push(line.slice(i, k));
      i = k + 1;
    }
  }
}

/** Parser incremental: recebe linha a linha e agrega linhas repetidas do mesmo CA (um laudo por linha). */
export class CaepiParser {
  private columns: Array<Field | undefined> | null = null;
  readonly records = new Map<string, CaepiRecord>();
  lines = 0;
  rejected = 0;

  push(rawLine: string): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") return;
    if (!this.columns) {
      const mapped = splitCaepiLine(line.replace(/^#/, "")).map((h) => HEADER_ALIASES[normHeader(h)]);
      if (mapped.includes("caNumber") && mapped.filter(Boolean).length >= 5) {
        this.columns = mapped;
        return;
      }
      this.columns = POSITIONAL;
    }
    this.lines++;
    const parts = splitCaepiLine(line);
    if (parts.length !== this.columns.length) {
      this.rejected++;
      return;
    }
    const raw: Partial<Record<Field, string | null>> = {};
    this.columns.forEach((field, idx) => {
      if (field) raw[field] = clean(parts[idx]);
    });
    const caNumber = raw.caNumber ? normalizeCaNumber(raw.caNumber) : "";
    if (!caNumber) {
      this.rejected++;
      return;
    }
    const rec: CaepiRecord = {
      caNumber,
      validUntil: raw.validUntil ? parseBrDate(raw.validUntil) : null,
      situation: raw.situation ?? null,
      processNumber: raw.processNumber ?? null,
      manufacturerCnpj: raw.manufacturerCnpj ? onlyDigits(raw.manufacturerCnpj) || null : null,
      manufacturerName: raw.manufacturerName ?? null,
      nature: raw.nature ?? null,
      equipmentName: raw.equipmentName ?? null,
      equipmentDescription: raw.equipmentDescription ?? null,
      brand: raw.brand ?? null,
      reference: raw.reference ?? null,
      color: raw.color ?? null,
      approvedFor: raw.approvedFor ?? null,
      restrictions: raw.restrictions ?? null,
      observations: raw.observations ?? null,
      labCnpj: raw.labCnpj ? onlyDigits(raw.labCnpj) || null : null,
      labName: raw.labName ?? null,
      reportNumber: raw.reportNumber ?? null,
      standard: raw.standard ?? null,
    };
    const existing = this.records.get(caNumber);
    if (!existing) {
      this.records.set(caNumber, rec);
      return;
    }
    for (const f of MERGE_FIELDS) {
      const a = existing[f] as string | null;
      const b = rec[f] as string | null;
      if (b && (!a || !a.split(" | ").includes(b))) (existing[f] as string | null) = a ? `${a} | ${b}` : b;
    }
  }

  assertQuality(): void {
    if (this.records.size === 0) throw new CaepiFileError("Arquivo CAEPI sem registros reconhecidos");
    if (this.rejected > Math.max(20, this.lines * MAX_REJECTED_RATIO)) {
      throw new CaepiFileError(`Arquivo CAEPI corrompido: ${this.rejected} de ${this.lines} linhas malformadas`);
    }
  }
}

export function parseCaepiText(text: string): CaepiRecord[] {
  const parser = new CaepiParser();
  for (const line of text.split("\n")) parser.push(line);
  return [...parser.records.values()];
}

export function recordHash(rec: CaepiRecord): string {
  return createHash("sha256").update(canonicalJson(rec)).digest("hex");
}

type Encoding = "utf-8" | "latin1";

async function* decodeLines(chunks: AsyncIterable<Buffer>, encoding: Encoding): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let rest = "";
  for await (const chunk of chunks) {
    rest += encoding === "utf-8" ? decoder.decode(chunk, { stream: true }) : chunk.toString("latin1");
    const parts = rest.split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (encoding === "utf-8") rest += decoder.decode();
  if (rest) yield rest;
}

function isDecodeError(err: unknown): boolean {
  return err instanceof TypeError && (err as NodeJS.ErrnoException).code === "ERR_ENCODING_INVALID_ENCODED_DATA";
}

/** Fonte de bytes do .txt; para ZIP, valida índice central, tamanho e CRC32 do conteúdo extraído. */
async function openSource(path: string): Promise<() => AsyncIterable<Buffer>> {
  const fh = await open(path, "r");
  const magic = Buffer.alloc(4);
  try {
    await fh.read(magic, 0, 4, 0);
  } finally {
    await fh.close();
  }
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) return () => createReadStream(path, { highWaterMark: 1 << 16 });

  let zip: AdmZip;
  try {
    zip = new AdmZip(await readFile(path));
  } catch (err) {
    throw new CaepiFileError(`ZIP CAEPI corrompido ou incompleto (${err instanceof Error ? err.message : String(err)})`);
  }
  const entry = zip.getEntries().find((e) => /\.(txt|csv)$/i.test(e.entryName));
  if (!entry) throw new CaepiFileError("ZIP CAEPI sem arquivo .txt");
  const { method, size, crc } = entry.header;
  if (method !== 0 && method !== 8) throw new CaepiFileError(`ZIP CAEPI com compressão não suportada (${method})`);
  const compressed = entry.getCompressedData();

  return async function* () {
    let total = 0;
    let sum = 0;
    const stream = method === 0 ? Readable.from([compressed]) : Readable.from([compressed]).pipe(createInflateRaw());
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        total += chunk.length;
        sum = crc32(chunk, sum);
        yield chunk;
      }
    } catch (err) {
      throw new CaepiFileError(`ZIP CAEPI corrompido (${err instanceof Error ? err.message : String(err)})`);
    }
    if (total !== size || sum >>> 0 !== crc >>> 0) {
      throw new CaepiFileError(`ZIP CAEPI corrompido: conteúdo ${total} bytes (esperado ${size}), CRC divergente`);
    }
  };
}

/** Lê e valida o arquivo inteiro (ZIP ou .txt; UTF-8 com fallback latin1) sem carregá-lo em memória. */
export async function parseCaepiFile(path: string): Promise<CaepiParser> {
  const chunks = await openSource(path);
  const run = async (encoding: Encoding) => {
    const parser = new CaepiParser();
    for await (const line of decodeLines(chunks(), encoding)) parser.push(line);
    parser.assertQuality();
    return parser;
  };
  try {
    return await run("utf-8");
  } catch (err) {
    if (isDecodeError(err)) return run("latin1");
    throw err;
  }
}

async function hashFile(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export async function downloadCaepi(url: string, dest: string): Promise<void> {
  let expected: number | null = null;
  if (url.startsWith("ftp://")) {
    const u = new URL(url);
    const remotePath = decodeURIComponent(u.pathname);
    const client = new FtpClient(120_000);
    try {
      await client.access({ host: u.hostname, port: u.port ? Number(u.port) : 21, user: u.username || "anonymous", password: u.password || "anonymous@", secure: false });
      expected = await client.size(remotePath).catch(() => null);
      await client.downloadTo(dest, remotePath);
    } finally {
      client.close();
    }
  } else {
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !res.body) throw new Error(`Download CAEPI falhou: HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length"));
    expected = Number.isFinite(len) && len > 0 ? len : null;
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>), createWriteStream(dest));
  }
  if (expected !== null) {
    const { size } = await stat(dest);
    if (size !== expected) throw new CaepiFileError(`Download CAEPI incompleto: ${size} de ${expected} bytes`);
  }
}

export interface CaepiSyncResult {
  syncId: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

interface SyncMeta {
  source: string;
  triggeredBy?: string;
}

/** Sincronizações por URL só rodam no worker (concorrência 1): no boot, qualquer uma em RUNNING foi interrompida. */
export async function recoverInterruptedCaepiSyncs(prisma: PrismaClient): Promise<number> {
  const res = await prisma.caSync.updateMany({
    where: { status: "RUNNING", NOT: { source: { startsWith: "upload:" } } },
    data: { status: "FAILED", errorMessage: "Interrompida (worker reiniciado)", finishedAt: new Date() },
  });
  return res.count;
}

async function claimSync(prisma: PrismaClient, meta: SyncMeta): Promise<string> {
  const now = new Date();
  await prisma.caSync.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_SYNC_MS) } },
    data: { status: "FAILED", errorMessage: "Interrompida (sem conclusão em 30 min)", finishedAt: now },
  });
  const running = await prisma.caSync.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } });
  if (running) throw new CaepiBusyError(`Sincronização CAEPI já em andamento desde ${running.startedAt.toISOString()}`);
  const sync = await prisma.caSync.create({ data: { source: meta.source, status: "RUNNING", triggeredBy: meta.triggeredBy } });
  return sync.id;
}

/** `load` entrega o arquivo já lido e validado por inteiro; a gravação só começa depois disso. */
async function runSync(
  prisma: PrismaClient,
  meta: SyncMeta,
  load: () => Promise<{ parser: CaepiParser; fileHash: string }>,
): Promise<CaepiSyncResult> {
  const syncId = await claimSync(prisma, meta);
  try {
    const { parser, fileHash } = await load();
    await prisma.caSync.update({ where: { id: syncId }, data: { fileHash } });
    const existing = await prisma.caMaster.findMany({ select: { caNumber: true, rowHash: true } });
    const total = parser.records.size;
    if (existing.length > 1000 && total < existing.length * MIN_RECORDS_RATIO) {
      throw new CaepiFileError(`Arquivo CAEPI incompleto: ${total} CAs contra ${existing.length} já conhecidos`);
    }
    const known = new Map(existing.map((e) => [e.caNumber, e.rowHash]));
    const counts = await writeRecords(prisma, syncId, parser.records, known);
    const result = { syncId, rowsRead: total, ...counts, rejected: parser.rejected };
    await prisma.caSync.update({
      where: { id: syncId },
      data: { status: "DONE", rowsRead: total, ...counts, finishedAt: new Date() },
    });
    return result;
  } catch (err) {
    await prisma.caSync.update({
      where: { id: syncId },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
    });
    throw err;
  }
}

function fieldValue(v: unknown): string {
  return String(v instanceof Date ? v.toISOString() : (v ?? ""));
}

/** Upsert idempotente com histórico de alterações (ca_history). Só começa após o arquivo inteiro ser validado. */
async function writeRecords(
  prisma: PrismaClient,
  syncId: string,
  records: Map<string, CaepiRecord>,
  known: Map<string, string>,
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let toInsert: Prisma.CaMasterCreateManyInput[] = [];
  let toUpdate: Array<{ rec: CaepiRecord; hash: string }> = [];

  const flushInserts = async () => {
    if (toInsert.length === 0) return;
    const res = await prisma.caMaster.createMany({ data: toInsert, skipDuplicates: true });
    inserted += res.count;
    toInsert = [];
  };
  const flushUpdates = async () => {
    if (toUpdate.length === 0) return;
    const chunk = toUpdate;
    toUpdate = [];
    const prevRows = await prisma.caMaster.findMany({ where: { caNumber: { in: chunk.map((c) => c.rec.caNumber) } } });
    const prevMap = new Map(prevRows.map((r) => [r.caNumber, r]));
    await prisma.$transaction(
      chunk.flatMap(({ rec, hash }) => {
        const before = prevMap.get(rec.caNumber);
        const changedFields = before ? (Object.keys(rec) as Field[]).filter((f) => fieldValue(before[f]) !== fieldValue(rec[f])) : [];
        return [
          prisma.caHistory.create({
            data: {
              caNumber: rec.caNumber,
              syncId,
              changedFields,
              previous: before ? (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue) : undefined,
              current: JSON.parse(JSON.stringify(rec)) as Prisma.InputJsonValue,
            },
          }),
          prisma.caMaster.update({ where: { caNumber: rec.caNumber }, data: { ...rec, rowHash: hash, syncId, syncedAt: now } }),
        ];
      }),
    );
    updated += chunk.length;
  };

  const manufacturers = new Map<string, string>();
  for (const rec of records.values()) {
    if (rec.manufacturerCnpj && rec.manufacturerName) manufacturers.set(rec.manufacturerCnpj, rec.manufacturerName);
    const hash = recordHash(rec);
    const prev = known.get(rec.caNumber);
    if (prev === undefined) {
      toInsert.push({ ...rec, rowHash: hash, syncId, syncedAt: now });
      if (toInsert.length >= 1000) await flushInserts();
    } else if (prev !== hash) {
      toUpdate.push({ rec, hash });
      if (toUpdate.length >= 200) await flushUpdates();
    } else unchanged++;
  }
  await flushInserts();
  await flushUpdates();

  const mList = [...manufacturers.entries()].map(([cnpj, name]) => ({ cnpj, name }));
  for (let i = 0; i < mList.length; i += 1000) {
    await prisma.caManufacturer.createMany({ data: mList.slice(i, i + 1000), skipDuplicates: true });
  }
  return { inserted, updated, unchanged };
}

/** Importa arquivo local (upload manual do tgg_export_caepi .zip/.txt). */
export async function syncCaepiFile(prisma: PrismaClient, path: string, meta: SyncMeta): Promise<CaepiSyncResult> {
  return runSync(prisma, meta, async () => {
    const parser = await parseCaepiFile(path);
    return { parser, fileHash: await hashFile(path) };
  });
}

/** Baixa e importa a base oficial; download truncado/corrompido é repetido antes de falhar. */
export async function syncCaepiFromUrl(
  prisma: PrismaClient,
  url: string,
  meta: { triggeredBy?: string },
  opts: { attempts?: number; retryDelayMs?: number } = {},
): Promise<CaepiSyncResult> {
  const attempts = opts.attempts ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 30_000;
  return runSync(prisma, { source: url, triggeredBy: meta.triggeredBy }, async () => {
    const errors: string[] = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const dir = await mkdtemp(join(tmpdir(), "caepi-"));
      const file = join(dir, "caepi.bin");
      try {
        await downloadCaepi(url, file);
        const parser = await parseCaepiFile(file);
        return { parser, fileHash: await hashFile(file) };
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        if (attempt < attempts) await sleep(retryDelayMs * attempt);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    throw new CaepiFileError(`Base CAEPI inválida após ${attempts} tentativas: ${errors.at(-1)}`);
  });
}
