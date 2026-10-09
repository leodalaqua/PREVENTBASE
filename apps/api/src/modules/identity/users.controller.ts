import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { deviceRegisterSchema, deviceUpdateSchema, paginationSchema, userCreateSchema, userUpdateSchema } from "@preventbase/contracts";
import bcrypt from "bcryptjs";
import type { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { AuthGuard, hashDeviceKey, RequirePermissions } from "../../core/auth.guard.js";
import { authed, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";

const userSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  mfaEnabled: true,
  employeeId: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { id: true, companyId: true, establishmentId: true, role: { select: { key: true, name: true } } } },
} as const;

@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guard: AuthGuard,
  ) {}

  @Get("roles")
  @RequirePermissions("users.view")
  roles() {
    const { tenantId } = authed();
    return this.prisma.role.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      select: { id: true, key: true, name: true, system: true, permissions: { select: { permission: { select: { key: true } } } } },
      orderBy: { name: "asc" },
    });
  }

  @Get("users")
  @RequirePermissions("users.view")
  list(@Query(zod(paginationSchema)) q: z.infer<typeof paginationSchema>) {
    const { tenantId } = authed();
    return this.prisma.user.findMany({
      where: { tenantId, ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } : {}) },
      select: userSelect,
      orderBy: { name: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
  }

  private async resolveRoles(tenantId: string, roles: Array<{ roleKey: string; companyId?: string | null; establishmentId?: string | null }>) {
    const found = await this.prisma.role.findMany({ where: { key: { in: roles.map((r) => r.roleKey) }, OR: [{ tenantId: null }, { tenantId }] } });
    const actor = authed();
    return roles.map((r) => {
      const role = found.find((f) => f.key === r.roleKey);
      if (!role) throw new DomainError(400, "ROLE_INVALID", `Perfil inválido: ${r.roleKey}`);
      if (role.key === "super_admin" && !actor.permissions.has("tenant.manage")) throw new DomainError(403, "FORBIDDEN", "Somente Super Admin concede Super Admin");
      return { roleId: role.id, companyId: r.companyId ?? null, establishmentId: r.establishmentId ?? null };
    });
  }

  @Post("users")
  @RequirePermissions("users.manage")
  async create(@Body(zod(userCreateSchema)) body: z.infer<typeof userCreateSchema>) {
    const { tenantId } = authed();
    const roles = await this.resolveRoles(tenantId, body.roles);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, name: body.name, email: body.email, employeeId: body.employeeId ?? null, passwordHash: await bcrypt.hash(body.password, 12), roles: { create: roles } },
        select: userSelect,
      });
      await this.audit.record(tx, { action: "user.created", entityType: "User", entityId: user.id, after: user });
      return user;
    });
  }

  @Patch("users/:id")
  @RequirePermissions("users.manage")
  async update(@Param("id") id: string, @Body(zod(userUpdateSchema)) body: z.infer<typeof userUpdateSchema>) {
    const { tenantId } = authed();
    const before = await this.prisma.user.findFirst({ where: { id, tenantId }, select: userSelect });
    if (!before) throw notFound("Usuário");
    const roles = body.roles ? await this.resolveRoles(tenantId, body.roles) : undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      if (roles) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ ...r, userId: id })) });
      }
      const user = await tx.user.update({
        where: { id },
        data: {
          name: body.name,
          status: body.status,
          passwordHash: body.password ? await bcrypt.hash(body.password, 12) : undefined,
        },
        select: userSelect,
      });
      if (body.status === "BLOCKED" || body.password) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "admin_change" } });
        await tx.webauthnCredential.deleteMany({ where: { userId: id } });
      }
      await this.audit.record(tx, { action: "user.updated", entityType: "User", entityId: id, before, after: { ...user, passwordChanged: !!body.password } });
      return user;
    });
    this.guard.invalidate();
    return result;
  }

  /* ---------- devices (§56) ---------- */

  @Post("devices/register")
  async registerDevice(@Body(zod(deviceRegisterSchema)) body: z.infer<typeof deviceRegisterSchema>) {
    const c = authed();
    const deviceKeyHash = hashDeviceKey(body.deviceKey);
    const existing = await this.prisma.device.findUnique({ where: { tenantId_deviceKeyHash: { tenantId: c.tenantId, deviceKeyHash } } });
    if (existing) return { id: existing.id, status: existing.status, name: existing.name };
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.device.create({
        data: { tenantId: c.tenantId, deviceKeyHash, name: body.name, model: body.model, platform: body.platform, responsibleUserId: c.userId, lastIp: c.ip, lastSeenAt: new Date() },
      });
      await this.audit.record(tx, { action: "device.registered", entityType: "Device", entityId: device.id, after: { name: device.name, model: device.model, platform: device.platform } });
      return { id: device.id, status: device.status, name: device.name };
    });
  }

  @Get("devices")
  @RequirePermissions("devices.view")
  devices() {
    const { tenantId } = authed();
    return this.prisma.device.findMany({
      where: { tenantId },
      select: { id: true, name: true, model: true, platform: true, status: true, responsibleUserId: true, companyId: true, establishmentId: true, lastSeenAt: true, lastIp: true, approvedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  @Patch("devices/:id")
  @RequirePermissions("devices.manage")
  async updateDevice(@Param("id") id: string, @Body(zod(deviceUpdateSchema)) body: z.infer<typeof deviceUpdateSchema>) {
    const c = authed();
    const before = await this.prisma.device.findFirst({ where: { id, tenantId: c.tenantId } });
    if (!before) throw notFound("Dispositivo");
    return this.prisma.$transaction(async (tx) => {
      const device = await tx.device.update({
        where: { id },
        data: {
          status: body.status,
          name: body.name,
          companyId: body.companyId,
          establishmentId: body.establishmentId,
          ...(body.status === "TRUSTED" && before.status !== "TRUSTED" ? { approvedById: c.userId, approvedAt: new Date() } : {}),
        },
        select: { id: true, name: true, status: true, approvedAt: true },
      });
      await this.audit.record(tx, { action: "device.updated", entityType: "Device", entityId: id, before: { status: before.status, name: before.name }, after: device });
      return device;
    });
  }
}
