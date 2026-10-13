import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Prisma } from "@preventbase/database";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { config } from "../../config.js";
import { AuditService } from "../../core/audit.service.js";
import { type AccessPayload, AuthGuard } from "../../core/auth.guard.js";
import { authed, ctx, DomainError } from "../../core/context.js";
import { PrismaService } from "../../core/prisma.service.js";
import { SSO_APP, type SsoIdentity, ssoCheck, ssoPassword, ssoRedeem } from "./sso.js";

/** Padrão do ecossistema: 3 falhas por login+IP ou 20 por IP em 15 min → bloqueio por 15 min. */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_LOGIN = 3;
const MAX_PER_IP = 20;
const failures = new Map<string, { count: number; first: number; until: number }>();

const SSO_MFA_TTL_MS = 5 * 60_000;
const SSO_MFA_MAX_TRIES = 3;
const ssoMfaPending = new Map<string, { userId: string; identity: SsoIdentity; exp: number; tries: number }>();

/** Acesso da central gravado na sessão local (única fonte de autorização). */
interface SessaoCentral {
  sid: string;
  isAdmin: boolean;
  permissoes: SsoIdentity["permissoes"];
  mfa: boolean;
}

export interface LocalLoginInput {
  login?: string;
  senha?: string;
  ssoMfaToken?: string;
  codigo?: string;
  mfaToken?: string;
  mfaCode?: string;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isBlocked(key: string): boolean {
  return (failures.get(key)?.until ?? 0) > Date.now();
}

function addFailure(key: string, max: number): void {
  const now = Date.now();
  let f = failures.get(key);
  if (!f || (now - f.first >= WINDOW_MS && f.until <= now)) f = { count: 0, first: now, until: 0 };
  f.count++;
  if (f.count >= max) f.until = now + WINDOW_MS;
  failures.set(key, f);
}

const blockedError = () => new DomainError(429, "TOO_MANY_ATTEMPTS", "Login bloqueado após 3 tentativas. Aguarde 15 minutos.");

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly guard: AuthGuard,
  ) {}

  ssoConfig() {
    return { url: config.sso.url, app: SSO_APP, local: config.sso.localLogin };
  }

  /**
   * "Usar conta local": CPF/e-mail + senha Veritech conferidos na central (`/sso/password`, `/2fa`).
   * Senha local do PreventBase não vale mais. Depois segue igual ao ticket (espelho, TOTP do app, sessão).
   */
  async login(input: LocalLoginInput) {
    if (!config.sso.localLogin) throw new DomainError(403, "LOCAL_LOGIN_DISABLED", "Login local desativado. Use o login único Veritech.");
    if (input.mfaToken) return this.finishSsoMfa(input.mfaToken, input.mfaCode);
    const c = ctx();
    const who = (input.login ?? "").trim().toLowerCase();
    const loginKey = `login:${c.ip}:${input.ssoMfaToken ? `2fa:${input.ssoMfaToken}` : who}`;
    const ipKey = `ip:${c.ip}`;
    if (isBlocked(loginKey) || isBlocked(ipKey)) throw blockedError();
    let result: Awaited<ReturnType<typeof ssoPassword>>;
    try {
      result = await ssoPassword(input.ssoMfaToken ? { mfaToken: input.ssoMfaToken, codigo: input.codigo ?? "" } : { login: who, senha: input.senha ?? "" }, c.ip);
    } catch (err) {
      if (err instanceof DomainError && err.status === 401) {
        addFailure(loginKey, MAX_PER_LOGIN);
        addFailure(ipKey, MAX_PER_IP);
        if (isBlocked(loginKey) || isBlocked(ipKey)) throw blockedError();
        if (input.ssoMfaToken) throw new DomainError(401, "SSO_MFA_INVALID", err.message, { ssoMfaToken: input.ssoMfaToken });
      }
      throw err;
    }
    failures.delete(loginKey);
    if ("mfaToken" in result) {
      throw new DomainError(401, "SSO_MFA_REQUIRED", "Informe o código do 2FA do login único Veritech", { ssoMfaToken: result.mfaToken });
    }
    return this.enter(result.identity);
  }

  /**
   * Login único Veritech: resgata o ticket na central e emite a sessão de sempre.
   * Segundo fator na central (`mfa` ou passkey) dispensa TOTP; sem ele, TOTP ativo é exigido (desafio via mfaToken, ticket é de uso único).
   */
  async loginSso(input: { ticket?: string; mfaToken?: string; mfaCode?: string }) {
    if (input.mfaToken) return this.finishSsoMfa(input.mfaToken, input.mfaCode);
    if (!input.ticket) throw new DomainError(400, "VALIDATION", "Ticket ausente");
    return this.enter(await ssoRedeem(input.ticket));
  }

  private async enter(identity: SsoIdentity) {
    const user = await this.ssoUser(identity);
    if (!identity.mfa && identity.metodo !== "passkey" && user.mfaEnabled) {
      const now = Date.now();
      for (const [k, p] of ssoMfaPending) if (p.exp <= now) ssoMfaPending.delete(k);
      const mfaToken = randomBytes(24).toString("base64url");
      ssoMfaPending.set(mfaToken, { userId: user.id, identity, exp: now + SSO_MFA_TTL_MS, tries: 0 });
      throw new DomainError(401, "MFA_REQUIRED", "Informe o código do autenticador", { mfaToken });
    }
    return this.completeSso(user.id, user.tenantId, identity, identity.mfa || identity.metodo === "passkey");
  }

  private async finishSsoMfa(mfaToken: string, mfaCode?: string) {
    const pending = ssoMfaPending.get(mfaToken);
    if (!pending || pending.exp <= Date.now()) {
      ssoMfaPending.delete(mfaToken);
      throw new DomainError(401, "SSO_INVALID", "Login único expirado. Entre novamente.");
    }
    if (!mfaCode) throw new DomainError(401, "MFA_REQUIRED", "Informe o código do autenticador", { mfaToken });
    const user = await this.prisma.user.findUnique({ where: { id: pending.userId } });
    if (!user || user.status !== "ACTIVE") {
      ssoMfaPending.delete(mfaToken);
      throw new DomainError(401, "SSO_INVALID", "Login único expirado. Entre novamente.");
    }
    if (user.mfaEnabled && !this.checkTotp(user.mfaSecret!, mfaCode)) {
      addFailure(`ip:${ctx().ip}`, MAX_PER_IP);
      if (++pending.tries >= SSO_MFA_MAX_TRIES) {
        ssoMfaPending.delete(mfaToken);
        throw blockedError();
      }
      throw new DomainError(401, "MFA_INVALID", "Código do autenticador inválido", { mfaToken });
    }
    ssoMfaPending.delete(mfaToken);
    return this.completeSso(user.id, user.tenantId, pending.identity, false);
  }

  private async completeSso(userId: string, tenantId: string, identity: SsoIdentity, centralMfa: boolean) {
    const tokens = await this.issue(userId, tenantId, randomUUID(), { sid: identity.sid, isAdmin: identity.isAdmin, permissoes: identity.permissoes, mfa: centralMfa });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ tenantId, userId, action: "auth.login", entityType: "User", entityId: userId, after: { method: "sso", via: identity.metodo, centralMfa, isAdmin: identity.isAdmin } });
    return tokens;
  }

  /**
   * Espelho local do usuário central: procura por CPF e depois por e-mail; não achou → cria ativo.
   * Todo login sincroniza nome/CPF/e-mail e reativa (quem decide o acesso é a central).
   */
  private async ssoUser(identity: SsoIdentity) {
    const noAccess = () => new DomainError(403, "SSO_NO_ACCESS", "Conta central sem CPF nem e-mail. Peça ajuste ao administrador do login único.");
    const cpf = /^\d{11}$/.test(identity.cpf) ? identity.cpf : null;
    const email = identity.email || null;
    if (!cpf && !email) throw noAccess();
    let user = cpf ? await this.prisma.user.findUnique({ where: { cpf } }) : null;
    user ??= email ? await this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }) : null;
    const name = identity.nome || email || cpf!;

    if (!user) {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true }, take: 2 });
      if (tenants.length !== 1) throw new DomainError(403, "SSO_NO_TENANT", "PreventBase sem empresa configurada para o login único.");
      const tenantId = tenants[0]!.id;
      user = await this.prisma.user.create({
        data: { tenantId, cpf, email: email ?? `${cpf}@sso.veritech.invalid`, name, passwordHash: `!sso:${randomBytes(24).toString("base64url")}` },
      });
      await this.audit.log({ tenantId, userId: user.id, action: "auth.sso_user_created", entityType: "User", entityId: user.id, after: { name, hasCpf: !!cpf, hasEmail: !!email } });
      return user;
    }

    const data: Prisma.UserUpdateInput = {};
    if (user.name !== name) data.name = name;
    if (cpf && user.cpf !== cpf) data.cpf = cpf;
    if (email && user.email !== email) {
      const taken = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, id: { not: user.id } }, select: { id: true } });
      if (!taken) data.email = email;
    }
    if (user.status !== "ACTIVE") data.status = "ACTIVE";
    if (Object.keys(data).length === 0) return user;
    const updated = await this.prisma.user.update({ where: { id: user.id }, data });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "auth.sso_user_synced",
      entityType: "User",
      entityId: user.id,
      after: { fields: Object.keys(data), reactivated: data.status === "ACTIVE" },
    });
    return updated;
  }

  private async issue(userId: string, tenantId: string, familyId: string, sso: SessaoCentral) {
    const c = ctx();
    const sessionId = randomUUID();
    const refreshToken = `${sessionId}.${randomBytes(32).toString("base64url")}`;
    await this.prisma.session.create({
      data: {
        id: sessionId,
        tenantId,
        userId,
        familyId,
        refreshTokenHash: sha(refreshToken),
        deviceId: c.deviceId,
        ip: c.ip,
        userAgent: c.userAgent,
        ssoSid: sso.sid,
        ssoIsAdmin: sso.isAdmin,
        ssoPermissoes: sso.permissoes as Prisma.InputJsonValue,
        ssoMfa: sso.mfa,
        expiresAt: new Date(Date.now() + config.refreshTtlDays * 86_400_000),
      },
    });
    const payload: AccessPayload = { sub: userId, tid: tenantId, sid: sessionId };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, refreshToken, expiresIn: config.accessTtlSeconds };
  }

  /**
   * Refresh rotativo: reuso de token já rotacionado revoga a família inteira.
   * Confere a sessão central: `active:false` encerra; `active:true` atualiza isAdmin/permissoes; central fora mantém.
   */
  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha(refreshToken) }, include: { user: true } });
    if (!session) throw new DomainError(401, "REFRESH_INVALID", "Sessão inválida");
    if (session.rotatedAt || session.revokedAt) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "refresh_reuse" } });
      this.guard.invalidate();
      await this.audit.log({ tenantId: session.tenantId, userId: session.userId, action: "auth.refresh_reuse_detected", entityType: "Session", entityId: session.familyId });
      throw new DomainError(401, "REFRESH_REUSED", "Sessão encerrada por segurança. Entre novamente.");
    }
    if (session.expiresAt < new Date() || session.user.status !== "ACTIVE" || !session.ssoSid) throw new DomainError(401, "REFRESH_EXPIRED", "Sessão expirada");
    const check = await ssoCheck(session.ssoSid);
    if (check && !check.active) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "sso_ended" } });
      this.guard.invalidate();
      throw new DomainError(401, "SSO_ENDED", "Sessão do login único encerrada. Entre novamente.");
    }
    const claimed = await this.prisma.session.updateMany({ where: { id: session.id, rotatedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date(), revokedReason: "rotated" } });
    if (claimed.count !== 1) throw new DomainError(401, "REFRESH_RACE", "Sessão já renovada");
    this.guard.invalidate(session.id);
    return this.issue(session.userId, session.tenantId, session.familyId, {
      sid: session.ssoSid,
      isAdmin: check ? check.isAdmin : session.ssoIsAdmin,
      permissoes: check ? check.permissoes : ((session.ssoPermissoes ?? {}) as SsoIdentity["permissoes"]),
      mfa: session.ssoMfa,
    });
  }

  async logout(): Promise<void> {
    const c = authed();
    const s = await this.prisma.session.findUnique({ where: { id: c.sessionId } });
    if (s) await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "logout" } });
    this.guard.invalidate(c.sessionId);
    await this.audit.log({ action: "auth.logout", entityType: "Session", entityId: c.sessionId });
  }

  async me() {
    const c = authed();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: c.userId },
      select: { id: true, name: true, email: true, mfaEnabled: true, employeeId: true, tenantId: true },
    });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { id: true, name: true, settings: true } });
    return {
      ...user,
      tenant,
      isAdmin: c.acesso.isAdmin,
      permissoes: c.acesso.permissoes,
      device: c.deviceId ? { id: c.deviceId, status: c.deviceStatus } : null,
    };
  }

  async sessions() {
    const c = authed();
    return this.prisma.session.findMany({
      where: { userId: c.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true, deviceId: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeSession(id: string): Promise<void> {
    const c = authed();
    const s = await this.prisma.session.findFirst({ where: { id, userId: c.userId } });
    if (!s) throw new DomainError(404, "NOT_FOUND", "Sessão não encontrada");
    await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "user_revoked" } });
    this.guard.invalidate();
    await this.audit.log({ action: "auth.session_revoked", entityType: "Session", entityId: id });
  }

  private checkTotp(secret: string, code: string): boolean {
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" });
    return totp.validate({ token: code.replace(/\s+/g, ""), window: 1 }) !== null;
  }

  async mfaSetup() {
    const c = authed();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    if (user.mfaEnabled) throw new DomainError(409, "MFA_ENABLED", "MFA já habilitado");
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ issuer: "PreventBase", label: user.email, secret, digits: 6, period: 30, algorithm: "SHA1" });
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret.base32 } });
    const uri = totp.toString();
    return { otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri) };
  }

  async mfaEnable(code: string): Promise<void> {
    const c = authed();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    if (!user.mfaSecret || !this.checkTotp(user.mfaSecret, code)) throw new DomainError(400, "MFA_INVALID", "Código inválido");
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
      await this.audit.record(tx, { action: "auth.mfa_enabled", entityType: "User", entityId: user.id });
    });
  }

  async mfaDisable(code: string): Promise<void> {
    const c = authed();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    if (!user.mfaEnabled || !user.mfaSecret || !this.checkTotp(user.mfaSecret, code)) throw new DomainError(400, "MFA_INVALID", "Código inválido");
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
      await this.audit.record(tx, { action: "auth.mfa_disabled", entityType: "User", entityId: user.id });
    });
  }
}
