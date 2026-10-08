import { describe, expect, it } from "vitest";
import { parseCaepiText, recordHash } from "./index.js";

const SAMPLE = [
  "#NRRegistroCA|DataValidade|Situacao|NRProcesso|CNPJ|RazaoSocial|Natureza|NomeEquipamento|DescricaoEquipamento|MarcaCA|Referencia|Cor|AprovadoParaLaudo|RestricaoLaudo|ObservacaoAnaliseLaudo|CNPJLaboratorio|RazaoSocialLaboratorio|NRLaudo|Norma",
  "12345|31/12/2027|VÁLIDO|46000.1/2020|11.222.333/0001-81|FABRICANTE X LTDA|Nacional|LUVA|LUVA DE SEGURANÇA EM VAQUETA|MARCA|REF1|AZUL|PROTEÇÃO DAS MÃOS CONTRA AGENTES ABRASIVOS|||12.345.678/0001-90|LAB A|L-1|EN 388",
  "12345|31/12/2027|VÁLIDO|46000.1/2020|11.222.333/0001-81|FABRICANTE X LTDA|Nacional|LUVA|LUVA DE SEGURANÇA EM VAQUETA|MARCA|REF1|AZUL|PROTEÇÃO DAS MÃOS CONTRA AGENTES ABRASIVOS|||12.345.678/0001-90|LAB A|L-2|EN 407",
  "00999|01/02/2020|VENCIDO|||OUTRO|Importado|PROTETOR AUDITIVO|PLUG|||||||||",
].join("\n");

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

  it("hash estável", () => {
    const [a] = parseCaepiText(SAMPLE);
    const [b] = parseCaepiText(SAMPLE);
    expect(recordHash(a!)).toBe(recordHash(b!));
  });
});
