import bcrypt from "bcryptjs";
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

function makeDb() {
  const users: Row[] = [];
  const sessions: Row[] = [];
  const userRoles: Row[] = [];
  const roles = [
    { id: "r-viewer", key: "viewer", tenantId: null },
    { id: "r-admin", key: "super_admin", tenantId: null },
  ];
  const prisma = {
    user: {
      findUnique: async ({ where }: Row) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
      findFirst: async ({ where }: Row) => users.find((u) => u.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null,
      create: async ({ data }: Row) => {
        const { roles: r, ...rest } = data;
        const user = { id: `u${users.length + 1}`, status: "ACTIVE", mfaEnabled: false, mfaSecret: null, ...rest };
        for (const c of r?.create ?? []) userRoles.push({ userId: user.id, roleId: c.roleId, companyId: null });
        users.push(user);
        return user;
      },
      update: async ({ where, data }: Row) => Object.assign(users.find((u) => u.id === where.id)!, data),
    },
    tenant: { findMany: async () => [{ id: "t1" }] },
    role: { findFirst: async ({ where }: Row) => roles.find((r) => r.key === where.key) ?? null },
    userRole: {
      findFirst: async ({ where }: Row) => userRoles.find((r) => r.userId === where.userId && (where.roleId === undefined || r.roleId === where.roleId)) ?? null,
      create: async ({ data }: Row) => (userRoles.push({ ...data, companyId: null }), data),
    },
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
  return { service, users, sessions, userRoles };
}

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function identity(over: Row = {}) {
  return {
    ok: true,
    idleSec: 1800,
    user: { cpf: "52998224725", nome: "Fulana", email: "fulana@veritech.com.br", telefone: "", isAdmin: false, app: "preventbase", permissoes: {}, sid: "sid-1", metodo: "senha", ...over },
  };
}

function central(routes: { redeem?: (body: Row) => Response; check?: (body: Row) => Response }) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url === "http://central.test/sso/redeem" && routes.redeem) return routes.redeem(body);
    if (url === "http://central.test/sso/check" && routes.check) return routes.check(body);
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

  it("usuário novo nasce sem nenhum acesso (bloqueado, sem perfil) e recebe 403 de liberação pendente", async () => {
    const { service, users, sessions, userRoles } = makeDb();
    const fetchMock = central({ redeem: () => json(200, identity({ email: "Fulana@Veritech.com.br" })) });
    const pending = { status: 403, code: "SSO_PENDING", message: "Acesso criado. Aguarde a liberação do administrador." };
    await expect(run(() => service.loginSso({ ticket: "ST-abc" }))).rejects.toMatchObject(pending);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ ticket: "ST-abc", app: "preventbase" });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "fulana@veritech.com.br", status: "BLOCKED" });
    expect(userRoles).toEqual([]);
    expect(sessions).toHaveLength(0);

    await expect(run(() => service.loginSso({ ticket: "ST-def" }))).rejects.toMatchObject(pending);
    expect(users).toHaveLength(1);
    expect(sessions).toHaveLength(0);
  });

  it("admin central vira Super Admin ativo e recebe sessão com sid central", async () => {
    const { service, users, sessions, userRoles } = makeDb();
    central({ redeem: () => json(200, identity({ isAdmin: true })) });
    const tokens = await run(() => service.loginSso({ ticket: "ST-abc" }));
    expect(tokens.accessToken).toMatch(/^jwt\./);
    expect(users[0]).toMatchObject({ status: "ACTIVE" });
    expect(userRoles).toEqual([{ userId: users[0]!.id, roleId: "r-admin", companyId: null }]);
    expect(sessions[0]!.ssoSid).toBe("sid-1");
  });

  it("reaproveita usuário existente por e-mail sem diferenciar maiúsculas", async () => {
    const { service, users, sessions } = makeDb();
    users.push({ id: "u-old", tenantId: "t1", email: "fulana@veritech.com.br", status: "ACTIVE", mfaEnabled: false });
    central({ redeem: () => json(200, identity({ email: "FULANA@veritech.com.br" })) });
    await run(() => service.loginSso({ ticket: "ST-abc" }));
    expect(users).toHaveLength(1);
    expect(sessions[0]!.ssoSid).toBe("sid-1");
  });

  it("ticket inválido → 401; central fora → 503", async () => {
    const { service } = makeDb();
    central({ redeem: () => json(401, { error: "ticket inválido" }) });
    await expect(run(() => service.loginSso({ ticket: "ST-x" }))).rejects.toMatchObject({ status: 401, code: "SSO_INVALID" });
    central({});
    await expect(run(() => service.loginSso({ ticket: "ST-x" }))).rejects.toMatchObject({ status: 503, code: "SSO_UNAVAILABLE" });
  });

  it("usuário inativo → 403", async () => {
    const { service, users, sessions, userRoles } = makeDb();
    users.push({ id: "u-b", tenantId: "t1", email: "fulana@veritech.com.br", status: "BLOCKED", mfaEnabled: false });
    userRoles.push({ userId: "u-b", roleId: "r-viewer", companyId: null });
    central({ redeem: () => json(200, identity()) });
    await expect(run(() => service.loginSso({ ticket: "ST-abc" }))).rejects.toMatchObject({ status: 403, code: "USER_BLOCKED" });
    expect(sessions).toHaveLength(0);
  });

  describe("MFA", () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const code = () => new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate();
    const withMfa = () => {
      const db = makeDb();
      db.users.push({ id: "u-m", tenantId: "t1", email: "fulana@veritech.com.br", status: "ACTIVE", mfaEnabled: true, mfaSecret: secret.base32 });
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
      expect(sessions[0]!.ssoSid).toBe("sid-1");
      await expect(run(() => service.loginSso({ mfaToken, mfaCode: code() }))).rejects.toMatchObject({ status: 401, code: "SSO_INVALID" });
    });

    it("passkey central dispensa o TOTP", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "passkey" })) });
      const tokens = await run(() => service.loginSso({ ticket: "ST-abc" }));
      expect(tokens.accessToken).toBeTruthy();
      expect(sessions).toHaveLength(1);
    });

    it("senha + 2FA na central (mfa:true) dispensa o TOTP", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "senha", mfa: true })) });
      const tokens = await run(() => service.loginSso({ ticket: "ST-abc" }));
      expect(tokens.accessToken).toBeTruthy();
      expect(sessions).toHaveLength(1);
    });

    it("redeem sem campo mfa (central antiga) segue exigindo o TOTP", async () => {
      const { service, sessions } = withMfa();
      central({ redeem: () => json(200, identity({ metodo: "senha" })) });
      await expect(run(() => service.loginSso({ ticket: "ST-abc" }))).rejects.toMatchObject({ status: 401, code: "MFA_REQUIRED" });
      expect(sessions).toHaveLength(0);
    });
  });

  it("renovação: check active:false derruba; central fora mantém", async () => {
    const { service, users, sessions } = makeDb();
    users.push({ id: "u-r", tenantId: "t1", email: "fulana@veritech.com.br", status: "ACTIVE", mfaEnabled: false });
    central({ redeem: () => json(200, identity()) });
    const first = await run(() => service.loginSso({ ticket: "ST-abc" }));

    central({});
    const second = await run(() => service.refresh(first.refreshToken));
    expect(sessions.at(-1)!.ssoSid).toBe("sid-1");

    const fetchMock = central({ check: () => json(200, { active: false, isAdmin: false }) });
    await expect(run(() => service.refresh(second.refreshToken))).rejects.toMatchObject({ status: 401, code: "SSO_ENDED" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ sid: "sid-1", app: "preventbase" });
    expect(sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it("3ª senha local errada bloqueia por 15 minutos", async () => {
    const { service, users } = makeDb();
    users.push({ id: "u-l", tenantId: "t1", email: "local@veritech.com.br", status: "ACTIVE", mfaEnabled: false, passwordHash: await bcrypt.hash("senha-certa-123", 4) });
    const login = (password: string) => run(() => service.login("local@veritech.com.br", password), "10.0.0.99");
    await expect(login("errada")).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(login("errada")).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(login("errada")).rejects.toMatchObject({ status: 429, message: "Login bloqueado após 3 tentativas. Aguarde 15 minutos." });
    await expect(login("senha-certa-123")).rejects.toMatchObject({ status: 429 });
  });
});
