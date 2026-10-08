import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { employeeCreateSchema, employeeStatus, employeeUpdateSchema, paginationSchema } from "@preventbase/contracts";
import { type Prisma, requirementStatus } from "@preventbase/database";
import { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { RequirePermissions } from "../../core/auth.guard.js";
import { assertCompanyAccess, authed, companyScope, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";

const listSchema = paginationSchema.extend({
  companyId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  status: employeeStatus.optional(),
});

const toDate = (v?: string | null) => (v ? new Date(`${v}T00:00:00.000Z`) : v === null ? null : undefined);

const employeeInclude = {
  company: { select: { id: true, legalName: true, tradeName: true } },
  establishment: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  job: { select: { id: true, name: true, cbo: true } },
  manager: { select: { id: true, name: true } },
} as const;

@Controller("employees")
export class EmployeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("employee.view")
  async list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    const { tenantId } = authed();
    const digits = q.q?.replace(/\D/g, "") ?? "";
    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      ...companyScope(),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.establishmentId ? { establishmentId: q.establishmentId } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { registration: { contains: q.q, mode: "insensitive" } },
              ...(digits.length >= 3 ? [{ cpf: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({ where, include: employeeInclude, orderBy: { name: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.employee.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  private async load(id: string) {
    const { tenantId } = authed();
    const e = await this.prisma.employee.findFirst({ where: { id, tenantId }, include: employeeInclude });
    if (!e) throw notFound("Colaborador");
    assertCompanyAccess(e.companyId);
    return e;
  }

  @Get(":id")
  @RequirePermissions("employee.view")
  get(@Param("id") id: string) {
    return this.load(id);
  }

  private async validateRefs(tenantId: string, companyId: string, body: { establishmentId?: string | null; departmentId?: string | null; jobId?: string | null; unitId?: string | null }) {
    if (body.establishmentId) {
      const est = await this.prisma.establishment.findFirst({ where: { id: body.establishmentId, tenantId, companyId } });
      if (!est) throw new DomainError(422, "REF_INVALID", "Estabelecimento não pertence à empresa");
    }
    if (body.departmentId) {
      const dep = await this.prisma.department.findFirst({ where: { id: body.departmentId, tenantId, companyId } });
      if (!dep) throw new DomainError(422, "REF_INVALID", "Setor não pertence à empresa");
    }
    if (body.jobId) {
      const job = await this.prisma.job.findFirst({ where: { id: body.jobId, tenantId, companyId } });
      if (!job) throw new DomainError(422, "REF_INVALID", "Função não pertence à empresa");
    }
  }

  @Post()
  @RequirePermissions("employee.create")
  async create(@Body(zod(employeeCreateSchema)) body: z.infer<typeof employeeCreateSchema>) {
    const { tenantId } = authed();
    assertCompanyAccess(body.companyId);
    await this.validateRefs(tenantId, body.companyId, body);
    const dup = await this.prisma.employee.findUnique({ where: { tenantId_cpf: { tenantId, cpf: body.cpf } } });
    if (dup) throw new DomainError(409, "CPF_DUPLICATE", "Já existe colaborador com este CPF", { id: dup.id });
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          ...body,
          tenantId,
          email: body.email || null,
          birthDate: toDate(body.birthDate),
          admissionDate: toDate(body.admissionDate),
        },
        include: employeeInclude,
      });
      await tx.employeeHistory.create({
        data: {
          tenantId,
          employeeId: employee.id,
          kind: "ADMISSION",
          toValue: { jobId: employee.jobId, departmentId: employee.departmentId, establishmentId: employee.establishmentId },
          effectiveAt: employee.admissionDate ?? new Date(),
          createdById: authed().userId,
        },
      });
      await this.audit.record(tx, { action: "employee.created", entityType: "Employee", entityId: employee.id, after: employee });
      return employee;
    });
  }

  @Patch(":id")
  @RequirePermissions("employee.update")
  async update(@Param("id") id: string, @Body(zod(employeeUpdateSchema)) body: z.infer<typeof employeeUpdateSchema>) {
    const { tenantId, userId } = authed();
    const before = await this.load(id);
    await this.validateRefs(tenantId, before.companyId, body);
    const { changeReason, effectiveDate, ...data } = body;
    const effectiveAt = effectiveDate ? new Date(`${effectiveDate}T00:00:00.000Z`) : new Date();

    const tracked: Array<[string, keyof typeof before, unknown]> = [
      ["JOB_CHANGE", "jobId", data.jobId],
      ["DEPARTMENT_CHANGE", "departmentId", data.departmentId],
      ["ESTABLISHMENT_CHANGE", "establishmentId", data.establishmentId],
      ["STATUS_CHANGE", "status", data.status],
    ];

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.update({
        where: { id },
        data: {
          ...data,
          email: data.email === "" ? null : data.email,
          birthDate: toDate(data.birthDate),
          admissionDate: toDate(data.admissionDate),
          terminationDate: toDate(data.terminationDate),
        },
        include: employeeInclude,
      });
      for (const [kind, field, next] of tracked) {
        if (next !== undefined && next !== before[field]) {
          await tx.employeeHistory.create({
            data: { tenantId, employeeId: id, kind, fromValue: { [field]: before[field] ?? null }, toValue: { [field]: next ?? null }, reason: changeReason, effectiveAt, createdById: userId },
          });
        }
      }
      await this.audit.record(tx, { action: "employee.updated", entityType: "Employee", entityId: id, before, after: employee });
      return employee;
    });
  }

  /** Aba SST (§7): obrigatórios × entregues, pendências, biometria. */
  @Get(":id/sst")
  @RequirePermissions("employee.view")
  async sst(@Param("id") id: string) {
    const { tenantId } = authed();
    const employee = await this.load(id);
    const [requirements, recentItems, biometric, returns, counts] = await Promise.all([
      requirementStatus(this.prisma, tenantId, { employeeId: id }),
      this.prisma.epiDeliveryItem.findMany({
        where: { tenantId, employeeId: id, delivery: { status: "ACTIVE" } },
        include: { delivery: { select: { id: true, deliveredAt: true, publicId: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.prisma.biometricProfile.findFirst({
        where: { tenantId, employeeId: id, status: "ACTIVE" },
        select: { id: true, enrolledAt: true, quality: true, legalBasis: true },
      }),
      this.prisma.epiReturn.count({ where: { tenantId, employeeId: id, status: "ACTIVE" } }),
      this.prisma.epiDelivery.count({ where: { tenantId, employeeId: id, status: "ACTIVE" } }),
    ]);
    const pending = requirements.filter((r) => r.status !== "OK");
    const next = requirements
      .filter((r) => r.nextReplacementDue)
      .map((r) => r.nextReplacementDue!)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      employee,
      summary: {
        required: requirements.length,
        delivered: requirements.filter((r) => r.status !== "MISSING").length,
        pending: pending.length,
        lastDeliveryAt: recentItems[0]?.delivery.deliveredAt ?? null,
        nextReplacement: next ?? null,
        deliveries: counts,
        returns,
      },
      requirements,
      recentItems,
      biometric,
      health: null,
      trainings: null,
      esocial: null,
    };
  }

  @Get(":id/timeline")
  @RequirePermissions("employee.view")
  async timeline(@Param("id") id: string) {
    const { tenantId } = authed();
    await this.load(id);
    const [history, deliveries, returns, biometrics, documents] = await Promise.all([
      this.prisma.employeeHistory.findMany({ where: { tenantId, employeeId: id } }),
      this.prisma.epiDelivery.findMany({ where: { tenantId, employeeId: id }, include: { items: { select: { productDescription: true, quantity: true, reasonCode: true } } } }),
      this.prisma.epiReturn.findMany({ where: { tenantId, employeeId: id } }),
      this.prisma.biometricProfile.findMany({ where: { tenantId, employeeId: id } }),
      this.prisma.document.findMany({ where: { tenantId, entityType: "EMPLOYEE", entityId: id } }),
    ]);
    const events = [
      ...history.map((h) => ({ at: h.effectiveAt, type: `history.${h.kind}`, title: historyTitle(h.kind), detail: h.reason, ref: h.id })),
      ...deliveries.map((d) => ({
        at: d.deliveredAt,
        type: d.status === "CANCELLED" ? "delivery.cancelled" : "delivery",
        title: d.status === "CANCELLED" ? "Entrega de EPI (cancelada)" : "EPI entregue",
        detail: d.items.map((i) => `${i.quantity}× ${i.productDescription}`).join(", "),
        ref: d.id,
      })),
      ...returns.map((r) => ({ at: r.returnedAt, type: "return", title: "EPI devolvido", detail: `${r.quantity} un. — ${r.reason}`, ref: r.id })),
      ...biometrics.flatMap((b) => [
        { at: b.enrolledAt, type: "biometric.enrolled", title: "Biometria cadastrada", detail: null, ref: b.id },
        ...(b.revokedAt ? [{ at: b.revokedAt, type: "biometric.revoked", title: "Biometria revogada", detail: b.revocationReason, ref: b.id }] : []),
      ]),
      ...documents.map((d) => ({ at: d.createdAt, type: "document", title: `Documento: ${d.title}`, detail: d.category, ref: d.id })),
    ];
    return events.sort((a, b) => b.at.getTime() - a.at.getTime());
  }
}

function historyTitle(kind: string): string {
  return (
    {
      ADMISSION: "Admissão",
      JOB_CHANGE: "Troca de função",
      DEPARTMENT_CHANGE: "Troca de setor",
      ESTABLISHMENT_CHANGE: "Troca de estabelecimento",
      STATUS_CHANGE: "Mudança de situação",
    }[kind] ?? kind
  );
}
