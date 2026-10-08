import { syncCaepiFromUrl } from "@preventbase/caepi";
import { expiringLots, lowStock, type PrismaClient, requirementStatus, stockDrift, verifyAuditChain } from "@preventbase/database";

export interface Alert {
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  companyId?: string;
  dedupeKey: string;
}

export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, service: "preventbase-worker", msg, ...extra })}\n`);
}

const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "—");

/**
 * Sincroniza alertas de um grupo de tipos: cria os novos (dedupe por chave)
 * e resolve automaticamente os que deixaram de existir.
 */
export async function syncAlerts(prisma: PrismaClient, tenantId: string, types: string[], alerts: Alert[]): Promise<{ created: number; resolved: number }> {
  const keys = new Set(alerts.map((a) => a.dedupeKey));
  const open = await prisma.notification.findMany({ where: { tenantId, type: { in: types }, resolvedAt: null }, select: { id: true, dedupeKey: true } });
  const stale = open.filter((n) => !keys.has(n.dedupeKey)).map((n) => n.id);
  const resolved = stale.length ? (await prisma.notification.updateMany({ where: { id: { in: stale } }, data: { resolvedAt: new Date() } })).count : 0;

  let created = 0;
  for (const a of alerts) {
    const existing = await prisma.notification.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: a.dedupeKey } }, select: { id: true, resolvedAt: true } });
    if (!existing) {
      await prisma.notification.create({ data: { tenantId, ...a } });
      created++;
    } else if (existing.resolvedAt) {
      await prisma.notification.update({ where: { id: existing.id }, data: { ...a, resolvedAt: null, readAt: null, createdAt: new Date() } });
      created++;
    }
  }
  return { created, resolved };
}

interface TenantSettings {
  lotExpiryAlertDays?: number;
  caExpiryAlertDays?: number;
}

/** §47 — estoque mínimo, lotes vencendo/vencidos, CA vencendo, EPIs pendentes/vencidos por colaborador. */
export async function runAlerts(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, settings: true } });
  const summary: Record<string, unknown> = {};
  for (const t of tenants) {
    const settings = (t.settings ?? {}) as TenantSettings;
    const lotDays = settings.lotExpiryAlertDays ?? 60;
    const caDays = settings.caExpiryAlertDays ?? 30;

    const stock = (await lowStock(prisma, t.id)).map<Alert>((r) => ({
      type: "LOW_STOCK",
      severity: r.quantity <= 0 ? "CRITICAL" : "WARNING",
      title: `Estoque baixo: ${r.productDescription}`,
      body: `${r.warehouseName} — SKU ${r.sku}: saldo ${r.quantity} (mínimo ${r.minQty}).`,
      entityType: "epi_variant",
      entityId: r.variantId,
      dedupeKey: `low:${r.warehouseId}:${r.variantId}`,
    }));

    const lots = (await expiringLots(prisma, t.id, lotDays)).map<Alert>((r) => ({
      type: r.expired ? "LOT_EXPIRED" : "LOT_EXPIRING",
      severity: r.expired ? "CRITICAL" : "WARNING",
      title: `${r.expired ? "Lote vencido" : "Lote vencendo"}: ${r.productDescription}`,
      body: `Lote ${r.lotNumber} (CA ${r.caNumber}) em ${r.warehouseName}: ${r.quantity} un., validade ${fmt(r.expiryDate)}.`,
      entityType: "stock_lot",
      entityId: r.lotId,
      dedupeKey: `${r.expired ? "lotx" : "lot"}:${r.lotId}:${r.warehouseId}`,
    }));

    const limit = new Date(Date.now() + caDays * 86_400_000);
    const cas = await prisma.epiProductCa.findMany({ where: { tenantId: t.id, isCurrent: true }, include: { product: { select: { id: true, description: true, status: true } } } });
    const masters = await prisma.caMaster.findMany({ where: { caNumber: { in: [...new Set(cas.map((c) => c.caNumber))] } }, select: { caNumber: true, validUntil: true, situation: true } });
    const byCa = new Map(masters.map((m) => [m.caNumber, m]));
    const caAlerts: Alert[] = [];
    for (const c of cas) {
      if (c.product.status !== "ACTIVE") continue;
      const m = byCa.get(c.caNumber);
      if (!m) {
        caAlerts.push({ type: "CA_UNKNOWN", severity: "WARNING", title: `CA ${c.caNumber} não encontrado na base CAEPI`, body: c.product.description, entityType: "epi_product", entityId: c.productId, dedupeKey: `caunk:${c.productId}:${c.caNumber}` });
        continue;
      }
      if (m.validUntil && m.validUntil <= limit) {
        const expired = m.validUntil < new Date();
        caAlerts.push({
          type: expired ? "CA_EXPIRED" : "CA_EXPIRING",
          severity: expired ? "CRITICAL" : "WARNING",
          title: `${expired ? "CA vencido" : "CA vencendo"}: ${c.product.description}`,
          body: `CA ${c.caNumber} — validade ${fmt(m.validUntil)}${m.situation ? ` (${m.situation})` : ""}. Lotes já comprados com CA válido na compra seguem permitidos.`,
          entityType: "epi_product",
          entityId: c.productId,
          dedupeKey: `${expired ? "cax" : "ca"}:${c.productId}:${c.caNumber}`,
        });
      }
    }

    const pending = (await requirementStatus(prisma, t.id, { onlyPending: true })).map<Alert>((r) => ({
      type: r.status === "MISSING" ? "EPI_MISSING" : "EPI_OVERDUE",
      severity: r.status === "MISSING" ? "WARNING" : "CRITICAL",
      title: `${r.status === "MISSING" ? "EPI obrigatório não entregue" : "Troca de EPI vencida"}: ${r.employeeName}`,
      body: r.status === "MISSING" ? r.productDescription : `${r.productDescription} — troca prevista em ${fmt(r.nextReplacementDue)}.`,
      entityType: "employee",
      entityId: r.employeeId,
      companyId: r.companyId,
      dedupeKey: `req:${r.employeeId}:${r.productId}:${r.status}`,
    }));

    summary[t.id] = {
      stock: await syncAlerts(prisma, t.id, ["LOW_STOCK"], stock),
      lots: await syncAlerts(prisma, t.id, ["LOT_EXPIRING", "LOT_EXPIRED"], lots),
      ca: await syncAlerts(prisma, t.id, ["CA_UNKNOWN", "CA_EXPIRING", "CA_EXPIRED"], caAlerts),
      requirements: await syncAlerts(prisma, t.id, ["EPI_MISSING", "EPI_OVERDUE"], pending),
    };
  }
  return summary;
}

/** §51 — integridade da trilha de auditoria. */
export async function runAuditVerify(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    const res = await verifyAuditChain(prisma, t.id);
    out[t.id] = res;
    const alerts: Alert[] = res.ok
      ? []
      : [{ type: "AUDIT_CHAIN_BROKEN", severity: "CRITICAL", title: "Trilha de auditoria com integridade quebrada", body: `Registro ${res.brokenAtId}: ${res.reason}.`, entityType: "audit_log", entityId: res.brokenAtId, dedupeKey: `audit:${res.brokenAtId}` }];
    await syncAlerts(prisma, t.id, ["AUDIT_CHAIN_BROKEN"], alerts);
    if (!res.ok) log("error", "cadeia de auditoria quebrada", { tenantId: t.id, ...res });
  }
  return out;
}

/** §14 — saldo projetado deve bater com a soma dos movimentos. */
export async function runStockReconcile(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    const drift = await stockDrift(prisma, t.id);
    out[t.id] = drift.length;
    await syncAlerts(
      prisma,
      t.id,
      ["STOCK_DRIFT"],
      drift.map((d) => ({
        type: "STOCK_DRIFT",
        severity: "CRITICAL",
        title: "Divergência entre saldo e movimentos",
        body: `Lote ${d.lotId}: saldo ${d.balance}, movimentos ${d.movements}.`,
        entityType: "stock_lot",
        entityId: d.lotId,
        dedupeKey: `drift:${d.warehouseId}:${d.locationId}:${d.lotId}`,
      })),
    );
  }
  return out;
}

/** §8 — base CAEPI (somente leitura do governo; nunca escrita externa). */
export async function runCaepiSync(prisma: PrismaClient, url: string, triggeredBy?: string): Promise<unknown> {
  return syncCaepiFromUrl(prisma, url, { triggeredBy: triggeredBy ?? "worker" });
}
