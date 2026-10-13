import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { cancelSchema, inventoryCountCreateSchema, inventoryCountItemsSchema } from "@preventbase/contracts";
import type { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Acesso } from "../../core/auth.guard.js";
import { authed, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";
import { StockService } from "./stock.service.js";

/** Inventário (§28): OPEN → COUNTING → (DIVERGENT) → APPROVED → CLOSED. Ajustes só na aprovação, via movimentos. */
@Controller("inventory-counts")
export class InventoryCountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  private async load(id: string) {
    const { tenantId } = authed();
    const count = await this.prisma.inventoryCount.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!count) throw notFound("Inventário");
    return count;
  }

  @Get()
  @Acesso("estoque.inventarios.visualizar")
  list() {
    const { tenantId } = authed();
    return this.prisma.inventoryCount.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { items: true } } }, take: 100 });
  }

  @Get(":id")
  @Acesso("estoque.inventarios.visualizar")
  async get(@Param("id") id: string) {
    const count = await this.load(id);
    const lots = await this.prisma.stockLot.findMany({
      where: { id: { in: count.items.map((i) => i.lotId) } },
      include: { variant: { include: { product: { select: { description: true } } } } },
    });
    const locations = await this.prisma.stockLocation.findMany({ where: { warehouseId: count.warehouseId } });
    const lotMap = new Map(lots.map((l) => [l.id, l]));
    const locMap = new Map(locations.map((l) => [l.id, l.code]));
    return {
      ...count,
      items: count.items.map((i) => ({
        ...i,
        lotNumber: lotMap.get(i.lotId)?.lotNumber,
        sku: lotMap.get(i.lotId)?.variant.sku,
        productDescription: lotMap.get(i.lotId)?.variant.product.description,
        locationCode: locMap.get(i.locationId),
      })),
    };
  }

  @Post()
  @Acesso("estoque.inventarios.inserir")
  async create(@Body(zod(inventoryCountCreateSchema)) body: z.infer<typeof inventoryCountCreateSchema>) {
    const { tenantId, userId } = authed();
    const wh = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, tenantId } });
    if (!wh) throw notFound("Almoxarifado");
    const open = await this.prisma.inventoryCount.findFirst({ where: { warehouseId: wh.id, status: { in: ["OPEN", "COUNTING", "DIVERGENT", "APPROVED"] } } });
    if (open) throw new DomainError(409, "COUNT_OPEN", "Já existe inventário em andamento neste almoxarifado", { id: open.id });
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.inventoryCount.create({ data: { tenantId, warehouseId: wh.id, doubleCount: body.doubleCount, notes: body.notes ?? null, openedById: userId } });
      await this.audit.record(tx, { action: "inventory.opened", entityType: "InventoryCount", entityId: count.id, after: count });
      return count;
    });
  }

  /** Congela o saldo do sistema (snapshot) e libera a contagem. */
  @Post(":id/start")
  @Acesso("estoque.inventarios.inserir")
  async start(@Param("id") id: string) {
    const count = await this.load(id);
    if (count.status !== "OPEN") throw new DomainError(409, "STATUS", "Inventário não está aberto");
    return this.prisma.$transaction(async (tx) => {
      const balances = await tx.stockBalance.findMany({ where: { warehouseId: count.warehouseId, quantity: { gt: 0 } } });
      await tx.inventoryCountItem.createMany({ data: balances.map((b) => ({ countId: id, lotId: b.lotId, locationId: b.locationId, systemQty: b.quantity })) });
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "COUNTING", startedAt: new Date() } });
      await this.audit.record(tx, { action: "inventory.started", entityType: "InventoryCount", entityId: id, after: { items: balances.length } });
      return updated;
    });
  }

  @Put(":id/items")
  @Acesso("estoque.inventarios.inserir")
  async count(@Param("id") id: string, @Body(zod(inventoryCountItemsSchema)) body: z.infer<typeof inventoryCountItemsSchema>) {
    const { userId } = authed();
    const count = await this.load(id);
    if (!["COUNTING", "DIVERGENT"].includes(count.status)) throw new DomainError(409, "STATUS", "Inventário não está em contagem");
    if (body.round === 2 && !count.doubleCount) throw new DomainError(422, "NO_DOUBLE", "Inventário sem dupla contagem");
    const ids = new Set(count.items.map((i) => i.id));
    await this.prisma.$transaction(async (tx) => {
      for (const item of body.items) {
        if (!ids.has(item.itemId)) throw new DomainError(422, "ITEM", "Item não pertence ao inventário");
        const prev = count.items.find((i) => i.id === item.itemId)!;
        if (body.round === 2 && prev.count1ById === userId) throw new DomainError(422, "SAME_COUNTER", "A segunda contagem deve ser feita por outra pessoa");
        await tx.inventoryCountItem.update({
          where: { id: item.itemId },
          data: body.round === 1 ? { count1: item.quantity, count1ById: userId } : { count2: item.quantity, count2ById: userId },
        });
      }
      if (count.status === "DIVERGENT") await tx.inventoryCount.update({ where: { id }, data: { status: "COUNTING" } });
      await this.audit.record(tx, { action: `inventory.count_round_${body.round}`, entityType: "InventoryCount", entityId: id, after: body.items });
    });
    return this.get(id);
  }

  /** Fecha a contagem: calcula finalQty. Contagens 1 e 2 diferentes → continua COUNTING (recontar); senão DIVERGENT (conferência p/ aprovação). */
  @Post(":id/submit")
  @Acesso("estoque.inventarios.inserir")
  async submit(@Param("id") id: string) {
    const count = await this.load(id);
    if (!["COUNTING", "DIVERGENT"].includes(count.status)) throw new DomainError(409, "STATUS", "Inventário não está em contagem");
    const missing = count.items.filter((i) => i.count1 === null || (count.doubleCount && i.count2 === null));
    if (missing.length > 0) throw new DomainError(422, "INCOMPLETE", `${missing.length} item(ns) sem contagem`);
    const conflicting = count.doubleCount ? count.items.filter((i) => i.count1 !== i.count2) : [];
    return this.prisma.$transaction(async (tx) => {
      for (const i of count.items) {
        await tx.inventoryCountItem.update({ where: { id: i.id }, data: { finalQty: conflicting.some((c) => c.id === i.id) ? null : i.count1 } });
      }
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: conflicting.length > 0 ? "COUNTING" : "DIVERGENT" } });
      await this.audit.record(tx, { action: "inventory.submitted", entityType: "InventoryCount", entityId: id, after: { conflicting: conflicting.length } });
      return { ...updated, conflictingItems: conflicting.length, readyForApproval: conflicting.length === 0 };
    });
  }

  /** Aprovação gera INVENTORY_IN/OUT pela diferença contada × saldo atual (movimentos durante a contagem são respeitados). */
  @Post(":id/approve")
  @Acesso("estoque.inventarios.atualizar")
  async approve(@Param("id") id: string) {
    const { tenantId, userId } = authed();
    const count = await this.load(id);
    if (count.status !== "DIVERGENT") throw new DomainError(409, "STATUS", "Envie a contagem antes de aprovar");
    if (count.items.some((i) => i.finalQty === null)) throw new DomainError(422, "CONFLICT", "Há itens com contagens divergentes — recontar");
    return this.prisma.$transaction(async (tx) => {
      const adjustments: Array<{ lotId: string; delta: number }> = [];
      for (const i of count.items) {
        const bal = await tx.stockBalance.findUnique({ where: { warehouseId_locationId_lotId: { warehouseId: count.warehouseId, locationId: i.locationId, lotId: i.lotId } } });
        const movedSinceSnapshot = (bal?.quantity ?? 0) - i.systemQty;
        const target = i.finalQty! + movedSinceSnapshot;
        const delta = target - (bal?.quantity ?? 0);
        if (delta !== 0) {
          await this.stock.move(tx, {
            tenantId,
            warehouseId: count.warehouseId,
            locationId: i.locationId,
            lotId: i.lotId,
            type: delta > 0 ? "INVENTORY_IN" : "INVENTORY_OUT",
            quantity: delta,
            referenceType: "InventoryCount",
            referenceId: id,
            reason: "Ajuste de inventário",
          });
          adjustments.push({ lotId: i.lotId, delta });
        }
      }
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() } });
      await this.audit.record(tx, { action: "inventory.approved", entityType: "InventoryCount", entityId: id, after: { adjustments } });
      return { ...updated, adjustments };
    });
  }

  @Post(":id/close")
  @Acesso("estoque.inventarios.atualizar")
  async close(@Param("id") id: string) {
    const count = await this.load(id);
    if (count.status !== "APPROVED") throw new DomainError(409, "STATUS", "Somente inventário aprovado pode ser encerrado");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
      await this.audit.record(tx, { action: "inventory.closed", entityType: "InventoryCount", entityId: id });
      return updated;
    });
  }

  @Post(":id/cancel")
  @Acesso("estoque.inventarios.excluir")
  async cancel(@Param("id") id: string, @Body(zod(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    const count = await this.load(id);
    if (["APPROVED", "CLOSED", "CANCELLED"].includes(count.status)) throw new DomainError(409, "STATUS", "Inventário não pode ser cancelado");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date(), notes: [count.notes, `Cancelado: ${body.reason}`].filter(Boolean).join("\n") } });
      await this.audit.record(tx, { action: "inventory.cancelled", entityType: "InventoryCount", entityId: id, after: body });
      return updated;
    });
  }
}
