import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { normalizeCaNumber, paginationSchema } from "@preventbase/contracts";
import { expiringLots, lowStock, Prisma, requirementStatus } from "@preventbase/database";
import { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Public, Acesso } from "../../core/auth.guard.js";
import { authed, DomainError } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";
import { QueueService } from "../../core/queue.service.js";
import { StorageService } from "../../core/storage.service.js";
import { biometricHealth } from "../biometric/biometric.controller.js";
import { deliveryHash } from "../delivery/delivery.service.js";

const auditQuery = paginationSchema.extend({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().uuid().optional(),
});

@Controller()
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {}

  /* ---------- observabilidade (§84) ---------- */

  @Public()
  @Get("health")
  health() {
    return { status: "ok", service: "preventbase-api", time: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  async ready() {
    const [db, redis, storage, biometric] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.queue.ping(),
      this.storage.ping(),
      biometricHealth(),
    ]);
    const checks = { db, redis, storage, biometric };
    const ok = Object.values(checks).every(Boolean);
    if (!ok) throw new DomainError(503, "NOT_READY", "Dependências indisponíveis", checks);
    return { status: "ready", checks };
  }

  /* ---------- dashboard (§48/§49) ---------- */

  @Get("dashboard")
  @Acesso("inicio.painel.visualizar")
  async dashboard() {
    const { tenantId } = authed();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(3, 0, 0, 0);
    const [activeEmployees, pending, deliveredItems, low, expiring, openAlerts, recent, monthly] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId, status: "ACTIVE" } }),
      requirementStatus(this.prisma, tenantId, { onlyPending: true }),
      this.prisma.epiDeliveryItem.aggregate({ where: { tenantId, delivery: { status: "ACTIVE", deliveredAt: { gte: monthStart } } }, _sum: { quantity: true }, _count: true }),
      lowStock(this.prisma, tenantId),
      expiringLots(this.prisma, tenantId, 60),
      this.prisma.notification.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.epiDelivery.findMany({
        where: { tenantId },
        include: { employee: { select: { name: true } }, items: { select: { productDescription: true, quantity: true } } },
        orderBy: { deliveredAt: "desc" },
        take: 8,
      }),
      this.prisma.$queryRaw<Array<{ month: string; quantity: number; cost: number }>>`
        SELECT to_char(date_trunc('month', d."deliveredAt" AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS month,
               SUM(i.quantity)::int AS quantity, COALESCE(SUM(i.quantity * i."unitCost"), 0)::float AS cost
        FROM epi_delivery_items i JOIN epi_deliveries d ON d.id = i."deliveryId"
        WHERE i."tenantId" = ${tenantId}::uuid AND d.status = 'ACTIVE' AND d."deliveredAt" >= now() - interval '12 months'
        GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      cards: {
        activeEmployees,
        employeesWithPending: new Set(pending.map((p) => p.employeeId)).size,
        pendingItems: pending.length,
        overdueReplacements: pending.filter((p) => p.status === "OVERDUE").length,
        deliveredThisMonth: deliveredItems._sum.quantity ?? 0,
        deliveryItemsThisMonth: deliveredItems._count,
        lowStock: low.length,
        lotsExpiring: expiring.filter((e) => !e.expired).length,
        lotsExpired: expiring.filter((e) => e.expired).length,
        openAlerts,
        asoExpiring: null,
        trainingsExpiring: null,
        accidents: null,
        esocialDivergences: null,
      },
      monthly,
      recent,
      lowStock: low.slice(0, 10),
      expiring: expiring.slice(0, 10),
    };
  }

  /* ---------- busca global (§60) ---------- */

  @Get("search")
  @Acesso("inicio.busca.visualizar")
  async search(@Query("q") q = "") {
    const { tenantId } = authed();
    const term = q.trim();
    if (term.length < 2) return { employees: [], epis: [], lots: [], ca: null, documents: [] };
    const digits = term.replace(/\D/g, "");
    const ca = normalizeCaNumber(term);
    const [employees, epis, lots, caMaster, documents] = await Promise.all([
      this.prisma.employee.findMany({
        where: { tenantId, OR: [{ name: { contains: term, mode: "insensitive" } }, { registration: term }, ...(digits.length >= 4 ? [{ cpf: { contains: digits } }] : [])] },
        select: { id: true, name: true, registration: true, status: true, job: { select: { name: true } } },
        take: 8,
      }),
      this.prisma.epiProduct.findMany({
        where: { tenantId, OR: [{ description: { contains: term, mode: "insensitive" } }, { internalCode: { contains: term, mode: "insensitive" } }, ...(ca ? [{ cas: { some: { caNumber: ca, isCurrent: true } } }] : []), { variants: { some: { ean: term } } }] },
        select: { id: true, description: true, internalCode: true },
        take: 8,
      }),
      this.prisma.stockLot.findMany({
        where: { tenantId, OR: [{ lotNumber: { contains: term, mode: "insensitive" } }, { publicCode: term.toUpperCase() }] },
        select: { id: true, lotNumber: true, publicCode: true, caNumber: true, expiryDate: true, variant: { select: { sku: true, product: { select: { description: true } } } } },
        take: 8,
      }),
      ca && /^\d+$/.test(ca) ? this.prisma.caMaster.findUnique({ where: { caNumber: ca }, select: { caNumber: true, equipmentName: true, manufacturerName: true, validUntil: true, situation: true } }) : null,
      this.prisma.document.findMany({ where: { tenantId, status: "ACTIVE", title: { contains: term, mode: "insensitive" } }, select: { id: true, title: true, entityType: true, entityId: true }, take: 8 }),
    ]);
    return { employees, epis, lots, ca: caMaster, documents };
  }

  /* ---------- alertas (§47) ---------- */

  @Get("notifications")
  @Acesso("inicio.painel.visualizar")
  notifications(@Query("all") all?: string) {
    const { tenantId } = authed();
    return this.prisma.notification.findMany({
      where: { tenantId, ...(all ? {} : { resolvedAt: null }) },
      orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
  }

  @Post("notifications/:id/read")
  @HttpCode(204)
  @Acesso("inicio.painel.visualizar")
  async read(@Param("id") id: string) {
    const { tenantId } = authed();
    await this.prisma.notification.updateMany({ where: { id, tenantId, readAt: null }, data: { readAt: new Date() } });
  }

  /* ---------- auditoria (§51/§82) ---------- */

  @Get("audit")
  @Acesso("relatorios.auditoria.visualizar")
  async auditList(@Query(zod(auditQuery)) q: z.infer<typeof auditQuery>) {
    const { tenantId } = authed();
    const where = {
      tenantId,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    return { items: items.map((i) => ({ ...i, id: i.id.toString(), userName: users.find((u) => u.id === i.userId)?.name ?? null })), total, page: q.page, pageSize: q.pageSize };
  }

  @Get("audit/verify-chain")
  @Acesso("relatorios.auditoria.visualizar")
  verifyChain() {
    return this.audit.verifyChain(authed().tenantId);
  }

  /* ---------- LGPD (§57) ---------- */

  @Get("lgpd/processing-records")
  @Acesso("administracao.lgpd.visualizar")
  lgpd() {
    return this.prisma.dataProcessingRecord.findMany({ where: { tenantId: authed().tenantId }, orderBy: { createdAt: "asc" } });
  }

  @Get("settings/tenant")
  @Acesso("administracao.parametros.visualizar")
  tenantSettings() {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id: authed().tenantId }, select: { id: true, name: true, settings: true } });
  }

  /* ---------- verificação pública (§66) ---------- */

  @Public()
  @Get("public/verify/:publicId")
  async verify(@Param("publicId") publicId: string) {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(publicId)) throw new DomainError(400, "INVALID", "Código inválido");
    const d = await this.prisma.epiDelivery.findUnique({
      where: { publicId },
      include: { evidence: true, employee: { select: { name: true } }, items: { select: { quantity: true } } },
    });
    if (!d || !d.evidence) return { found: false };
    const company = await this.prisma.company.findUnique({ where: { id: d.companyId }, select: { legalName: true, tradeName: true } });
    const hashValid = deliveryHash(d.evidence.canonicalPayload) === d.evidence.hash;
    const parts = d.employee.name.trim().split(/\s+/);
    const masked = [parts[0], ...parts.slice(1).map((p) => `${p[0]}.`)].join(" ");
    return {
      found: true,
      type: "Comprovante de entrega de EPI",
      valid: hashValid && d.status === "ACTIVE",
      hashValid,
      status: d.status,
      company: company?.tradeName ?? company?.legalName ?? null,
      employee: masked,
      deliveredAt: d.deliveredAt,
      items: d.items.reduce((s, i) => s + i.quantity, 0),
      method: d.evidence.verificationMethod,
      hash: d.evidence.hash,
      checkedAt: new Date().toISOString(),
    };
  }
}
