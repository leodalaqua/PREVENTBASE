import { Body, Controller, Get, Headers, Param, Post, Query, Res } from "@nestjs/common";
import { cancelSchema, deliveryCreateSchema, deliveryPrepareSchema, paginationSchema } from "@preventbase/contracts";
import type { Prisma } from "@preventbase/database";
import type { Response } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { RequirePermissions, RequireTrustedDevice } from "../../core/auth.guard.js";
import { assertCompanyAccess, authed, companyScope, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";
import { fmtDate, fmtDateTime, renderTable } from "../reporting/export.js";
import { DeliveryService } from "./delivery.service.js";
import { evidencePdf } from "./evidence-pdf.js";

const listSchema = paginationSchema.extend({
  employeeId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export function sendFile(res: Response, file: { buffer: Buffer; contentType: string; filename: string }, inline = false): void {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${file.filename}"`);
  res.send(file.buffer);
}

@Controller()
export class DeliveryController {
  constructor(
    private readonly deliveries: DeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("deliveries/prepare")
  @RequirePermissions("epi.deliver")
  prepare(@Body(zod(deliveryPrepareSchema)) body: z.infer<typeof deliveryPrepareSchema>) {
    return this.deliveries.prepare(this.prisma, body);
  }

  @Post("deliveries")
  @RequirePermissions("epi.deliver")
  @RequireTrustedDevice()
  create(@Body(zod(deliveryCreateSchema)) body: z.infer<typeof deliveryCreateSchema>, @Headers("idempotency-key") key?: string) {
    return this.deliveries.create(body, key);
  }

  @Get("deliveries")
  @RequirePermissions("epi.view")
  async list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    const { tenantId } = authed();
    const where: Prisma.EpiDeliveryWhereInput = {
      tenantId,
      ...companyScope(),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? { deliveredAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00-03:00`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999-03:00`) } : {}) } }
        : {}),
      ...(q.q ? { employee: { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { registration: q.q }] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.epiDelivery.findMany({
        where,
        include: { employee: { select: { id: true, name: true, registration: true } }, items: { select: { productDescription: true, quantity: true, caNumber: true, lotNumber: true } }, evidence: { select: { hash: true, biometricScore: true } } },
        orderBy: { deliveredAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.epiDelivery.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get("deliveries/:id")
  @RequirePermissions("epi.view")
  get(@Param("id") id: string) {
    return this.deliveries.get(id);
  }

  @Post("deliveries/:id/cancel")
  @RequirePermissions("epi.cancel_delivery")
  cancel(@Param("id") id: string, @Body(zod(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.deliveries.cancel(id, body.reason);
  }

  @Get("deliveries/:id/pdf")
  @RequirePermissions("epi.view")
  async pdf(@Param("id") id: string, @Res() res: Response) {
    const d = await this.deliveries.get(id);
    const terms = d.evidence ? await this.prisma.deliveryTerms.findFirst({ where: { tenantId: d.tenantId, version: d.evidence.termsVersion } }) : null;
    const buffer = await evidencePdf({
      company: d.company,
      employee: d.employee,
      manager: d.manager,
      warehouse: d.warehouse,
      deliveredAt: d.deliveredAt,
      status: d.status,
      cancellationReason: d.cancellationReason,
      publicId: d.publicId,
      items: d.items,
      evidence: d.evidence,
      termsText: terms?.text ?? null,
      verifyUrl: `${config.publicBaseUrl}/verificar/${d.publicId}`,
    });
    sendFile(res, { buffer, contentType: "application/pdf", filename: `entrega-epi-${d.publicId}.pdf` }, true);
  }

  /** Ficha eletrônica de EPI (§12) — PDF/XLSX/CSV ou JSON. */
  @Get("employees/:id/epi-sheet")
  @RequirePermissions("employee.view")
  async sheet(@Param("id") id: string, @Query("format") format: string | undefined, @Res() res: Response) {
    const { tenantId } = authed();
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenantId },
      include: { company: true, job: { select: { name: true } }, department: { select: { name: true } } },
    });
    if (!employee) throw notFound("Colaborador");
    assertCompanyAccess(employee.companyId);
    const items = await this.prisma.epiDeliveryItem.findMany({
      where: { tenantId, employeeId: id },
      include: { delivery: { select: { deliveredAt: true, status: true, publicId: true, managerUserId: true, evidence: { select: { verificationMethod: true, hash: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    const managers = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.delivery.managerUserId))] } }, select: { id: true, name: true } });
    const managerName = new Map(managers.map((m) => [m.id, m.name]));
    const returns = await this.prisma.epiReturn.findMany({ where: { tenantId, employeeId: id, status: "ACTIVE" }, orderBy: { returnedAt: "asc" } });
    const rows = items.map((i) => ({
      date: i.delivery.deliveredAt,
      epi: i.productDescription,
      ca: i.caNumber,
      lot: i.lotNumber,
      qty: i.quantity,
      reason: i.reasonCode,
      validation: i.delivery.evidence?.verificationMethod === "FACIAL_BIOMETRIC_1_1" ? "Facial 1:1" : (i.delivery.evidence?.verificationMethod ?? ""),
      manager: managerName.get(i.delivery.managerUserId) ?? "",
      nextReplacement: i.nextReplacementDue,
      status: i.delivery.status === "CANCELLED" ? "CANCELADA" : "",
      code: i.delivery.publicId,
    }));
    if (!format || format === "json") return void res.json({ employee, rows, returns });
    const file = await renderTable(format as "csv" | "xlsx" | "pdf", {
      title: `Ficha de EPI — ${employee.name}`,
      subtitle: `${employee.company.tradeName ?? employee.company.legalName} · CPF ${employee.cpf} · Matrícula ${employee.registration ?? "-"} · Função ${employee.job?.name ?? "-"} · Setor ${employee.department?.name ?? "-"} · Emitida em ${fmtDateTime(new Date())}`,
      filename: `ficha-epi-${employee.registration ?? employee.id}`,
      columns: [
        { key: "date", label: "Data", width: 14, format: (v) => fmtDateTime(v) },
        { key: "epi", label: "EPI", width: 30 },
        { key: "ca", label: "CA", width: 9 },
        { key: "lot", label: "Lote", width: 12 },
        { key: "qty", label: "Qtd", width: 5 },
        { key: "reason", label: "Motivo", width: 12 },
        { key: "validation", label: "Validação", width: 10 },
        { key: "manager", label: "Responsável", width: 16 },
        { key: "nextReplacement", label: "Próx. troca", width: 10, format: (v) => fmtDate(v) },
        { key: "status", label: "Situação", width: 9 },
        { key: "code", label: "Verificação", width: 16 },
      ],
      rows,
    });
    sendFile(res, file, format === "pdf");
  }
}
