import { createHash } from "node:crypto";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { PermissionKey } from "@preventbase/permissions";
import type { Request } from "express";
import { ctx, DomainError } from "./context.js";
import { PrismaService } from "./prisma.service.js";

export const IS_PUBLIC = "pb:public";
export const PERMS = "pb:perms";
export const TRUSTED_DEVICE = "pb:trusted-device";

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(PERMS, perms);
/** Exige dispositivo confiável quando o tenant tem requireTrustedDevice (biometria/entrega, §56). */
export const RequireTrustedDevice = () => SetMetadata(TRUSTED_DEVICE, true);

export interface AccessPayload {
  sub: string;
  tid: string;
  sid: string;
}

interface CachedPrincipal {
  at: number;
  permissions: Set<PermissionKey>;
  companyIds: string[] | null;
  sessionOk: boolean;
  requireTrustedDevice: boolean;
}

const CACHE_MS = 15_000;

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(`pb-device:${key}`).digest("hex");
}

@Injectable()
export class AuthGuard implements CanActivate {
  private cache = new Map<string, CachedPrincipal>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  invalidate(sessionId?: string): void {
    if (!sessionId) this.cache.clear();
    else this.cache.delete(sessionId);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.access_token as string | undefined);
    if (!token) throw new DomainError(401, "UNAUTHENTICATED", "Autenticação necessária");

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new DomainError(401, "TOKEN_INVALID", "Sessão expirada ou inválida");
    }

    const principal = await this.loadPrincipal(payload);
    if (!principal.sessionOk) throw new DomainError(401, "SESSION_REVOKED", "Sessão encerrada");

    const c = ctx();
    c.userId = payload.sub;
    c.tenantId = payload.tid;
    c.sessionId = payload.sid;
    c.permissions = principal.permissions;
    c.companyIds = principal.companyIds;

    if (c.deviceKey) {
      const device = await this.prisma.device.findUnique({
        where: { tenantId_deviceKeyHash: { tenantId: payload.tid, deviceKeyHash: hashDeviceKey(c.deviceKey) } },
        select: { id: true, status: true, lastSeenAt: true },
      });
      if (device) {
        c.deviceId = device.id;
        c.deviceStatus = device.status;
        if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
          await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastIp: c.ip } });
        }
      }
    }

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMS, targets) ?? [];
    const missing = required.filter((p) => !principal.permissions.has(p));
    if (missing.length > 0) throw new DomainError(403, "FORBIDDEN", `Permissão necessária: ${missing.join(", ")}`);

    if (this.reflector.getAllAndOverride<boolean>(TRUSTED_DEVICE, targets) && principal.requireTrustedDevice) {
      if (c.deviceStatus !== "TRUSTED") {
        throw new DomainError(
          403,
          "DEVICE_NOT_TRUSTED",
          c.deviceId ? "Dispositivo aguardando aprovação de um administrador" : "Dispositivo não registrado — registre este aparelho antes de usar biometria",
        );
      }
    }
    return true;
  }

  private async loadPrincipal(p: AccessPayload): Promise<CachedPrincipal> {
    const cached = this.cache.get(p.sid);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached;

    const [session, roles, tenant] = await Promise.all([
      this.prisma.session.findUnique({ where: { id: p.sid }, select: { revokedAt: true, expiresAt: true, userId: true, user: { select: { status: true } } } }),
      this.prisma.userRole.findMany({
        where: { userId: p.sub },
        select: { companyId: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
      }),
      this.prisma.tenant.findUnique({ where: { id: p.tid }, select: { settings: true } }),
    ]);

    const sessionOk = !!session && !session.revokedAt && session.expiresAt > new Date() && session.userId === p.sub && session.user.status === "ACTIVE";
    const permissions = new Set<PermissionKey>();
    let all = false;
    const companies = new Set<string>();
    for (const r of roles) {
      for (const rp of r.role.permissions) permissions.add(rp.permission.key as PermissionKey);
      if (!r.companyId) all = true;
      else companies.add(r.companyId);
    }
    const settings = (tenant?.settings ?? {}) as { requireTrustedDevice?: boolean };
    const principal: CachedPrincipal = {
      at: Date.now(),
      permissions,
      companyIds: all ? null : [...companies],
      sessionOk,
      requireTrustedDevice: settings.requireTrustedDevice !== false,
    };
    this.cache.set(p.sid, principal);
    return principal;
  }
}
