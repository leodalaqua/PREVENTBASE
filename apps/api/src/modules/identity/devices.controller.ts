import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { deviceRegisterSchema, deviceUpdateSchema } from "@preventbase/contracts";
import type { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Acesso, hashDeviceKey } from "../../core/auth.guard.js";
import { authed, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";

/** Dispositivos de entrega/biometria (§56). Usuários e acessos ficam só na central Veritech. */
@Controller()
export class DevicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
  @Acesso("administracao.dispositivos.visualizar")
  devices() {
    const { tenantId } = authed();
    return this.prisma.device.findMany({
      where: { tenantId },
      select: { id: true, name: true, model: true, platform: true, status: true, responsibleUserId: true, companyId: true, establishmentId: true, lastSeenAt: true, lastIp: true, approvedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  @Patch("devices/:id")
  @Acesso("administracao.dispositivos.atualizar")
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
