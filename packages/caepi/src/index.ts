import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  situacao: "situation",
  nrprocesso: "processNumber",
  cnpj: "manufacturerCnpj",
  razaosocial: "manufacturerName",
  natureza: "nature",
  nomeequipamento: "equipmentName",
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

function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
}

/** Aceita ZIP (com .txt dentro) ou o texto já extraído. Arquivo oficial vem em latin1. */
export function extractCaepiText(buffer: Buffer): string {
  if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntries().find((e) => /\.(txt|csv)$/i.test(e.entryName));
    if (!entry) throw new Error("ZIP CAEPI sem arquivo .txt");
    return decode(entry.getData());
  }
  return decode(buffer);
}

function decode(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  return utf8.includes("\uFFFD") ? buf.toString("latin1") : utf8;
}

export function parseCaepiText(text: string): CaepiRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const first = lines[0]!.replace(/^#/, "").split("|").map(normHeader);
  const mapped = first.map((h) => HEADER_ALIASES[h]);
  const hasHeader = mapped.filter(Boolean).length >= 5;
  const columns: Array<Field | undefined> = hasHeader ? mapped : POSITIONAL;
  const body = hasHeader ? lines.slice(1) : lines;

  const byCa = new Map<string, CaepiRecord>();
  for (const line of body) {
    const parts = line.split("|");
    const raw: Partial<Record<Field, string | null>> = {};
    columns.forEach((field, idx) => {
      if (field) raw[field] = clean(parts[idx]);
    });
    const caNumber = raw.caNumber ? normalizeCaNumber(raw.caNumber) : "";
    if (!caNumber) continue;
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
    const existing = byCa.get(caNumber);
    if (!existing) {
      byCa.set(caNumber, rec);
      continue;
    }
    for (const f of MERGE_FIELDS) {
      const a = existing[f] as string | null;
      const b = rec[f] as string | null;
      if (b && (!a || !a.split(" | ").includes(b))) (existing[f] as string | null) = a ? `${a} | ${b}` : b;
    }
  }
  return [...byCa.values()];
}

export function recordHash(rec: CaepiRecord): string {
  return createHash("sha256").update(canonicalJson(rec)).digest("hex");
}

export async function downloadCaepi(url: string): Promise<Buffer> {
  if (url.startsWith("ftp://")) {
    const u = new URL(url);
    const client = new FtpClient(120_000);
    const dir = await mkdtemp(join(tmpdir(), "caepi-"));
    const file = join(dir, "caepi.bin");
    try {
      await client.access({ host: u.hostname, port: u.port ? Number(u.port) : 21, user: u.username || "anonymous", password: u.password || "anonymous@", secure: false });
      await client.downloadTo(file, decodeURIComponent(u.pathname));
      return await readFile(file);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Download CAEPI falhou: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface CaepiSyncResult {
  syncId: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Upsert idempotente da base CAEPI com histórico de alterações (ca_history). */
export async function syncCaepi(
  prisma: PrismaClient,
  buffer: Buffer,
  meta: { source: string; triggeredBy?: string },
): Promise<CaepiSyncResult> {
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const sync = await prisma.caSync.create({ data: { source: meta.source, status: "RUNNING", fileHash, triggeredBy: meta.triggeredBy } });
  try {
    const records = parseCaepiText(extractCaepiText(buffer));
    if (records.length === 0) throw new Error("Arquivo CAEPI sem registros reconhecidos");

    const existing = await prisma.caMaster.findMany({ select: { caNumber: true, rowHash: true } });
    const known = new Map(existing.map((e) => [e.caNumber, e.rowHash]));
    const now = new Date();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    const toInsert: Prisma.CaMasterCreateManyInput[] = [];
    const toUpdate: Array<{ rec: CaepiRecord; hash: string }> = [];
    for (const rec of records) {
      const hash = recordHash(rec);
      const prev = known.get(rec.caNumber);
      if (prev === undefined) toInsert.push({ ...rec, rowHash: hash, syncId: sync.id, syncedAt: now });
      else if (prev !== hash) toUpdate.push({ rec, hash });
      else unchanged++;
    }

    for (let i = 0; i < toInsert.length; i += 1000) {
      const res = await prisma.caMaster.createMany({ data: toInsert.slice(i, i + 1000), skipDuplicates: true });
      inserted += res.count;
    }

    for (let i = 0; i < toUpdate.length; i += 200) {
      const chunk = toUpdate.slice(i, i + 200);
      const prevRows = await prisma.caMaster.findMany({ where: { caNumber: { in: chunk.map((c) => c.rec.caNumber) } } });
      const prevMap = new Map(prevRows.map((r) => [r.caNumber, r]));
      await prisma.$transaction(
        chunk.flatMap(({ rec, hash }) => {
          const before = prevMap.get(rec.caNumber);
          const changedFields = before
            ? (Object.keys(rec) as Field[]).filter((f) => String(before[f] instanceof Date ? (before[f] as Date).toISOString() : before[f] ?? "") !== String(rec[f] instanceof Date ? (rec[f] as Date).toISOString() : rec[f] ?? ""))
            : [];
          return [
            prisma.caHistory.create({
              data: {
                caNumber: rec.caNumber,
                syncId: sync.id,
                changedFields,
                previous: before ? (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue) : undefined,
                current: JSON.parse(JSON.stringify(rec)) as Prisma.InputJsonValue,
              },
            }),
            prisma.caMaster.update({ where: { caNumber: rec.caNumber }, data: { ...rec, rowHash: hash, syncId: sync.id, syncedAt: now } }),
          ];
        }),
      );
      updated += chunk.length;
    }

    const manufacturers = new Map<string, string>();
    for (const r of records) if (r.manufacturerCnpj && r.manufacturerName) manufacturers.set(r.manufacturerCnpj, r.manufacturerName);
    const mList = [...manufacturers.entries()].map(([cnpj, name]) => ({ cnpj, name }));
    for (let i = 0; i < mList.length; i += 1000) {
      await prisma.caManufacturer.createMany({ data: mList.slice(i, i + 1000), skipDuplicates: true });
    }

    await prisma.caSync.update({
      where: { id: sync.id },
      data: { status: "DONE", rowsRead: records.length, inserted, updated, unchanged, finishedAt: new Date() },
    });
    return { syncId: sync.id, rowsRead: records.length, inserted, updated, unchanged };
  } catch (err) {
    await prisma.caSync.update({
      where: { id: sync.id },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
    });
    throw err;
  }
}
