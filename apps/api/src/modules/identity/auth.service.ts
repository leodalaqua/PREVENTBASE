import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { config } from "../../config.js";
import { AuditService } from "../../core/audit.service.js";
import { type AccessPayload, AuthGuard } from "../../core/auth.guard.js";
import { authed, ctx, DomainError } from "../../core/context.js";
import { PrismaService } from "../../core/prisma.service.js";
import { SSO_APP, type SsoIdentity, ssoCheck, ssoRedeem } from "./sso.js";

/** Padrão do ecossistema: 3 falhas por login+IP ou 20 por IP em 15 min → bloqueio por 15 min. */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_LOGIN = 3;
const MAX_PER_IP = 20;
const failures = new Map<string, { count: number; first: number; until: number }>();

const SSO_MFA_TTL_MS = 5 * 60_000;
const SSO_MFA_MAX_TRIES = 3;
const ssoMfaPending = new Map<string, { userId: string; sid: string; exp: number; tries: number }>();

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

  async login(email: string, password: string, mfaCode?: string) {
    if (!config.sso.localLogin) throw new DomainError(403, "LOCAL_LOGIN_DISABLED", "Login local desativado. Use o login único Veritech.");
    const c = ctx();
    const loginKey = `login:${c.ip}:${email}`;
    const ipKey = `ip:${c.ip}`;
    if (isBlocked(loginKey) || isBlocked(ipKey)) throw blockedError();
    const fail = (err: DomainError) => {
      addFailure(loginKey, MAX_PER_LOGIN);
      addFailure(ipKey, MAX_PER_IP);
      return isBlocked(loginKey) || isBlocked(ipKey) ? blockedError() : err;
    };
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user && user.status === "ACTIVE" && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      if (user) await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id });
      throw fail(new DomainError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos"));
    }
    if (user.mfaEnabled) {
      if (!mfaCode) throw new DomainError(401, "MFA_REQUIRED", "Informe o código do autenticador");
      if (!this.checkTotp(user.mfaSecret!, mfaCode)) throw fail(new DomainError(401, "MFA_INVALID", "Código do autenticador inválido"));
    }
    failures.delete(loginKey);
    const tokens = await this.issue(user.id, user.tenantId, randomUUID());
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
    return tokens;
  }

  /** Login por biometria (passkey): verificação do usuário no aparelho conta como 2 fatores, sem TOTP. */
  async loginWithPasskey(userId: string, credentialId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new DomainError(401, "INVALID_CREDENTIALS", "Usuário bloqueado");
    const tokens = await this.issue(user.id, user.tenantId, randomUUID());
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, after: { method: "passkey", credentialId: credentialId.slice(0, 12) } });
    return tokens;
  }

  /**
   * Login único Veritech: resgata o ticket na central e emite a sessão de sempre.
   * Segundo fator na central (`mfa` ou passkey) dispensa TOTP; sem ele, TOTP ativo é exigido (desafio via mfaToken, ticket é de uso único).
   */
  async loginSso(input: { ticket?: string; mfaToken?: string; mfaCode?: string }) {
    if (input.mfaToken) return this.finishSsoMfa(input.mfaToken, input.mfaCode);
    if (!input.ticket) throw new DomainError(400, "VALIDATION", "Ticket ausente");
    const identity = await ssoRedeem(input.ticket);
    const user = await this.ssoUser(identity);
    if (!identity.mfa && identity.metodo !== "passkey" && user.mfaEnabled) {
      const now = Date.now();
      for (const [k, p] of ssoMfaPending) if (p.exp <= now) ssoMfaPending.delete(k);
      const mfaToken = randomBytes(24).toString("base64url");
      ssoMfaPending.set(mfaToken, { userId: user.id, sid: identity.sid, exp: now + SSO_MFA_TTL_MS, tries: 0 });
      throw new DomainError(401, "MFA_REQUIRED", "Informe o código do autenticador", { mfaToken });
    }
    return this.completeSso(user.id, user.tenantId, identity.sid, identity.metodo, identity.mfa);
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
      throw new DomainError(403, "USER_BLOCKED", "Usuário bloqueado no PreventBase");
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
    return this.completeSso(user.id, user.tenantId, pending.sid, "senha", false);
  }

  private async completeSso(userId: string, tenantId: string, sid: string, metodo: SsoIdentity["metodo"], centralMfa: boolean) {
    const tokens = await this.issue(userId, tenantId, randomUUID(), sid);
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ tenantId, userId, action: "auth.login", entityType: "User", entityId: userId, after: { method: "sso", via: metodo, centralMfa } });
    return tokens;
  }

  /**
   * Usuário local por e-mail (o PreventBase não guarda CPF do usuário), sem senha utilizável.
   * Novo: nasce BLOCKED e sem perfil (pendente de liberação pelo admin); `isAdmin` central → Super Admin ativo.
   */
  private async ssoUser(identity: SsoIdentity) {
    const noAccess = () => new DomainError(403, "SSO_NO_ACCESS", "Usuário sem cadastro no PreventBase. Peça acesso ao administrador.");
    const pending = () => new DomainError(403, "SSO_PENDING", "Acesso criado. Aguarde a liberação do administrador.");
    if (!identity.email) throw noAccess();
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: identity.email, mode: "insensitive" } } });
    if (existing) {
      if (existing.status !== "ACTIVE") {
        const hasRole = await this.prisma.userRole.findFirst({ where: { userId: existing.id }, select: { id: true } });
        throw hasRole ? new DomainError(403, "USER_BLOCKED", "Usuário bloqueado no PreventBase") : pending();
      }
      if (identity.isAdmin) await this.ensureSsoAdmin(existing.id, existing.tenantId);
      return existing;
    }
    const tenants = await this.prisma.tenant.findMany({ select: { id: true }, take: 2 });
    if (tenants.length !== 1) throw noAccess();
    const tenantId = tenants[0]!.id;
    const adminRole = identity.isAdmin ? await this.prisma.role.findFirst({ where: { tenantId: null, key: "super_admin" } }) : null;
    if (identity.isAdmin && !adminRole) throw noAccess();
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: identity.email,
        name: identity.nome || identity.email,
        passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 12),
        ...(adminRole ? { roles: { create: [{ roleId: adminRole.id }] } } : { status: "BLOCKED" as const }),
      },
    });
    if (!adminRole) {
      await this.audit.log({ tenantId, userId: user.id, action: "auth.sso_user_pending", entityType: "User", entityId: user.id });
      throw pending();
    }
    await this.audit.log({ tenantId, userId: user.id, action: "auth.sso_user_created", entityType: "User", entityId: user.id, after: { role: adminRole.key } });
    return user;
  }

  private async ensureSsoAdmin(userId: string, tenantId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { tenantId: null, key: "super_admin" } });
    if (!role) return;
    const has = await this.prisma.userRole.findFirst({ where: { userId, roleId: role.id, companyId: null } });
    if (has) return;
    await this.prisma.userRole.create({ data: { userId, roleId: role.id } });
    this.guard.invalidate();
    await this.audit.log({ tenantId, userId, action: "auth.sso_admin_granted", entityType: "User", entityId: userId });
  }

  private async issue(userId: string, tenantId: string, familyId: string, ssoSid: string | null = null) {
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
        ssoSid,
        expiresAt: new Date(Date.now() + config.refreshTtlDays * 86_400_000),
      },
    });
    const payload: AccessPayload = { sub: userId, tid: tenantId, sid: sessionId };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, refreshToken, expiresIn: config.accessTtlSeconds };
  }

  /** Refresh rotativo: reuso de token já rotacionado revoga a família inteira. */
  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha(refreshToken) }, include: { user: true } });
    if (!session) throw new DomainError(401, "REFRESH_INVALID", "Sessão inválida");
    if (session.rotatedAt || session.revokedAt) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "refresh_reuse" } });
      this.guard.invalidate();
      await this.audit.log({ tenantId: session.tenantId, userId: session.userId, action: "auth.refresh_reuse_detected", entityType: "Session", entityId: session.familyId });
      throw new DomainError(401, "REFRESH_REUSED", "Sessão encerrada por segurança. Entre novamente.");
    }
    if (session.expiresAt < new Date() || session.user.status !== "ACTIVE") throw new DomainError(401, "REFRESH_EXPIRED", "Sessão expirada");
    if (session.ssoSid && (await ssoCheck(session.ssoSid)) === false) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "sso_ended" } });
      this.guard.invalidate();
      throw new DomainError(401, "SSO_ENDED", "Sessão do login único encerrada. Entre novamente.");
    }
    const claimed = await this.prisma.session.updateMany({ where: { id: session.id, rotatedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date(), revokedReason: "rotated" } });
    if (claimed.count !== 1) throw new DomainError(401, "REFRESH_RACE", "Sessão já renovada");
    this.guard.invalidate(session.id);
    return this.issue(session.userId, session.tenantId, session.familyId, session.ssoSid);
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
      select: { id: true, name: true, email: true, mfaEnabled: true, employeeId: true, tenantId: true, roles: { select: { companyId: true, establishmentId: true, role: { select: { key: true, name: true } } } } },
    });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { id: true, name: true, settings: true } });
    return {
      ...user,
      tenant,
      permissions: [...c.permissions].sort(),
      companyIds: c.companyIds,
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
