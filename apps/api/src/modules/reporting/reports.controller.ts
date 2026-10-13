import { Controller, Get, Query, Res } from "@nestjs/common";
import { MOVEMENT_LABELS, reportQuerySchema } from "@preventbase/contracts";
import { expiringLots, type Prisma, requirementStatus } from "@preventbase/database";
import type { Response } from "express";
import type { z } from "zod";
import { Acesso } from "../../core/auth.guard.js";
import { authed } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";
import { sendFile } from "../delivery/delivery.controller.js";
import { type Column, fmtDate, fmtDateTime, renderTable } from "./export.js";

type Q = z.infer<typeof reportQuerySchema>;

function period(q: Q): { gte?: Date; lte?: Date } {
  return {
    ...(q.from ? { gte: new Date(`${q.from}T00:00:00-03:00`) } : {}),
    ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999-03:00`) } : {}),
  };
}

const num = (v: unknown) => (v === null || v === undefined ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

/** Relatórios essenciais (§64). Todos exportáveis em JSON/CSV/XLSX/PDF (NR-6: extração de relatórios). */
@Controller("reports")
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  private async out(res: Response, q: Q, title: string, filename: string, columns: Column[], rows: Array<Record<string, unknown>>) {
    if (q.format === "json") return void res.json({ title, columns: columns.map((c) => ({ key: c.key, label: c.label })), rows });
    const subtitle = `Período: ${q.from ? fmtDate(q.from) : "início"} a ${q.to ? fmtDate(q.to) : "hoje"} · gerado em ${fmtDateTime(new Date())}`;
    sendFile(res, await renderTable(q.format, { title, subtitle, filename, columns, rows }), q.format === "pdf");
  }

  private deliveryWhere(q: Q): Prisma.EpiDeliveryItemWhereInput {
    const { tenantId } = authed();
    return {
      tenantId,
      delivery: {
        status: "ACTIVE",
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.establishmentId ? { establishmentId: q.establishmentId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.from || q.to ? { deliveredAt: period(q) } : {}),
      },
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    };
  }

  @Get("deliveries")
  @Acesso("relatorios.relatorios.visualizar")
  async deliveries(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const items = await this.prisma.epiDeliveryItem.findMany({
      where: this.deliveryWhere(q),
      include: { delivery: { select: { deliveredAt: true, publicId: true, managerUserId: true, employee: { select: { name: true, registration: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 20000,
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.delivery.managerUserId))] } }, select: { id: true, name: true } });
    const uname = new Map(users.map((u) => [u.id, u.name]));
    const rows = items.map((i) => ({
      deliveredAt: i.delivery.deliveredAt,
      employee: i.delivery.employee.name,
      registration: i.delivery.employee.registration,
      epi: i.productDescription,
      ca: i.caNumber,
      lot: i.lotNumber,
      qty: i.quantity,
      reason: i.reasonCode,
      early: i.isEarlyReplacement ? "Sim" : "",
      manager: uname.get(i.delivery.managerUserId) ?? "",
      cost: i.unitCost ? Number(i.unitCost) * i.quantity : null,
      code: i.delivery.publicId,
    }));
    return this.out(res, q, "Entregas de EPI por período", "entregas-epi", [
      { key: "deliveredAt", label: "Data/hora", width: 14, format: (v) => fmtDateTime(v) },
      { key: "employee", label: "Colaborador", width: 22 },
      { key: "registration", label: "Matrícula", width: 9 },
      { key: "epi", label: "EPI", width: 26 },
      { key: "ca", label: "CA", width: 8 },
      { key: "lot", label: "Lote", width: 10 },
      { key: "qty", label: "Qtd", width: 5 },
      { key: "reason", label: "Motivo", width: 11 },
      { key: "early", label: "Antecipada", width: 8 },
      { key: "manager", label: "Responsável", width: 16 },
      { key: "cost", label: "Custo (R$)", width: 9, format: num },
      { key: "code", label: "Verificação", width: 14 },
    ], rows);
  }

  /** Consumo/custo agrupado (§24): por colaborador, setor, função, EPI ou gestor. */
  @Get("consumption")
  @Acesso("relatorios.relatorios.visualizar")
  async consumption(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const groupBy = q.groupBy ?? "employee";
    const items = await this.prisma.epiDeliveryItem.findMany({
      where: this.deliveryWhere(q),
      select: { quantity: true, unitCost: true, isEarlyReplacement: true, productDescription: true, employeeId: true, delivery: { select: { departmentId: true, jobId: true, managerUserId: true, employee: { select: { name: true } } } } },
      take: 50000,
    });
    const deps = await this.prisma.department.findMany({ where: { tenantId: authed().tenantId }, select: { id: true, name: true } });
    const jobs = await this.prisma.job.findMany({ where: { tenantId: authed().tenantId }, select: { id: true, name: true } });
    const users = await this.prisma.user.findMany({ where: { tenantId: authed().tenantId }, select: { id: true, name: true } });
    const name = (m: Array<{ id: string; name: string }>, id: string | null) => m.find((x) => x.id === id)?.name ?? "(não informado)";
    const groups = new Map<string, { group: string; quantity: number; cost: number; deliveries: number; early: number }>();
    for (const i of items) {
      const key =
        groupBy === "employee" ? i.delivery.employee.name
        : groupBy === "department" ? name(deps, i.delivery.departmentId)
        : groupBy === "job" ? name(jobs, i.delivery.jobId)
        : groupBy === "manager" ? name(users, i.delivery.managerUserId)
        : i.productDescription;
      const g = groups.get(key) ?? { group: key, quantity: 0, cost: 0, deliveries: 0, early: 0 };
      g.quantity += i.quantity;
      g.cost += i.unitCost ? Number(i.unitCost) * i.quantity : 0;
      g.deliveries += 1;
      g.early += i.isEarlyReplacement ? 1 : 0;
      groups.set(key, g);
    }
    const rows = [...groups.values()].sort((a, b) => b.quantity - a.quantity);
    const label = { employee: "Colaborador", department: "Setor", job: "Função", product: "EPI", manager: "Responsável" }[groupBy];
    return this.out(res, q, `Consumo de EPI por ${label.toLowerCase()}`, `consumo-${groupBy}`, [
      { key: "group", label, width: 30 },
      { key: "deliveries", label: "Itens entregues", width: 10 },
      { key: "quantity", label: "Quantidade", width: 10 },
      { key: "early", label: "Trocas antecipadas", width: 12 },
      { key: "cost", label: "Custo (R$)", width: 12, format: num },
    ], rows);
  }

  @Get("stock")
  @Acesso("relatorios.relatorios.visualizar")
  async stock(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const { tenantId } = authed();
    const balances = await this.prisma.stockBalance.findMany({
      where: { tenantId, quantity: { gt: 0 } },
      include: { warehouse: { select: { name: true } }, location: { select: { code: true } }, lot: { include: { variant: { include: { product: { select: { description: true } } } } } } },
      orderBy: [{ lot: { expiryDate: "asc" } }],
    });
    const rows = balances.map((b) => ({
      warehouse: b.warehouse.name,
      location: b.location.code,
      epi: b.lot.variant.product.description,
      sku: b.lot.variant.sku,
      ca: b.lot.caNumber,
      lot: b.lot.lotNumber,
      expiry: b.lot.expiryDate,
      caAtPurchase: b.lot.caValidAtPurchase === null ? "Não verificado" : b.lot.caValidAtPurchase ? "Válido" : "Vencido",
      qty: b.quantity,
      value: b.lot.unitCost ? Number(b.lot.unitCost) * b.quantity : null,
    }));
    return this.out(res, q, "Posição de estoque por lote", "estoque", [
      { key: "warehouse", label: "Almoxarifado", width: 16 },
      { key: "location", label: "Local", width: 8 },
      { key: "epi", label: "EPI", width: 26 },
      { key: "sku", label: "SKU", width: 12 },
      { key: "ca", label: "CA", width: 8 },
      { key: "lot", label: "Lote", width: 10 },
      { key: "expiry", label: "Validade", width: 9, format: (v) => fmtDate(v) },
      { key: "caAtPurchase", label: "CA na compra", width: 10 },
      { key: "qty", label: "Saldo", width: 7 },
      { key: "value", label: "Valor (R$)", width: 10, format: num },
    ], rows);
  }

  @Get("movements")
  @Acesso("relatorios.relatorios.visualizar")
  async movements(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const { tenantId } = authed();
    const moves = await this.prisma.stockMovement.findMany({
      where: { tenantId, ...(q.from || q.to ? { createdAt: period(q) } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20000,
    });
    const lots = await this.prisma.stockLot.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.lotId))] } }, include: { variant: { include: { product: { select: { description: true } } } } } });
    const whs = await this.prisma.warehouse.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const lm = new Map(lots.map((l) => [l.id, l]));
    const rows = moves.map((m) => ({
      at: m.createdAt,
      type: MOVEMENT_LABELS[m.type] ?? m.type,
      warehouse: whs.find((w) => w.id === m.warehouseId)?.name,
      epi: lm.get(m.lotId)?.variant.product.description,
      lot: lm.get(m.lotId)?.lotNumber,
      qty: m.quantity,
      after: m.balanceAfter,
      reason: m.reason,
    }));
    return this.out(res, q, "Movimentações de estoque", "movimentos", [
      { key: "at", label: "Data/hora", width: 14, format: (v) => fmtDateTime(v) },
      { key: "type", label: "Tipo", width: 14 },
      { key: "warehouse", label: "Almoxarifado", width: 14 },
      { key: "epi", label: "EPI", width: 26 },
      { key: "lot", label: "Lote", width: 10 },
      { key: "qty", label: "Qtd", width: 6 },
      { key: "after", label: "Saldo após", width: 8 },
      { key: "reason", label: "Observação", width: 20 },
    ], rows);
  }

  @Get("expiring-lots")
  @Acesso("relatorios.relatorios.visualizar")
  async expiring(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const rows = await expiringLots(this.prisma, authed().tenantId, 90);
    return this.out(res, q, "Lotes vencidos e a vencer (90 dias)", "lotes-validade", [
      { key: "productDescription", label: "EPI", width: 26 },
      { key: "sku", label: "SKU", width: 12 },
      { key: "lotNumber", label: "Lote", width: 10 },
      { key: "caNumber", label: "CA", width: 8 },
      { key: "expiryDate", label: "Validade", width: 9, format: (v) => fmtDate(v) },
      { key: "warehouseName", label: "Almoxarifado", width: 14 },
      { key: "quantity", label: "Saldo", width: 7 },
      { key: "expired", label: "Situação", width: 8, format: (v) => (v ? "VENCIDO" : "A vencer") },
    ], rows as unknown as Array<Record<string, unknown>>);
  }

  @Get("pending")
  @Acesso("relatorios.relatorios.visualizar")
  async pending(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const rows = await requirementStatus(this.prisma, authed().tenantId, { onlyPending: true });
    return this.out(res, q, "Pendências de EPI obrigatório (matriz Função × EPI)", "pendencias-epi", [
      { key: "employeeName", label: "Colaborador", width: 24 },
      { key: "productDescription", label: "EPI obrigatório", width: 26 },
      { key: "requiredQty", label: "Qtd padrão", width: 8 },
      { key: "lastDeliveredAt", label: "Última entrega", width: 12, format: (v) => fmtDate(v) },
      { key: "nextReplacementDue", label: "Troca prevista", width: 12, format: (v) => fmtDate(v) },
      { key: "status", label: "Situação", width: 10, format: (v) => (v === "MISSING" ? "NÃO ENTREGUE" : "TROCA ATRASADA") },
    ], rows as unknown as Array<Record<string, unknown>>);
  }

  @Get("audit")
  @Acesso("relatorios.auditoria.visualizar")
  async audit(@Query(zod(reportQuerySchema)) q: Q, @Res() res: Response) {
    const { tenantId } = authed();
    const logs = await this.prisma.auditLog.findMany({ where: { tenantId, ...(q.from || q.to ? { createdAt: period(q) } : {}) }, orderBy: { id: "desc" }, take: 20000 });
    const users = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const rows = logs.map((l) => ({ id: l.id.toString(), at: l.createdAt, user: users.find((u) => u.id === l.userId)?.name ?? "", action: l.action, entity: `${l.entityType}${l.entityId ? `:${l.entityId}` : ""}`, ip: l.ip, hash: l.currentHash.slice(0, 16) }));
    return this.out(res, q, "Trilha de auditoria", "auditoria", [
      { key: "id", label: "#", width: 6 },
      { key: "at", label: "Data/hora", width: 14, format: (v) => fmtDateTime(v) },
      { key: "user", label: "Usuário", width: 16 },
      { key: "action", label: "Ação", width: 18 },
      { key: "entity", label: "Registro", width: 30 },
      { key: "ip", label: "IP", width: 10 },
      { key: "hash", label: "Hash", width: 14 },
    ], rows);
  }
}
