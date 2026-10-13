import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  addDays,
  canonicalJson,
  type deliveryCreateSchema,
  type deliveryPrepareSchema,
  EARLY_REPLACEMENT_REASONS,
  startOfUtcDay,
} from "@preventbase/contracts";
import { Prisma, requirementStatus, type StockLot } from "@preventbase/database";
import type { z } from "zod";
import { AuditService, toJson } from "../../core/audit.service.js";
import { authed, ctx, DomainError, notFound } from "../../core/context.js";
import { PrismaService } from "../../core/prisma.service.js";
import { StockService } from "../inventory/stock.service.js";

type Db = Prisma.TransactionClient | PrismaService;
type PrepareInput = z.infer<typeof deliveryPrepareSchema>;
type CreateInput = z.infer<typeof deliveryCreateSchema>;

export interface PreparedItem {
  index: number;
  variantId: string;
  productId: string | null;
  productDescription: string | null;
  sku: string | null;
  quantity: number;
  reasonCode: string;
  reasonName: string | null;
  justification: string | null;
  lot: { id: string; lotNumber: string; caNumber: string; expiryDate: Date | null; caValidAtPurchase: boolean | null; unitCost: Prisma.Decimal | null } | null;
  locationId: string | null;
  available: number;
  manufacturer: string | null;
  caToday: { validUntil: Date | null; situation: string | null; validToday: boolean | null } | null;
  isEarlyReplacement: boolean;
  previousItem: { id: string; deliveredAt: Date; nextReplacementDue: Date | null } | null;
  replacementDays: number | null;
  nextReplacementDue: Date | null;
  requiredByJob: boolean;
  warnings: string[];
  errors: string[];
}

export const MAX_VERIFICATION_AGE_DEFAULT = 300;

