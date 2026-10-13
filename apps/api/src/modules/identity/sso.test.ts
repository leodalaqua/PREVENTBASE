import * as OTPAuth from "otpauth";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthService as AuthServiceType } from "./auth.service.js";

type Row = Record<string, any>;

let AuthService: typeof AuthServiceType;
let run: <T>(fn: () => Promise<T>, ip?: string) => Promise<T>;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.BIOMETRIC_SERVICE_TOKEN = "test-token";
  process.env.VERITECH_SSO_INTERNAL_URL = "http://central.test";
  ({ AuthService } = await import("./auth.service.js"));
  const { contextStorage } = await import("../../core/context.js");
  run = (fn, ip = "10.0.0.1") => contextStorage.run({ requestId: "test", ip }, fn);
}, 120_000);

vi.mock("../../core/prisma.service.js", () => ({ PrismaService: class {} }));
vi.mock("../../core/audit.service.js", () => ({ AuditService: class {} }));

afterEach(() => vi.unstubAllGlobals());

const PERMS = { entregas: { entregas: { visualizar: true, inserir: true } } };

function makeDb() {
  const users: Row[] = [];
  const sessions: Row[] = [];
  const insensitive = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const prisma = {
    user: {
      findUnique: async ({ where }: Row) => users.find((u) => (where.id ? u.id === where.id : where.cpf ? u.cpf === where.cpf : u.email === where.email)) ?? null,
      findFirst: async ({ where }: Row) => users.find((u) => insensitive(u.email, where.email.equals) && (!where.id?.not || u.id !== where.id.not)) ?? null,
      create: async ({ data }: Row) => {
        const user = { id: `u${users.length + 1}`, status: "ACTIVE", mfaEnabled: false, mfaSecret: null, cpf: null, ...data };
        users.push(user);
        return user;
      },
      update: async ({ where, data }: Row) => Object.assign(users.find((u) => u.id === where.id)!, data),
    },
    tenant: { findMany: async () => [{ id: "t1" }] },
    session: {
      create: async ({ data }: Row) => (sessions.push({ ...data, rotatedAt: null, revokedAt: null }), data),
      findUnique: async ({ where }: Row) => {
        const s = sessions.find((x) => x.refreshTokenHash === where.refreshTokenHash);
        return s ? { ...s, user: users.find((u) => u.id === s.userId) } : null;
      },
      updateMany: async ({ where, data }: Row) => {
        const hit = sessions.filter(
          (s) => (where.id ? s.id === where.id : s.familyId === where.familyId) && (where.rotatedAt !== null || !s.rotatedAt) && (where.revokedAt !== null || !s.revokedAt),
        );
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
    },
  };
  const service = new AuthService(
    prisma as never,
    { signAsync: async (p: Row) => `jwt.${p.sid}` } as never,
    { log: async () => undefined } as never,
    { invalidate: () => undefined } as never,
  );
  return { service, users, sessions };
}

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function identity(over: Row = {}) {
  return {
    ok: true,
    idleSec: 1800,
    user: { cpf: "52998224725", nome: "Fulana", email: "fulana@veritech.com.br", telefone: "", isAdmin: false, app: "preventbase", permissoes: PERMS, sid: "sid-1", metodo: "senha", ...over },
  };
}

type Route = (body: Row) => Response;
function central(routes: { redeem?: Route; check?: Route; password?: Route; password2fa?: Route }) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const path = url.replace("http://central.test", "");
    const route = { "/sso/redeem": routes.redeem, "/sso/check": routes.check, "/sso/password": routes.password, "/sso/password/2fa": routes.password2fa }[path];
    if (route) return route(body);
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("login único Veritech", () => {
  it("sso-config expõe URL pública, app e login local", () => {
    const { service } = makeDb();
    expect(service.ssoConfig()).toEqual({ url: "https://servidor.taild57d57.ts.net", app: "preventbase", local: true });
  });

  it("usuário novo entra ativo, com CPF e permissões da central gravados na sessão", async () => {
    const { service, users, sessions } = makeDb();
    const fetchMock = central({ redeem: () => json(200, identity({ email: "Fulana@Veritech.com.br" })) });
    const tokens = await run(() => service.loginSso({ ticket: "ST-abc" }));
    expect(tokens.accessToken).toMatch(/^jwt\./);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ ticket: "ST-abc", app: "preventbase" });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "fulana@veritech.com.br", cpf: "52998224725", name: "Fulana", status: "ACTIVE" });
    expect(sessions[0]).toMatchObject({ ssoSid: "sid-1", ssoIsAdmin: false, ssoPermissoes: PERMS, ssoMfa: false });
  });

  it("admin central: sessão com isAdmin", async () => {
    const { service, sessions } = makeDb();
    central({ redeem: () => json(200, identity({ isAdmin: true, permissoes: {} })) });
    await run(() => service.loginSso({ ticket: "ST-abc" }));
    expect(sessions[0]).toMatchObject({ ssoIsAdmin: true, ssoPermissoes: {} });
  });

  it("acha o espelho por CPF antes do e-mail e sincroniza nome/e-mail", async () => {
    const { service, users } = makeDb();
    users.push({ id: "u-cpf", tenantId: "t1", cpf: "52998224725", email: "antigo@veritech.com.br", name: "Antigo", status: "ACTIVE", mfaEnabled: false });
    users.push({ id: "u-mail", tenantId: "t1", cpf: null, email: "outra@veritech.com.br", name: "Outra", status: "ACTIVE", mfaEnabled: false });
    central({ redeem: () => json(200, identity({ email: "nova@veritech.com.br", nome: "Fulana Silva" })) });
    await run(() => service.loginSso({ ticket: "ST-abc" }));
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ id: "u-cpf", email: "nova@veritech.com.br", name: "Fulana Silva" });
  });

  it("sem CPF no espelho: acha por e-mail (sem diferenciar maiúsculas), grava CPF e reativa bloqueado", async () => {
    const { service, users, sessions } = makeDb();
    users.push({ id: "u-old", tenantId: "t1", cpf: null, email: "fulana@veritech.com.br", name: "Fulana", status: "BLOCKED", mfaEnabled: false });
    central({ redeem: () => json(200, identity({ email: "FULANA@veritech.com.br" })) });
    await run(() => service.loginSso({ ticket: "ST-abc" }));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ cpf: "52998224725", status: "ACTIVE" });
    expect(sessions[0]!.ssoSid).toBe("sid-1");
  });

  it("ticket inválido → 401; central fora → 503", async () => {
    const { service } = makeDb();
    central({ redeem: () => json(401, { error: "ticket inválido" }) });
    await expect(run(() => service.loginSso({ ticket: "ST-x" }))).rejects.toMatchObject({ status: 401, code: "SSO_INVALID" });
    central({});
    await expect(run(() => service.loginSso({ ticket: "ST-x" }))).rejects.toMatchObject({ status: 503, code: "SSO_UNAVAILABLE" });
  });

  describe("MFA do app", () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const code = () => new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate();
    const withMfa = () => {
      const db = makeDb();
      db.users.push({ id: "u-m", tenantId: "t1", cpf: "52998224725", email: "fulana@veritech.com.br", name: "Fulana", status: "ACTIVE", mfaEnabled: true, mfaSecret: secret.base32 });
      return db;
    };

    it("senha central sem 2FA (mfa:false) + TOTP ativo pede o código antes de emitir a sessão", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "senha", mfa: false })) });
      const err = await run(() => service.loginSso({ ticket: "ST-abc" })).catch((e) => e);
      expect(err).toMatchObject({ status: 401, code: "MFA_REQUIRED" });
      expect(sessions).toHaveLength(0);
      const mfaToken = (err.details as { mfaToken: string }).mfaToken;
      await expect(run(() => service.loginSso({ mfaToken, mfaCode: "000000" }))).rejects.toMatchObject({ code: "MFA_INVALID" });
      const tokens = await run(() => service.loginSso({ mfaToken, mfaCode: code() }));
      expect(tokens.refreshToken).toBeTruthy();
      expect(sessions[0]).toMatchObject({ ssoSid: "sid-1", ssoPermissoes: PERMS, ssoMfa: false });
      await expect(run(() => service.loginSso({ mfaToken, mfaCode: code() }))).rejects.toMatchObject({ status: 401, code: "SSO_INVALID" });
    });

    it("passkey central dispensa o TOTP", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "passkey" })) });
      await run(() => service.loginSso({ ticket: "ST-abc" }));
      expect(sessions).toHaveLength(1);
    });

    it("senha + 2FA na central (mfa:true) dispensa o TOTP", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "senha", mfa: true })) });
      await run(() => service.loginSso({ ticket: "ST-abc" }));
      expect(sessions[0]).toMatchObject({ ssoMfa: true });
    });

    it("redeem sem campo mfa segue exigindo o TOTP", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "senha" })) });
      await expect(run(() => service.loginSso({ ticket: "ST-abc" }))).rejects.toMatchObject({ status: 401, code: "MFA_REQUIRED" });
      expect(sessions).toHaveLength(0);
    });
  });

  it("renovação: permissões novas valem; central fora mantém; active:false derruba", async () => {
    const { service, sessions } = makeDb();
    central({ redeem: () => json(200, identity()) });
    const first = await run(() => service.loginSso({ ticket: "ST-abc" }));

    const novas = { estoque: { saldos: { visualizar: true } } };
    const fetchMock = central({ check: () => json(200, { active: true, isAdmin: false, permissoes: novas }) });
    const second = await run(() => service.refresh(first.refreshToken));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ sid: "sid-1", app: "preventbase" });
    expect(sessions.at(-1)).toMatchObject({ ssoSid: "sid-1", ssoPermissoes: novas });

    central({});
    const third = await run(() => service.refresh(second.refreshToken));
    expect(sessions.at(-1)).toMatchObject({ ssoPermissoes: novas });

    central({ check: () => json(200, { active: false, isAdmin: false }) });
    await expect(run(() => service.refresh(third.refreshToken))).rejects.toMatchObject({ status: 401, code: "SSO_ENDED" });
    expect(sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it("sessão sem sid central (antiga) não renova", async () => {
    const { service, users, sessions } = makeDb();
    users.push({ id: "u-x", tenantId: "t1", email: "x@veritech.com.br", status: "ACTIVE" });
    const { createHash } = await import("node:crypto");
    const token = "sess-old.abcdefghijklmnopqrstuvwxyz";
    sessions.push({ id: "sess-old", userId: "u-x", tenantId: "t1", familyId: "f", ssoSid: null, refreshTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 1e6), rotatedAt: null, revokedAt: null });
    await expect(run(() => service.refresh(token))).rejects.toMatchObject({ status: 401, code: "REFRESH_EXPIRED" });
  });

  describe("conta local = CPF/e-mail + senha Veritech na central", () => {
    it("repassa login, senha, app e IP do navegador; entra igual ao ticket", async () => {
      const { service, users, sessions } = makeDb();
      const fetchMock = central({ password: () => json(200, identity()) });
      await run(() => service.login({ login: "529.982.247-25", senha: "senha-veritech-1" }), "10.0.0.7");
      expect(fetchMock.mock.calls[0]![0]).toBe("http://central.test/sso/password");
      expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ login: "529.982.247-25", senha: "senha-veritech-1", app: "preventbase", ip: "10.0.0.7" });
      expect(users[0]).toMatchObject({ cpf: "52998224725", status: "ACTIVE" });
      expect(sessions[0]).toMatchObject({ ssoSid: "sid-1", ssoPermissoes: PERMS });
    });

    it("2FA da central: pede o código e conclui por /sso/password/2fa (dispensa o TOTP do app)", async () => {
      const { service, users, sessions } = makeDb();
      users.push({ id: "u-m", tenantId: "t1", cpf: "52998224725", email: "fulana@veritech.com.br", name: "Fulana", status: "ACTIVE", mfaEnabled: true, mfaSecret: "JBSWY3DPEHPK3PXP" });
      const fetchMock = central({ password: () => json(200, { ok: true, mfa: true, mfaToken: "MT-1" }), password2fa: () => json(200, identity({ mfa: true })) });
      const err = await run(() => service.login({ login: "fulana@veritech.com.br", senha: "x" }), "10.0.0.8").catch((e) => e);
      expect(err).toMatchObject({ status: 401, code: "SSO_MFA_REQUIRED", details: { ssoMfaToken: "MT-1" } });
      await run(() => service.login({ ssoMfaToken: "MT-1", codigo: "123456" }), "10.0.0.8");
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({ mfaToken: "MT-1", codigo: "123456", app: "preventbase", ip: "10.0.0.8" });
      expect(sessions[0]).toMatchObject({ ssoMfa: true });
    });

    it("senha errada → 401 da central; 403 e 429 repassados", async () => {
      const { service, sessions } = makeDb();
      central({ password: () => json(401, { error: "CPF/e-mail ou senha inválidos" }) });
      await expect(run(() => service.login({ login: "a@b.com", senha: "x" }), "10.0.0.9")).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS", message: "CPF/e-mail ou senha inválidos" });
      central({ password: () => json(403, { error: "Sem acesso a este sistema" }) });
      await expect(run(() => service.login({ login: "b@b.com", senha: "x" }), "10.0.0.9")).rejects.toMatchObject({ status: 403, message: "Sem acesso a este sistema" });
      central({ password: () => json(429, { error: "Bloqueado" }) });
      await expect(run(() => service.login({ login: "c@b.com", senha: "x" }), "10.0.0.9")).rejects.toMatchObject({ status: 429 });
      expect(sessions).toHaveLength(0);
    });

    it("3ª senha errada bloqueia por 15 minutos", async () => {
      const { service } = makeDb();
      central({ password: () => json(401, { error: "CPF/e-mail ou senha inválidos" }) });
      const login = () => run(() => service.login({ login: "local@veritech.com.br", senha: "errada" }), "10.0.0.99");
      await expect(login()).rejects.toMatchObject({ status: 401 });
      await expect(login()).rejects.toMatchObject({ status: 401 });
      await expect(login()).rejects.toMatchObject({ status: 429, message: "Login bloqueado após 3 tentativas. Aguarde 15 minutos." });
      await expect(login()).rejects.toMatchObject({ status: 429 });
    });
  });
});
