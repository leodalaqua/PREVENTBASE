import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { returnCreateSchema, returnStepSchema } from "@preventbase/contracts";
import type { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { RequirePermissions } from "../../core/auth.guard.js";
import { assertCompanyAccess, authed, companyScope, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";
import { StockService } from "../inventory/stock.service.js";

/**
 * Devolução (§29) e ciclo de higienização/manutenção (§30).
 * Só volta ao estoque (movimento RETURN) quando liberado: direto se REUSABLE+GOOD, ou após etapa RELEASED.
 */
@Controller("returns")
export class ReturnsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("epi.view")
  list(@Query("employeeId") employeeId?: string, @Query("stage") stage?: string) {
    const { tenantId } = authed();
    return this.prisma.epiReturn.findMany({
      where: { tenantId, ...companyScope(), ...(employeeId ? { employeeId } : {}), ...(stage ? { stage } : {}) },
      include: { employee: { select: { id: true, name: true, registration: true } }, steps: { orderBy: { performedAt: "asc" } } },
      orderBy: { returnedAt: "desc" },
      take: 200,
    });
  }

  @Post()
  @RequirePermissions("epi.return")
  async create(@Body(zod(returnCreateSchema)) body: z.infer<typeof returnCreateSchema>) {
    const { tenantId, userId } = authed();
    const employee = await this.prisma.employee.findFirst({ where: { id: body.employeeId, tenantId } });
    if (!employee) throw notFound("Colaborador");
    assertCompanyAccess(employee.companyId);
    const wh = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, tenantId } });
    if (!wh) throw notFound("Almoxarifado");
    let lotId = body.lotId ?? null;
    if (body.deliveryItemId) {
      const item = await this.prisma.epiDeliveryItem.findFirst({ where: { id: body.deliveryItemId, tenantId, employeeId: employee.id } });
      if (!item) throw new DomainError(422, "ITEM", "Item de entrega não pertence ao colaborador");
      if (item.variantId !== body.variantId) throw new DomainError(422, "ITEM", "Variação diferente do item entregue");
      lotId = lotId ?? item.lotId;
    }
    const backToStock = body.destination === "REUSABLE" && body.condition === "GOOD";
    if (backToStock && !lotId) throw new DomainError(422, "LOT_REQUIRED", "Informe o lote para retornar ao estoque");
    const stage = body.destination === "DISCARDED" ? "DISCARDED" : backToStock ? "RELEASED" : body.destination === "REUSABLE" ? "INSPECTION" : body.destination;

    return this.prisma.$transaction(async (tx) => {
      const ret = await tx.epiReturn.create({
        data: {
          tenantId,
          companyId: employee.companyId,
          establishmentId: employee.establishmentId,
          employeeId: employee.id,
          deliveryItemId: body.deliveryItemId ?? null,
          variantId: body.variantId,
          lotId,
          warehouseId: wh.id,
          quantity: body.quantity,
          condition: body.condition,
          destination: body.destination,
          reason: body.reason,
          notes: body.notes ?? null,
          stage,
          receivedById: userId,
        },
      });
      await tx.epiReturnStep.create({ data: { returnId: ret.id, step: "RECEIVED", notes: body.notes ?? null, performedById: userId } });
      let movementId: string | null = null;
      if (backToStock) {
        const locationId = await this.stock.defaultLocation(tx, tenantId, wh.id);
        movementId = (await this.stock.move(tx, { tenantId, warehouseId: wh.id, locationId, lotId: lotId!, type: "RETURN", quantity: body.quantity, referenceType: "EpiReturn", referenceId: ret.id, reason: body.reason })).movementId;
        await tx.epiReturn.update({ where: { id: ret.id }, data: { stockMovementId: movementId } });
        await tx.epiReturnStep.create({ data: { returnId: ret.id, step: "RELEASED", notes: "Retorno direto ao estoque", performedById: userId } });
      }
      await this.audit.record(tx, { action: "epi.returned", entityType: "EpiReturn", entityId: ret.id, after: { ...ret, movementId } });
      return { ...ret, stockMovementId: movementId };
    });
  }

  @Post(":id/steps")
  @RequirePermissions("epi.return")
  async step(@Param("id") id: string, @Body(zod(returnStepSchema)) body: z.infer<typeof returnStepSchema>) {
    const { tenantId, userId } = authed();
    const ret = await this.prisma.epiReturn.findFirst({ where: { id, tenantId } });
    if (!ret) throw notFound("Devolução");
    if (["RELEASED", "DISCARDED"].includes(ret.stage)) throw new DomainError(409, "FINAL", "Devolução já finalizada");
    if (body.step === "RELEASED" && !ret.lotId) throw new DomainError(422, "LOT_REQUIRED", "Devolução sem lote não pode voltar ao estoque");
    return this.prisma.$transaction(async (tx) => {
      await tx.epiReturnStep.create({ data: { returnId: id, step: body.step, notes: body.notes ?? null, performedById: userId } });
      let movementId: string | null = null;
      if (body.step === "RELEASED") {
        const locationId = await this.stock.defaultLocation(tx, tenantId, ret.warehouseId);
        movementId = (await this.stock.move(tx, { tenantId, warehouseId: ret.warehouseId, locationId, lotId: ret.lotId!, type: "RETURN", quantity: ret.quantity, referenceType: "EpiReturn", referenceId: id, reason: "Liberado após higienização/inspeção" })).movementId;
      }
      const updated = await tx.epiReturn.update({ where: { id }, data: { stage: body.step, ...(movementId ? { stockMovementId: movementId } : {}) } });
      await this.audit.record(tx, { action: `epi.return_${body.step.toLowerCase()}`, entityType: "EpiReturn", entityId: id, before: { stage: ret.stage }, after: { stage: body.step, movementId } });
      return updated;
    });
  }
}