export function deliveryHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function publicId(): string {
  return randomBytes(12).toString("base64url");
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  /** Todas as validações legais/operacionais da entrega (§9). Frontend só exibe o resultado (§79-13). */
  async prepare(db: Db, input: PrepareInput) {
    const { tenantId } = authed();
    const employee = await db.employee.findFirst({
      where: { id: input.employeeId, tenantId },
      include: { job: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, company: { select: { id: true, legalName: true, tradeName: true } } },
    });
    if (!employee) throw notFound("Colaborador");
    const warehouse = await db.warehouse.findFirst({ where: { id: input.warehouseId, tenantId } });
    if (!warehouse) throw notFound("Almoxarifado");

    const globalErrors: string[] = [];
    if (employee.status !== "ACTIVE") globalErrors.push("Colaborador não está ativo");
    if (warehouse.companyId !== employee.companyId) globalErrors.push("Almoxarifado de outra empresa");

    const today = startOfUtcDay(new Date());
    const reasons = await db.deliveryReason.findMany({ where: { tenantId, active: true } });
    const requirements = employee.jobId ? await db.epiJobRequirement.findMany({ where: { tenantId, jobId: employee.jobId, active: true } }) : [];
    const seen = new Set<string>();
    const items: PreparedItem[] = [];

    for (const [index, it] of input.items.entries()) {
      const errors: string[] = [];
      const warnings: string[] = [];
      const variant = await db.epiVariant.findFirst({ where: { id: it.variantId, tenantId }, include: { product: { include: { cas: { where: { isCurrent: true } } } } } });
      const reason = reasons.find((r) => r.code === it.reasonCode);
      const item: PreparedItem = {
        index,
        variantId: it.variantId,
        productId: variant?.productId ?? null,
        productDescription: variant?.product.description ?? null,
        sku: variant?.sku ?? null,
        quantity: it.quantity,
        reasonCode: it.reasonCode,
        reasonName: reason?.name ?? null,
        justification: it.justification?.trim() || null,
        lot: null,
        locationId: null,
        available: 0,
        manufacturer: variant?.product.manufacturer ?? null,
        caToday: null,
        isEarlyReplacement: false,
        previousItem: null,
        replacementDays: null,
        nextReplacementDue: null,
        requiredByJob: false,
        warnings,
        errors,
      };
      items.push(item);

      if (!variant) {
        errors.push("EPI/variação não encontrado");
        continue;
      }
      if (seen.has(variant.id)) errors.push("Item repetido na mesma entrega — ajuste a quantidade");
      seen.add(variant.id);
      if (!variant.active || variant.product.status !== "ACTIVE") errors.push("EPI inativo");
      if (!reason) errors.push("Motivo de entrega inválido");
      else if (reason.requiresJustification && !item.justification) errors.push(`Motivo "${reason.name}" exige justificativa`);

      const requirement = requirements.find((r) => r.productId === variant.productId);
      item.requiredByJob = !!requirement;
      item.replacementDays = requirement?.replacementDays ?? variant.product.replacementDays ?? null;

      // Lote: informado ou FEFO
      let lot: StockLot | null = null;
      if (it.lotId) {
        lot = await db.stockLot.findFirst({ where: { id: it.lotId, tenantId } });
        if (!lot || lot.variantId !== variant.id) errors.push("Lote não pertence a este EPI");
      } else {
        const fefo = await this.stock.fefo(db, tenantId, warehouse.id, variant.id, it.quantity);
        if (fefo[0]) lot = await db.stockLot.findUnique({ where: { id: fefo[0].lotId } });
        else errors.push("Sem lote disponível (saldo, validade e CA) neste almoxarifado");
      }
      if (lot && lot.variantId === variant.id) {
        item.lot = { id: lot.id, lotNumber: lot.lotNumber, caNumber: lot.caNumber, expiryDate: lot.expiryDate, caValidAtPurchase: lot.caValidAtPurchase, unitCost: lot.unitCost };
        const loc = await this.stock.locateLot(db, warehouse.id, lot.id, it.quantity);
        const totalRows = await db.stockBalance.aggregate({ where: { warehouseId: warehouse.id, lotId: lot.id }, _sum: { quantity: true } });
        item.available = totalRows._sum.quantity ?? 0;
        if (!loc) errors.push(`Saldo insuficiente no lote ${lot.lotNumber} (disponível ${item.available})`);
        else item.locationId = loc.locationId;

        if (lot.expiryDate && lot.expiryDate < today) errors.push(`Lote ${lot.lotNumber} vencido em ${lot.expiryDate.toISOString().slice(0, 10)} (validade do fabricante)`);

        // §19 — CA válido na compra ≠ CA válido hoje
        if (lot.caValidAtPurchase === false) errors.push(`CA ${lot.caNumber} estava vencido na compra deste lote — fornecimento vedado (NR-6)`);
        if (lot.caValidAtPurchase === null) warnings.push(`Validade do CA ${lot.caNumber} na compra não foi verificada`);
        const ca = await db.caMaster.findUnique({ where: { caNumber: lot.caNumber } });
        if (ca) {
          const validToday = ca.validUntil ? ca.validUntil >= today : null;
          item.caToday = { validUntil: ca.validUntil, situation: ca.situation, validToday };
          if (validToday === false && lot.caValidAtPurchase) {
            warnings.push(`CA ${lot.caNumber} vencido hoje, mas válido na compra — entrega permitida (NR-6: observar armazenamento e validade do produto)`);
          }
          if (ca.manufacturerName) item.manufacturer = ca.manufacturerName;
        }
        const currentCa = variant.product.cas[0]?.caNumber;
        if (currentCa && currentCa !== lot.caNumber) warnings.push(`CA do lote (${lot.caNumber}) difere do CA atual do produto (${currentCa})`);
      }

      // §22/§23 — periodicidade e troca antecipada
      const prev = await db.epiDeliveryItem.findFirst({
        where: { tenantId, employeeId: employee.id, productId: variant.productId, delivery: { status: "ACTIVE" } },
        include: { delivery: { select: { deliveredAt: true } } },
        orderBy: { createdAt: "desc" },
      });
      if (prev) {
        item.previousItem = { id: prev.id, deliveredAt: prev.delivery.deliveredAt, nextReplacementDue: prev.nextReplacementDue };
        if (prev.nextReplacementDue && prev.nextReplacementDue > today) {
          item.isEarlyReplacement = true;
          if (!EARLY_REPLACEMENT_REASONS.has(it.reasonCode)) {
            errors.push(`Troca antecipada (próxima troca prevista ${prev.nextReplacementDue.toISOString().slice(0, 10)}): use motivo dano, extravio, contaminação, mudança de função/risco ou outros`);
          } else if (!item.justification) {
            errors.push("Troca antecipada exige justificativa");
          } else {
            warnings.push("Troca antecipada registrada para análise de consumo");
          }
        }
      }
      item.nextReplacementDue = item.replacementDays ? addDays(today, item.replacementDays) : null;
      if (requirement && it.quantity > requirement.quantity && it.reasonCode === "INITIAL") warnings.push(`Quantidade acima do padrão da função (${requirement.quantity})`);
    }

    const [terms, biometric, reqStatus] = await Promise.all([
      db.deliveryTerms.findFirst({ where: { tenantId, active: true }, orderBy: { version: "desc" } }),
      db.biometricProfile.findFirst({ where: { tenantId, employeeId: employee.id, status: "ACTIVE" }, select: { id: true, enrolledAt: true } }),
      requirementStatus(db, tenantId, { employeeId: employee.id }),
    ]);
    if (!biometric) globalErrors.push("Colaborador sem biometria cadastrada — cadastre antes da entrega");
    if (!terms) globalErrors.push("Termo de entrega não configurado");

    const ok = globalErrors.length === 0 && items.every((i) => i.errors.length === 0);
    return {
      ok,
      errors: globalErrors,
      employee: {
        id: employee.id,
        name: employee.name,
        registration: employee.registration,
        status: employee.status,
        company: employee.company,
        job: employee.job,
        department: employee.department,
      },
      warehouse: { id: warehouse.id, name: warehouse.name },
      items,
      terms: terms ? { version: terms.version, text: terms.text, textHash: terms.textHash } : null,
      biometric,
      requirements: reqStatus,
    };
  }

  async create(input: CreateInput, idempotencyKey: string | undefined) {
    const c = authed();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new DomainError(400, "IDEMPOTENCY_KEY", "Cabeçalho Idempotency-Key obrigatório na entrega");
    }
    const existing = await this.prisma.epiDelivery.findUnique({ where: { tenantId_idempotencyKey: { tenantId: c.tenantId, idempotencyKey } } });
    if (existing) return this.replay(existing.id, input.employeeId);

    try {
      return await this.prisma.$transaction((tx) => this.createTx(tx, input, idempotencyKey), { timeout: 30_000, maxWait: 10_000 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const dup = await this.prisma.epiDelivery.findUnique({ where: { tenantId_idempotencyKey: { tenantId: c.tenantId, idempotencyKey } } });
        if (dup) return this.replay(dup.id, input.employeeId);
      }
      throw err;
    }
  }

  private async replay(id: string, employeeId: string) {
    const d = await this.prisma.epiDelivery.findUniqueOrThrow({ where: { id }, include: { evidence: { select: { hash: true } } } });
    if (d.employeeId !== employeeId) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "Idempotency-Key já usada em outra entrega");
    return { id: d.id, publicId: d.publicId, hash: d.evidence?.hash ?? null, deliveredAt: d.deliveredAt, replayed: true };
  }

  private async createTx(tx: Prisma.TransactionClient, input: CreateInput, idempotencyKey: string) {
    const c = authed();
    const prepared = await this.prepare(tx, input);
    if (!prepared.ok) {
      throw new DomainError(422, "DELIVERY_INVALID", [...prepared.errors, ...prepared.items.flatMap((i) => i.errors.map((e) => `${i.productDescription ?? "Item"}: ${e}`))].join("; "), {
        errors: prepared.errors,
        items: prepared.items.map((i) => ({ index: i.index, errors: i.errors })),
      });
    }
    const terms = prepared.terms!;
    if (terms.version !== input.termsVersion) throw new DomainError(409, "TERMS_CHANGED", "O termo de entrega foi atualizado — recarregue e confirme novamente");

    // Verificação biométrica: mesma pessoa, recente, aprovada, com liveness, de uso único, mesmo operador
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId } });
    const maxAge = Number((tenant.settings as { biometricMaxAgeSeconds?: number }).biometricMaxAgeSeconds ?? MAX_VERIFICATION_AGE_DEFAULT);
    const v = await tx.biometricVerification.findUnique({ where: { externalVerificationId: input.biometricVerificationId } });
    if (!v || v.tenantId !== c.tenantId || v.employeeId !== input.employeeId) throw new DomainError(422, "BIOMETRIC_INVALID", "Verificação biométrica não corresponde ao colaborador");
    if (v.purpose !== "DELIVERY") throw new DomainError(422, "BIOMETRIC_PURPOSE", "Verificação biométrica não é de entrega");
    if (!v.verified || !v.liveness) throw new DomainError(422, "BIOMETRIC_REJECTED", "Biometria recusada — a entrega não pode ser confirmada");
    if (v.consumedAt) throw new DomainError(409, "BIOMETRIC_REPLAY", "Verificação biométrica já utilizada em outra entrega");
    if (v.requestedById !== c.userId) throw new DomainError(422, "BIOMETRIC_OPERATOR", "Verificação feita por outro operador");
    if (Date.now() - v.createdAt.getTime() > maxAge * 1000) throw new DomainError(422, "BIOMETRIC_EXPIRED", "Verificação biométrica expirada — repita a validação facial");

    const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
    const deliveredAt = new Date();
    const delivery = await tx.epiDelivery.create({
      data: {
        tenantId: c.tenantId,
        companyId: employee.companyId,
        establishmentId: employee.establishmentId,
        departmentId: employee.departmentId,
        jobId: employee.jobId,
        employeeId: employee.id,
        managerUserId: c.userId,
        deviceId: c.deviceId ?? null,
        warehouseId: input.warehouseId,
        publicId: publicId(),
        idempotencyKey,
        deliveredAt,
      },
    });

    const itemsPayload: Array<Record<string, unknown>> = [];
    for (const it of prepared.items) {
      const mv = await this.stock.move(tx, {
        tenantId: c.tenantId,
        warehouseId: input.warehouseId,
        locationId: it.locationId!,
        lotId: it.lot!.id,
        type: "DELIVERY",
        quantity: -it.quantity,
        referenceType: "EpiDelivery",
        referenceId: delivery.id,
      });
      const nextDue = it.replacementDays ? addDays(startOfUtcDay(deliveredAt), it.replacementDays) : null;
      const created = await tx.epiDeliveryItem.create({
        data: {
          tenantId: c.tenantId,
          deliveryId: delivery.id,
          employeeId: employee.id,
          productId: it.productId!,
          variantId: it.variantId,
          lotId: it.lot!.id,
          productDescription: it.productDescription!,
          caNumber: it.lot!.caNumber,
          manufacturer: it.manufacturer,
          lotNumber: it.lot!.lotNumber,
          lotExpiryDate: it.lot!.expiryDate,
          caValidAtPurchase: it.lot!.caValidAtPurchase,
          quantity: it.quantity,
          reasonCode: it.reasonCode,
          justification: it.justification,
          isEarlyReplacement: it.isEarlyReplacement,
          replacesItemId: it.previousItem?.id ?? null,
          nextReplacementDue: nextDue,
          unitCost: it.lot!.unitCost,
          stockMovementId: mv.movementId,
        },
      });
      itemsPayload.push({
        itemId: created.id,
        productId: created.productId,
        variantId: created.variantId,
        description: created.productDescription,
        caNumber: created.caNumber,
        manufacturer: created.manufacturer,
        lotId: created.lotId,
        lotNumber: created.lotNumber,
        lotExpiryDate: created.lotExpiryDate,
        caValidAtPurchase: created.caValidAtPurchase,
        quantity: created.quantity,
        reasonCode: created.reasonCode,
        justification: created.justification,
        isEarlyReplacement: created.isEarlyReplacement,
        nextReplacementDue: created.nextReplacementDue,
        stockMovementId: created.stockMovementId,
      });
    }

    const consumed = await tx.biometricVerification.updateMany({
      where: { id: v.id, consumedAt: null },
      data: { consumedAt: new Date(), consumedByDeliveryId: delivery.id },
    });
    if (consumed.count !== 1) throw new DomainError(409, "BIOMETRIC_REPLAY", "Verificação biométrica já utilizada");

    const rc = ctx();
    const payload = toJson({
      version: 1,
      deliveryId: delivery.id,
      publicId: delivery.publicId,
      tenantId: c.tenantId,
      companyId: delivery.companyId,
      establishmentId: delivery.establishmentId,
      departmentId: delivery.departmentId,
      jobId: delivery.jobId,
      employee: { id: employee.id, name: employee.name, cpf: employee.cpf, registration: employee.registration },
      managerUserId: c.userId,
      deviceId: delivery.deviceId,
      warehouseId: delivery.warehouseId,
      deliveredAt: delivery.deliveredAt,
      items: itemsPayload,
      confirmation: {
        method: "FACIAL_BIOMETRIC_1_1",
        explicitConfirmation: input.confirmed,
        termsVersion: terms.version,
        termsTextHash: terms.textHash,
        biometricVerificationId: v.externalVerificationId,
        biometricScore: v.score,
        liveness: v.liveness,
        livenessChallenge: v.challengeAction,
        verifiedAt: v.createdAt,
      },
      context: { ip: rc.ip ?? null, userAgent: rc.userAgent ?? null, sessionId: c.sessionId, requestId: rc.requestId, idempotencyKey },
    })!;
    const hash = deliveryHash(payload);
    await tx.deliveryEvidence.create({
      data: {
        tenantId: c.tenantId,
        deliveryId: delivery.id,
        verificationMethod: "FACIAL_BIOMETRIC_1_1",
        biometricVerificationId: v.externalVerificationId,
        biometricScore: v.score,
        livenessResult: v.liveness,
        livenessChallenge: v.challengeAction,
        termsVersion: terms.version,
        termsTextHash: terms.textHash,
        ipAddress: rc.ip ?? null,
        userAgent: rc.userAgent ?? null,
        sessionId: c.sessionId,
        deviceId: delivery.deviceId,
        requestId: rc.requestId,
        canonicalPayload: payload,
        hash,
      },
    });
    await this.audit.record(tx, { action: "epi.delivered", entityType: "EpiDelivery", entityId: delivery.id, after: { publicId: delivery.publicId, hash, items: itemsPayload.length } });
    return { id: delivery.id, publicId: delivery.publicId, hash, deliveredAt, replayed: false, warnings: prepared.items.flatMap((i) => i.warnings) };
  }

  async cancel(id: string, reason: string) {
    const c = authed();
    const delivery = await this.prisma.epiDelivery.findFirst({ where: { id, tenantId: c.tenantId }, include: { items: true } });
    if (!delivery) throw notFound("Entrega");
    if (delivery.status === "CANCELLED") throw new DomainError(409, "ALREADY_CANCELLED", "Entrega já cancelada");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.epiDelivery.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: c.userId, cancellationReason: reason },
      });
      for (const item of delivery.items) {
        const mv = await tx.stockMovement.findUniqueOrThrow({ where: { id: item.stockMovementId } });
        await this.stock.move(tx, {
          tenantId: c.tenantId,
          warehouseId: mv.warehouseId,
          locationId: mv.locationId,
          lotId: mv.lotId,
          type: "DELIVERY_CANCEL",
          quantity: item.quantity,
          referenceType: "EpiDelivery",
          referenceId: id,
          reason,
        });
      }
      await this.audit.record(tx, { action: "epi.delivery_cancelled", entityType: "EpiDelivery", entityId: id, before: { status: delivery.status }, after: { status: updated.status, reason } });
      return updated;
    });
  }

  async get(id: string) {
    const { tenantId } = authed();
    const d = await this.prisma.epiDelivery.findFirst({
      where: { id, tenantId },
      include: { items: true, evidence: true, employee: { select: { id: true, name: true, cpf: true, registration: true, companyId: true } } },
    });
    if (!d) throw notFound("Entrega");
    const [manager, warehouse, company] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: d.managerUserId }, select: { id: true, name: true, email: true } }),
      this.prisma.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true, name: true } }),
      this.prisma.company.findUnique({ where: { id: d.companyId }, select: { legalName: true, tradeName: true, cnpj: true } }),
    ]);
    const hashValid = d.evidence ? deliveryHash(d.evidence.canonicalPayload) === d.evidence.hash : false;
    return { ...d, manager, warehouse, company, hashValid };
  }
}
