import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaepiFileError, parseCaepiFile, parseCaepiText, recordHash, splitCaepiLine } from "./index.js";

const SAMPLE = [
  "#NRRegistroCA|DataValidade|Situacao|NRProcesso|CNPJ|RazaoSocial|Natureza|NomeEquipamento|DescricaoEquipamento|MarcaCA|Referencia|Cor|AprovadoParaLaudo|RestricaoLaudo|ObservacaoAnaliseLaudo|CNPJLaboratorio|RazaoSocialLaboratorio|NRLaudo|Norma",
  "12345|31/12/2027|VÁLIDO|46000.1/2020|11.222.333/0001-81|FABRICANTE X LTDA|Nacional|LUVA|LUVA DE SEGURANÇA EM VAQUETA|MARCA|REF1|AZUL|PROTEÇÃO DAS MÃOS CONTRA AGENTES ABRASIVOS|||12.345.678/0001-90|LAB A|L-1|EN 388",
  "12345|31/12/2027|VÁLIDO|46000.1/2020|11.222.333/0001-81|FABRICANTE X LTDA|Nacional|LUVA|LUVA DE SEGURANÇA EM VAQUETA|MARCA|REF1|AZUL|PROTEÇÃO DAS MÃOS CONTRA AGENTES ABRASIVOS|||12.345.678/0001-90|LAB A|L-2|EN 407",
  "00999|01/02/2020|VENCIDO|||OUTRO|Importado|PROTETOR AUDITIVO|PLUG||||||||||",
].join("\n");

/** Cabeçalho e formato reais do tgg_export_caepi.txt (2026): nomes com espaço e campos entre aspas contendo `|`. */
const OFFICIAL_HEADER =
  "NR Registro CA|DATA DE VALIDADE|SITUACAO|NR DO PROCESSO|CNPJ|RAZAO SOCIAL|NATUREZA|EQUIPAMENTO|DESCRICAO EQUIPAMENTO|MARCA CA|REFERENCIA|COR|APROVADO PARA LAUDO|RESTRICAO LAUDO|OBSERVACAO ANALISE LAUDO|CNPJ LABORATORIO|RAZAO SOCIAL LABORATORIO|NR LAUDO|NORMA";
const OFFICIAL_ROW =
  '44770|28/01/2030|VÁLIDO|19966200227202530|07145732000119|INOVA EPIS LTDA|Importado|LUVA PARA PROTEÇÃO|Luva de segurança|Na etiqueta.|"Soft Touch | 1010."|Cinza com preta.|PROTEÇÃO DAS MÃOS|EPI NÃO APROVADO CONTRA ARCO|"I) Níveis ""2121X"""|87190161000173|IBTEC|EPI 17079/25|EN 388:2016';

function officialText(rows: string[], eol = "\n"): string {
  return [OFFICIAL_HEADER, ...rows].join(eol) + eol;
}

describe("splitCaepiLine", () => {
  it("respeita aspas com | e aspas escapadas", () => {
    expect(splitCaepiLine('a|"b | c"|d')).toEqual(["a", "b | c", "d"]);
    expect(splitCaepiLine('a|"x ""y"""|')).toEqual(["a", 'x "y"', ""]);
    expect(splitCaepiLine("a||")).toEqual(["a", "", ""]);
    expect(splitCaepiLine('a|"fim"')).toEqual(["a", "fim"]);
  });
});

describe("parseCaepiText", () => {
  it("lê cabeçalho oficial, agrega CA repetido e normaliza", () => {
    const recs = parseCaepiText(SAMPLE);
    expect(recs).toHaveLength(2);
    const luva = recs.find((r) => r.caNumber === "12345")!;
    expect(luva.validUntil?.toISOString().slice(0, 10)).toBe("2027-12-31");
    expect(luva.manufacturerCnpj).toBe("11222333000181");
    expect(luva.standard).toBe("EN 388 | EN 407");
    expect(luva.reportNumber).toBe("L-1 | L-2");
    expect(recs.find((r) => r.caNumber === "999")?.situation).toBe("VENCIDO");
  });

  it("reconhece o cabeçalho atual do MTE (DATA DE VALIDADE, EQUIPAMENTO) e campos entre aspas", () => {
    const [rec] = parseCaepiText(officialText([OFFICIAL_ROW], "\r\n"));
    expect(rec?.caNumber).toBe("44770");
    expect(rec?.validUntil?.toISOString().slice(0, 10)).toBe("2030-01-28");
    expect(rec?.processNumber).toBe("19966200227202530");
    expect(rec?.equipmentName).toBe("LUVA PARA PROTEÇÃO");
    expect(rec?.reference).toBe("Soft Touch | 1010.");
    expect(rec?.observations).toBe('I) Níveis "2121X"');
    expect(rec?.standard).toBe("EN 388:2016");
  });

  it("hash estável", () => {
    const [a] = parseCaepiText(SAMPLE);
    const [b] = parseCaepiText(SAMPLE);
    expect(recordHash(a!)).toBe(recordHash(b!));
  });
});

describe("parseCaepiFile", () => {
  let dir: string;
  const rows = Array.from({ length: 300 }, (_, i) => OFFICIAL_ROW.replace(/^44770/, String(10000 + i)));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "caepi-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function zipFile(name: string, text: string | Buffer): Promise<string> {
    const zip = new AdmZip();
    zip.addFile("tgg_export_caepi.txt", Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"));
    const path = join(dir, name);
    await writeFile(path, zip.toBuffer());
    return path;
  }

  it("lê ZIP íntegro em streaming", async () => {
    const parser = await parseCaepiFile(await zipFile("ok.zip", officialText(rows)));
    expect(parser.records.size).toBe(300);
    expect(parser.rejected).toBe(0);
    expect(parser.records.get("10000")?.validUntil?.toISOString().slice(0, 10)).toBe("2030-01-28");
  });

  it("rejeita ZIP truncado (sem índice central)", async () => {
    const path = await zipFile("full.zip", officialText(rows));
    const buf = await readFile(path);
    const truncated = Buffer.concat([buf.subarray(0, Math.floor(buf.length * 0.6)), Buffer.alloc(4096)]);
    const bad = join(dir, "truncated.zip");
    await writeFile(bad, truncated);
    await expect(parseCaepiFile(bad)).rejects.toBeInstanceOf(CaepiFileError);
  });

  it("rejeita arquivo com cauda corrompida acima de 1%", async () => {
    const garbage = Array.from({ length: 30 }, () => `${OFFICIAL_ROW}|lixo|lixo`);
    await expect(parseCaepiFile(await zipFile("tail.zip", officialText([...rows, ...garbage])))).rejects.toThrow(/linhas malformadas/);
  });

  it("aceita .txt em latin1", async () => {
    const path = join(dir, "latin1.txt");
    await writeFile(path, Buffer.from(officialText(rows.slice(0, 5)), "latin1"));
    const parser = await parseCaepiFile(path);
    expect(parser.records.get("10000")?.equipmentName).toBe("LUVA PARA PROTEÇÃO");
  });
});
