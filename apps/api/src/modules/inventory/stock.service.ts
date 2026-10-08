import { Injectable } from "@nestjs/common";
import { startOfUtcDay } from "@preventbase/contracts";
import type { MovementType, Prisma } from "@preventbase/database";
import { ctx, DomainError } from "../../core/context.js";
import { PrismaService } from "../../core/prisma.service.js";

export interface MoveInput {
  tenantId: string;
  warehouseId: string;
  locationId: string;
  lotId: string;
  type: MovementType;
  /** Com sinal: + entra, - sai. */
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string | null;
  unitCost?: Prisma.Decimal | number | null;
}

export interface FefoCandidate {
  lotId: string;
  lotNumber: string;
  caNumber: string;
  expiryDate: Date | null;
  caValidAtPurchase: boolean | null;
  locationId: string;
  quantity: number;
}

/**
 * Motor de estoque (§14): toda alteração de saldo passa por aqui, na transação do chamador.
 * Lock pessimista na linha de saldo → sem corrida entre entregas simultâneas; CHECK no banco impede negativo.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async move(tx: Prisma.TransactionClient, input: MoveInput): Promise<{ movementId: string; balanceAfter: number }> {
    if (input.quantity === 0) throw new DomainError(400, "QTY_ZERO", "Quantidade não pode ser zero");
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, tenantId: input.tenantId } });
    if (!warehouse) throw new DomainError(404, "NOT_FOUND", "Almoxarifado não encontrado");
    const lot = await tx.stockLot.findFirst({ where: { id: input.lotId, tenantId: input.tenantId } });
    if (!lot) throw new DomainError(404, "NOT_FOUND", "Lote não encontrado");

    await tx.$executeRaw`
      INSERT INTO stock_balances (id, "tenantId", "warehouseId", "locationId", "lotId", quantity, "updatedAt")
      VALUES (gen_random_uuid(), ${input.tenantId}::uuid, ${input.warehouseId}::uuid, ${input.locationId}::uuid, ${input.lotId}::uuid, 0, now())
      ON CONFLICT ("warehouseId", "locationId", "lotId") DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ id: string; quantity: number }>>`
      SELECT id, quantity FROM stock_balances
      WHERE "warehouseId" = ${input.warehouseId}::uuid AND "locationId" = ${input.locationId}::uuid AND "lotId" = ${input.lotId}::uuid
      FOR UPDATE`;
    const balance = rows[0]!;
    const after = balance.quantity + input.quantity;
    if (after < 0) {
      throw new DomainError(422, "STOCK_INSUFFICIENT", `Saldo insuficiente no lote ${lot.lotNumber} (disponível ${balance.quantity}, solicitado ${-input.quantity})`, {
        lotId: lot.id,
        available: balance.quantity,
      });
    }
    await tx.$executeRaw`UPDATE stock_balances SET quantity = ${after}, "updatedAt" = now() WHERE id = ${balance.id}::uuid`;
    const c = ctx();
    const movement = await tx.stockMovement.create({
      data: {
        tenantId: input.tenantId,
        companyId: warehouse.companyId,
        establishmentId: warehouse.establishmentId,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        lotId: input.lotId,
        variantId: lot.variantId,
        type: input.type,
        quantity: input.quantity,
        balanceAfter: after,
        unitCost: input.unitCost ?? lot.unitCost,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason ?? null,
        createdById: c.userId,
        requestId: c.requestId,
      },
    });
    return { movementId: movement.id, balanceAfter: after };
  }

  async defaultLocation(tx: Prisma.TransactionClient, tenantId: string, warehouseId: string): Promise<string> {
    const loc = await tx.stockLocation.findFirst({ where: { warehouseId, tenantId, isDefault: true } });
    if (loc) return loc.id;
    const created = await tx.stockLocation.create({ data: { tenantId, warehouseId, code: "GERAL", description: "Localização padrão", isDefault: true } });
    return created.id;
  }

  /** FEFO (§15): lotes com saldo, não vencidos, menor validade primeiro; lote sem validade por último. */
  async fefo(db: Prisma.TransactionClient | PrismaService, tenantId: string, warehouseId: string, variantId: string, minQty = 1): Promise<FefoCandidate[]> {
    const today = startOfUtcDay(new Date());
    return db.$queryRaw<FefoCandidate[]>`
      SELECT lo.id AS "lotId", lo."lotNumber", lo."caNumber", lo."expiryDate", lo."caValidAtPurchase", b."locationId", b.quantity
      FROM stock_balances b JOIN stock_lots lo ON lo.id = b."lotId"
      WHERE b."tenantId" = ${tenantId}::uuid AND b."warehouseId" = ${warehouseId}::uuid AND lo."variantId" = ${variantId}::uuid
        AND b.quantity >= ${minQty} AND (lo."expiryDate" IS NULL OR lo."expiryDate" >= ${today})
        AND (lo."caValidAtPurchase" IS DISTINCT FROM false)
      ORDER BY lo."expiryDate" ASC NULLS LAST, lo."createdAt" ASC, b.quantity DESC`;
  }

  /** Localização do lote com saldo suficiente (preferência: maior saldo). */
  async locateLot(db: Prisma.TransactionClient | PrismaService, warehouseId: string, lotId: string, qty: number): Promise<{ locationId: string; quantity: number } | null> {
    const rows = await db.$queryRaw<Array<{ locationId: string; quantity: number }>>`
      SELECT "locationId", quantity FROM stock_balances
      WHERE "warehouseId" = ${warehouseId}::uuid AND "lotId" = ${lotId}::uuid AND quantity >= ${qty}
      ORDER BY quantity DESC LIMIT 1`;
    return rows[0] ?? null;
  }

  get db(): PrismaService {
    return this.prisma;
  }
}
