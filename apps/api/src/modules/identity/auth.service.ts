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

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly guard: AuthGuard,
  ) {}

  private throttle(key: string): void {
    const now = Date.now();
    const a = attempts.get(key);
    if (a && now - a.first < WINDOW_MS && a.count >= MAX_ATTEMPTS) {
      throw new DomainError(429, "TOO_MANY_ATTEMPTS", "Muitas tentativas. Aguarde alguns minutos.");
    }
  }

  private fail(key: string): void {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || now - a.first >= WINDOW_MS) attempts.set(key, { count: 1, first: now });
    else a.count++;
  }

  async login(email: string, password: string, mfaCode?: string) {
    const c = ctx();
    const key = `${c.ip}:${email}`;
    this.throttle(key);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user && user.status === "ACTIVE" && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      this.fail(key);
      if (user) await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id });
      throw new DomainError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos");
    }
    if (user.mfaEnabled) {
      if (!mfaCode) throw new DomainError(401, "MFA_REQUIRED", "Informe o código do autenticador");
      if (!this.checkTotp(user.mfaSecret!, mfaCode)) {
        this.fail(key);
        throw new DomainError(401, "MFA_INVALID", "Código do autenticador inválido");
      }
    }
    attempts.delete(key);
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

  private async issue(userId: string, tenantId: string, familyId: string) {
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
    const claimed = await this.prisma.session.updateMany({ where: { id: session.id, rotatedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date(), revokedReason: "rotated" } });
    if (claimed.count !== 1) throw new DomainError(401, "REFRESH_RACE", "Sessão já renovada");
    this.guard.invalidate(session.id);
    return this.issue(session.userId, session.tenantId, session.familyId);
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
