import { randomBytes } from "node:crypto";
import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import {
  locationSchema,
  normalizeCaNumber,
  paginationSchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  stockLevelSchema,
  stockTransferSchema,
  warehouseSchema,
} from "@preventbase/contracts";
import { expiringLots, lowStock, type MovementType, type Prisma } from "@preventbase/database";
import { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Acesso } from "../../core/auth.guard.js";
import { authed, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { IdempotencyService } from "../../core/idempotency.service.js";
import { PrismaService } from "../../core/prisma.service.js";
import { StockService } from "./stock.service.js";

const date = (v?: string | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

export function lotPublicCode(): string {
  return `L${randomBytes(6).toString("hex").toUpperCase()}`;
}

const balancesQuery = z.object({
  warehouseId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  onlyPositive: z.coerce.boolean().default(true),
});

const movementsQuery = paginationSchema.extend({
  warehouseId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

@Controller("stock")
export class StockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly idem: IdempotencyService,
  ) {}

  /* ---------- almoxarifados (§27) ---------- */

  @Get("warehouses")
  @Acesso("*")
  warehouses() {
    const { tenantId } = authed();
    return this.prisma.warehouse.findMany({
      where: { tenantId },
      include: { establishment: { select: { name: true } }, locations: { where: { active: true }, orderBy: { code: "asc" } } },
      orderBy: { name: "asc" },
    });
  }

  @Post("warehouses")
  @Acesso("administracao.almoxarifados.inserir")
  async createWarehouse(@Body(zod(warehouseSchema)) body: z.infer<typeof warehouseSchema>) {
    const { tenantId } = authed();
    const est = await this.prisma.establishment.findFirst({ where: { id: body.establishmentId, tenantId } });
    if (!est) throw notFound("Estabelecimento");
    return this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.create({
        data: { tenantId, companyId: est.companyId, ...body, locations: { create: [{ tenantId, code: "GERAL", description: "Localização padrão", isDefault: true }] } },
        include: { locations: true },
      });
      await this.audit.record(tx, { action: "warehouse.created", entityType: "Warehouse", entityId: wh.id, after: wh });
      return wh;
    });
  }

  @Post("warehouses/:id/locations")
  @Acesso("administracao.almoxarifados.inserir")
  async createLocation(@Param("id") id: string, @Body(zod(locationSchema)) body: z.infer<typeof locationSchema>) {
    const { tenantId } = authed();
    const wh = await this.prisma.warehouse.findFirst({ where: { id, tenantId } });
    if (!wh) throw notFound("Almoxarifado");
    return this.prisma.$transaction(async (tx) => {
      const loc = await tx.stockLocation.create({ data: { tenantId, warehouseId: id, code: body.code.toUpperCase(), description: body.description ?? null } });
      await this.audit.record(tx, { action: "location.created", entityType: "StockLocation", entityId: loc.id, after: loc });
      return loc;
    });
  }

  /* ---------- entrada (§14, §19) ---------- */

  @Post("entries")
  @Acesso("estoque.saldos.inserir")
  entry(@Body(zod(stockEntrySchema)) body: z.infer<typeof stockEntrySchema>, @Headers("idempotency-key") key?: string) {
    return this.idem.run("stock.entry", key, body, () => this.doEntry(body));
  }

  private async doEntry(body: z.infer<typeof stockEntrySchema>) {
    const { tenantId, userId } = authed();
    const variant = await this.prisma.epiVariant.findFirst({ where: { id: body.variantId, tenantId }, include: { product: true } });
    if (!variant) throw notFound("Variação de EPI");
    const wh = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, tenantId } });
    if (!wh) throw notFound("Almoxarifado");

    const caNumber = normalizeCaNumber(body.caNumber);
    const purchaseDate = date(body.purchaseDate)!;
    const ca = await this.prisma.caMaster.findUnique({ where: { caNumber } });
    const caValidityAtPurchase = date(body.caValidityAtPurchase) ?? ca?.validUntil ?? null;
    const caValidAtPurchase = caValidityAtPurchase ? purchaseDate.getTime() <= caValidityAtPurchase.getTime() : null;
    const warnings: string[] = [];
    if (!ca) warnings.push(`CA ${caNumber} não encontrado na base CAEPI local — validade na compra ${caValidityAtPurchase ? "informada manualmente" : "não verificada"}`);
    if (caValidAtPurchase === false) warnings.push(`CA ${caNumber} estava vencido na data da compra: lote bloqueado para entrega (NR-6)`);
    const expiry = date(body.expiryDate);
    if (expiry && expiry < purchaseDate) throw new DomainError(422, "EXPIRY_BEFORE_PURCHASE", "Validade do lote anterior à compra");

    return this.prisma.$transaction(async (tx) => {
      let lot = await tx.stockLot.findUnique({ where: { tenantId_variantId_lotNumber_caNumber: { tenantId, variantId: variant.id, lotNumber: body.lotNumber, caNumber } } });
      if (!lot) {
        lot = await tx.stockLot.create({
          data: {
            tenantId,
            companyId: wh.companyId,
            productId: variant.productId,
            variantId: variant.id,
            lotNumber: body.lotNumber,
            caNumber,
            manufactureDate: date(body.manufactureDate),
            expiryDate: expiry,
            purchaseDate,
            caValidityAtPurchase,
            caValidAtPurchase,
            unitCost: body.unitCost ?? variant.product.unitCost,
            supplier: body.supplier ?? null,
            invoiceNumber: body.invoiceNumber ?? null,
            publicCode: lotPublicCode(),
            createdById: userId,
          },
        });
      }
      const locationId = body.locationId ?? (await this.stock.defaultLocation(tx, tenantId, wh.id));
      const mv = await this.stock.move(tx, {
        tenantId,
        warehouseId: wh.id,
        locationId,
        lotId: lot.id,
        type: "ENTRY",
        quantity: body.quantity,
        referenceType: "StockEntry",
        reason: [body.invoiceNumber ? `NF ${body.invoiceNumber}` : null, body.notes].filter(Boolean).join(" — ") || null,
        unitCost: body.unitCost ?? null,
      });
      await this.audit.record(tx, { action: "stock.entry", entityType: "StockLot", entityId: lot.id, after: { lot, quantity: body.quantity, movementId: mv.movementId, warnings } });
      return { lot, movementId: mv.movementId, balanceAfter: mv.balanceAfter, warnings };
    });
  }

  /* ---------- consultas ---------- */

  @Get("lots")
  @Acesso("estoque.saldos.visualizar", "entregas.entregas.inserir")
  lots(@Query("variantId") variantId?: string, @Query("q") q?: string) {
    const { tenantId } = authed();
    return this.prisma.stockLot.findMany({
      where: {
        tenantId,
        ...(variantId ? { variantId } : {}),
        ...(q ? { OR: [{ lotNumber: { contains: q, mode: "insensitive" } }, { publicCode: q.toUpperCase() }, { caNumber: normalizeCaNumber(q) || "-" }] } : {}),
      },
      include: { variant: { include: { product: { select: { description: true, internalCode: true } } } }, balances: { where: { quantity: { gt: 0 } } } },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      take: 200,
    });
  }

  @Get("balances")
  @Acesso("estoque.saldos.visualizar")
  balances(@Query(zod(balancesQuery)) q: z.infer<typeof balancesQuery>) {
    const { tenantId } = authed();
    return this.prisma.stockBalance.findMany({
      where: {
        tenantId,
        ...(q.onlyPositive ? { quantity: { gt: 0 } } : {}),
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        lot: { ...(q.variantId ? { variantId: q.variantId } : {}), ...(q.productId ? { productId: q.productId } : {}) },
      },
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, code: true } },
        lot: { include: { variant: { include: { product: { select: { id: true, description: true, internalCode: true, category: true } } } } } },
      },
      orderBy: [{ lot: { expiryDate: "asc" } }],
      take: 1000,
    });
  }

  @Get("fefo")
  @Acesso("estoque.saldos.visualizar", "entregas.entregas.inserir")
  async fefo(@Query("warehouseId") warehouseId: string, @Query("variantId") variantId: string, @Query("quantity") quantity?: string) {
    const { tenantId } = authed();
    if (!warehouseId || !variantId) throw new DomainError(400, "PARAMS", "warehouseId e variantId são obrigatórios");
    const candidates = await this.stock.fefo(this.prisma, tenantId, warehouseId, variantId, Number(quantity ?? 1));
    return { suggestion: candidates[0] ?? null, candidates };
  }

  @Get("movements")
  @Acesso("estoque.saldos.visualizar")
  async movements(@Query(zod(movementsQuery)) q: z.infer<typeof movementsQuery>) {
    const { tenantId } = authed();
    const where: Prisma.StockMovementWhereInput = {
      tenantId,
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.lotId ? { lotId: q.lotId } : {}),
      ...(q.type ? { type: q.type as MovementType } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const lotIds = [...new Set(items.map((i) => i.lotId))];
    const whIds = [...new Set(items.map((i) => i.warehouseId))];
    const [lots, whs] = await Promise.all([
      this.prisma.stockLot.findMany({ where: { id: { in: lotIds } }, include: { variant: { include: { product: { select: { description: true } } } } } }),
      this.prisma.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true } }),
    ]);
    const lotMap = new Map(lots.map((l) => [l.id, l]));
    const whMap = new Map(whs.map((w) => [w.id, w.name]));
    return {
      items: items.map((m) => ({
        ...m,
        lotNumber: lotMap.get(m.lotId)?.lotNumber,
        sku: lotMap.get(m.lotId)?.variant.sku,
        productDescription: lotMap.get(m.lotId)?.variant.product.description,
        warehouseName: whMap.get(m.warehouseId),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /* ---------- transferência / ajuste ---------- */

  @Post("transfers")
  @Acesso("estoque.saldos.inserir")
  transfer(@Body(zod(stockTransferSchema)) body: z.infer<typeof stockTransferSchema>, @Headers("idempotency-key") key?: string) {
    return this.idem.run("stock.transfer", key, body, async () => {
      const { tenantId, userId } = authed();
      if (body.fromWarehouseId === body.toWarehouseId) throw new DomainError(422, "SAME_WAREHOUSE", "Origem e destino iguais");
      const [from, to] = await Promise.all([
        this.prisma.warehouse.findFirst({ where: { id: body.fromWarehouseId, tenantId } }),
        this.prisma.warehouse.findFirst({ where: { id: body.toWarehouseId, tenantId } }),
      ]);
      if (!from || !to) throw notFound("Almoxarifado");
      return this.prisma.$transaction(async (tx) => {
        const transfer = await tx.stockTransfer.create({ data: { tenantId, fromWarehouseId: from.id, toWarehouseId: to.id, notes: body.notes ?? null, createdById: userId } });
        const toLocation = body.toLocationId ?? (await this.stock.defaultLocation(tx, tenantId, to.id));
        for (const item of body.items) {
          const fromLocation = item.locationId ?? (await this.stock.locateLot(tx, from.id, item.lotId, item.quantity))?.locationId;
          if (!fromLocation) throw new DomainError(422, "STOCK_INSUFFICIENT", "Lote sem saldo suficiente na origem", { lotId: item.lotId });
          await this.stock.move(tx, { tenantId, warehouseId: from.id, locationId: fromLocation, lotId: item.lotId, type: "TRANSFER_OUT", quantity: -item.quantity, referenceType: "StockTransfer", referenceId: transfer.id });
          await this.stock.move(tx, { tenantId, warehouseId: to.id, locationId: toLocation, lotId: item.lotId, type: "TRANSFER_IN", quantity: item.quantity, referenceType: "StockTransfer", referenceId: transfer.id });
        }
        await this.audit.record(tx, { action: "stock.transfer", entityType: "StockTransfer", entityId: transfer.id, after: { ...transfer, items: body.items } });
        return transfer;
      });
    });
  }

  @Post("adjustments")
  @Acesso("estoque.saldos.alterar")
  adjust(@Body(zod(stockAdjustmentSchema)) body: z.infer<typeof stockAdjustmentSchema>, @Headers("idempotency-key") key?: string) {
    return this.idem.run("stock.adjustment", key, body, async () => {
      const { tenantId } = authed();
      const wh = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, tenantId } });
      if (!wh) throw notFound("Almoxarifado");
      const sign = body.type === "ADJUSTMENT_IN" ? 1 : -1;
      return this.prisma.$transaction(async (tx) => {
        const locationId =
          body.locationId ?? (sign > 0 ? await this.stock.defaultLocation(tx, tenantId, wh.id) : (await this.stock.locateLot(tx, wh.id, body.lotId, body.quantity))?.locationId);
        if (!locationId) throw new DomainError(422, "STOCK_INSUFFICIENT", "Lote sem saldo suficiente para o ajuste");
        const mv = await this.stock.move(tx, { tenantId, warehouseId: wh.id, locationId, lotId: body.lotId, type: body.type, quantity: sign * body.quantity, referenceType: "Adjustment", reason: body.reason });
        await this.audit.record(tx, { action: `stock.${body.type.toLowerCase()}`, entityType: "StockLot", entityId: body.lotId, after: { ...body, movementId: mv.movementId, balanceAfter: mv.balanceAfter } });
        return mv;
      });
    });
  }

  /* ---------- mínimo/máximo e alertas (§16) ---------- */

  @Get("levels")
  @Acesso("estoque.saldos.visualizar")
  levels(@Query("warehouseId") warehouseId?: string) {
    const { tenantId } = authed();
    return this.prisma.stockLevel.findMany({
      where: { tenantId, ...(warehouseId ? { warehouseId } : {}) },
      include: { variant: { include: { product: { select: { description: true } } } } },
    });
  }

  @Post("levels")
  @Acesso("estoque.saldos.alterar")
  setLevel(@Body(zod(stockLevelSchema)) body: z.infer<typeof stockLevelSchema>) {
    const { tenantId } = authed();
    return this.prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.upsert({
        where: { warehouseId_variantId: { warehouseId: body.warehouseId, variantId: body.variantId } },
        update: { minQty: body.minQty, maxQty: body.maxQty ?? null, leadTimeDays: body.leadTimeDays ?? null },
        create: { tenantId, ...body, maxQty: body.maxQty ?? null, leadTimeDays: body.leadTimeDays ?? null },
      });
      await this.audit.record(tx, { action: "stock.level_set", entityType: "StockLevel", entityId: level.id, after: level });
      return level;
    });
  }

  @Get("alerts")
  @Acesso("estoque.saldos.visualizar")
  async alerts(@Query("days") days?: string) {
    const { tenantId } = authed();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const window = Number(days ?? (tenant.settings as { lotExpiryAlertDays?: number }).lotExpiryAlertDays ?? 60);
    const [low, expiring] = await Promise.all([lowStock(this.prisma, tenantId), expiringLots(this.prisma, tenantId, window)]);
    return { lowStock: low, expiringLots: expiring.filter((l) => !l.expired), expiredLots: expiring.filter((l) => l.expired), windowDays: window };
  }

  @Patch("lots/:id")
  @Acesso("estoque.saldos.alterar")
  async updateLot(@Param("id") id: string, @Body(zod(z.object({ supplier: z.string().max(200).nullable().optional(), invoiceNumber: z.string().max(60).nullable().optional() }))) body: { supplier?: string | null; invoiceNumber?: string | null }) {
    const { tenantId } = authed();
    const before = await this.prisma.stockLot.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Lote");
    return this.prisma.$transaction(async (tx) => {
      const lot = await tx.stockLot.update({ where: { id }, data: body });
      await this.audit.record(tx, { action: "stock.lot_updated", entityType: "StockLot", entityId: id, before, after: lot });
      return lot;
    });
  }
}
