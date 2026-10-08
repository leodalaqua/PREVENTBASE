import { describe, expect, it } from "vitest";
import { canonicalJson, isValidCnpj, isValidCpf, normalizeCaNumber } from "./common.js";

describe("common", () => {
  it("valida CPF", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });

  it("valida CNPJ", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
  });

  it("canonical JSON ordena chaves e ignora undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined, b: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"b":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it("normaliza CA", () => {
    expect(normalizeCaNumber("CA 012345")).toBe("12345");
  });
});
