import { normalizarPermissoes, pode } from "@preventbase/permissions";
import { describe, expect, it, vi } from "vitest";
import { ACESSO, AuthGuard, IS_PUBLIC } from "./auth.guard.js";
import { contextStorage, type RequestContext } from "./context.js";

vi.mock("./prisma.service.js", () => ({ PrismaService: class {} }));

type Sess = { ssoSid: string | null; ssoIsAdmin: boolean; ssoPermissoes: unknown; revokedAt?: Date | null; status?: string };

function guardFor(chaves: string[] | undefined, sess: Sess) {
  const reflector = { getAllAndOverride: (key: string) => (key === ACESSO ? chaves : key === IS_PUBLIC ? false : undefined) };
  const jwt = { verifyAsync: async () => ({ sub: "u1", tid: "t1", sid: "s1" }) };
  const prisma = {
    session: {
      findUnique: async () => ({ revokedAt: sess.revokedAt ?? null, expiresAt: new Date(Date.now() + 60_000), userId: "u1", ssoSid: sess.ssoSid, ssoIsAdmin: sess.ssoIsAdmin, ssoPermissoes: sess.ssoPermissoes, user: { status: sess.status ?? "ACTIVE" } }),
    },
    tenant: { findUnique: async () => ({ settings: {} }) },
  };
  const guard = new AuthGuard(reflector as never, jwt as never, prisma as never);
  const exec = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ header: () => "Bearer x", query: {} }) }),
  };
  const c: RequestContext = { requestId: "t" };
  return { run: () => contextStorage.run(c, () => guard.canActivate(exec as never)), c };
}

const PERMS = { estoque: { saldos: { visualizar: true, inserir: true } } };

describe("autorização só pela central", () => {
  it("permite com a ação marcada na central e grava acesso no contexto", async () => {
    const { run, c } = guardFor(["estoque.saldos.inserir"], { ssoSid: "sid", ssoIsAdmin: false, ssoPermissoes: PERMS });
    await expect(run()).resolves.toBe(true);
    expect(c.acesso).toEqual({ isAdmin: false, permissoes: PERMS });
  });

  it("ação sem permissão → 403", async () => {
    const { run } = guardFor(["estoque.saldos.alterar"], { ssoSid: "sid", ssoIsAdmin: false, ssoPermissoes: PERMS });
    await expect(run()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("isAdmin central libera tudo", async () => {
    const { run } = guardFor(["administracao.dispositivos.atualizar"], { ssoSid: "sid", ssoIsAdmin: true, ssoPermissoes: {} });
    await expect(run()).resolves.toBe(true);
  });

  it("sessão sem sid central → 401", async () => {
    const { run } = guardFor(undefined, { ssoSid: null, ssoIsAdmin: true, ssoPermissoes: {} });
    await expect(run()).rejects.toMatchObject({ status: 401 });
  });

  it("'*' exige visualizar em alguma tela; qualquer chave da lista basta", () => {
    expect(pode({ isAdmin: false, permissoes: PERMS }, "*")).toBe(true);
    expect(pode({ isAdmin: false, permissoes: { estoque: { saldos: { inserir: true } } } }, "*")).toBe(false);
    expect(pode({ isAdmin: false, permissoes: PERMS }, "epi.catalogo.visualizar", "estoque.saldos.visualizar")).toBe(true);
  });

  it("normaliza a árvore da central (só true explícito)", () => {
    expect(normalizarPermissoes({ epi: { catalogo: { visualizar: true, inserir: "sim", excluir: false } }, "x y": {}, lixo: 1 })).toEqual({ epi: { catalogo: { visualizar: true } } });
  });
});
