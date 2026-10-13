import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { companySchema, departmentSchema, establishmentSchema, jobRequirementSchema, jobSchema, unitSchema } from "@preventbase/contracts";
import { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Acesso } from "../../core/auth.guard.js";
import { authed, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";

const activeSchema = z.object({ active: z.boolean() });

@Controller()
export class OrganizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------- companies ---------- */

  @Get("companies")
  @Acesso("*")
  companies() {
    const { tenantId } = authed();
    return this.prisma.company.findMany({ where: { tenantId }, orderBy: { legalName: "asc" } });
  }

  @Post("companies")
  @Acesso("administracao.organizacao.inserir")
  createCompany(@Body(zod(companySchema)) body: z.infer<typeof companySchema>) {
    const { tenantId } = authed();
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { tenantId, ...body } });
      await this.audit.record(tx, { action: "company.created", entityType: "Company", entityId: company.id, after: company });
      return company;
    });
  }

  @Patch("companies/:id")
  @Acesso("administracao.organizacao.alterar")
  async updateCompany(@Param("id") id: string, @Body(zod(companySchema.partial().merge(activeSchema.partial()))) body: Record<string, unknown>) {
    const { tenantId } = authed();
    const before = await this.prisma.company.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Empresa");
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.update({ where: { id }, data: body });
      await this.audit.record(tx, { action: "company.updated", entityType: "Company", entityId: id, before, after: company });
      return company;
    });
  }

  /* ---------- establishments / units / departments ---------- */

  @Get("establishments")
  @Acesso("*")
  establishments(@Query("companyId") companyId?: string) {
    const { tenantId } = authed();
    return this.prisma.establishment.findMany({
      where: { tenantId, ...(companyId ? { companyId } : {}) },
      include: { company: { select: { tradeName: true, legalName: true } } },
      orderBy: { name: "asc" },
    });
  }

  @Post("establishments")
  @Acesso("administracao.organizacao.inserir")
  async createEstablishment(@Body(zod(establishmentSchema)) body: z.infer<typeof establishmentSchema>) {
    const { tenantId } = authed();
    const company = await this.prisma.company.findFirst({ where: { id: body.companyId, tenantId } });
    if (!company) throw notFound("Empresa");
    return this.prisma.$transaction(async (tx) => {
      const est = await tx.establishment.create({ data: { tenantId, ...body } });
      await this.audit.record(tx, { action: "establishment.created", entityType: "Establishment", entityId: est.id, after: est });
      return est;
    });
  }

  @Patch("establishments/:id")
  @Acesso("administracao.organizacao.alterar")
  async updateEstablishment(@Param("id") id: string, @Body(zod(establishmentSchema.omit({ companyId: true }).partial().merge(activeSchema.partial()))) body: Record<string, unknown>) {
    const { tenantId } = authed();
    const before = await this.prisma.establishment.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Estabelecimento");
    return this.prisma.$transaction(async (tx) => {
      const est = await tx.establishment.update({ where: { id }, data: body });
      await this.audit.record(tx, { action: "establishment.updated", entityType: "Establishment", entityId: id, before, after: est });
      return est;
    });
  }

  @Get("units")
  @Acesso("*")
  units(@Query("establishmentId") establishmentId?: string) {
    const { tenantId } = authed();
    return this.prisma.unit.findMany({ where: { tenantId, ...(establishmentId ? { establishmentId } : {}) }, orderBy: { name: "asc" } });
  }

  @Post("units")
  @Acesso("administracao.organizacao.inserir")
  async createUnit(@Body(zod(unitSchema)) body: z.infer<typeof unitSchema>) {
    const { tenantId } = authed();
    const est = await this.prisma.establishment.findFirst({ where: { id: body.establishmentId, tenantId } });
    if (!est) throw notFound("Estabelecimento");
    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.unit.create({ data: { tenantId, companyId: est.companyId, ...body } });
      await this.audit.record(tx, { action: "unit.created", entityType: "Unit", entityId: unit.id, after: unit });
      return unit;
    });
  }

  @Get("departments")
  @Acesso("*")
  departments(@Query("establishmentId") establishmentId?: string, @Query("companyId") companyId?: string) {
    const { tenantId } = authed();
    return this.prisma.department.findMany({
      where: { tenantId, ...(establishmentId ? { establishmentId } : {}), ...(companyId ? { companyId } : {}) },
      include: { establishment: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
  }

  @Post("departments")
  @Acesso("administracao.organizacao.inserir")
  async createDepartment(@Body(zod(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    const { tenantId } = authed();
    const est = await this.prisma.establishment.findFirst({ where: { id: body.establishmentId, tenantId } });
    if (!est) throw notFound("Estabelecimento");
    return this.prisma.$transaction(async (tx) => {
      const dep = await tx.department.create({ data: { tenantId, companyId: est.companyId, ...body } });
      await this.audit.record(tx, { action: "department.created", entityType: "Department", entityId: dep.id, after: dep });
      return dep;
    });
  }

  @Patch("departments/:id")
  @Acesso("administracao.organizacao.alterar")
  async updateDepartment(@Param("id") id: string, @Body(zod(departmentSchema.omit({ establishmentId: true }).partial().merge(activeSchema.partial()))) body: Record<string, unknown>) {
    const { tenantId } = authed();
    const before = await this.prisma.department.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Setor");
    return this.prisma.$transaction(async (tx) => {
      const dep = await tx.department.update({ where: { id }, data: body });
      await this.audit.record(tx, { action: "department.updated", entityType: "Department", entityId: id, before, after: dep });
      return dep;
    });
  }

  /* ---------- jobs (funções) + matriz Função × EPI ---------- */

  @Get("jobs")
  @Acesso("*")
  jobs(@Query("companyId") companyId?: string) {
    const { tenantId } = authed();
    return this.prisma.job.findMany({
      where: { tenantId, ...(companyId ? { companyId } : {}) },
      include: { _count: { select: { employees: true, epiRequirements: { where: { active: true } } } } },
      orderBy: { name: "asc" },
    });
  }

  @Post("jobs")
  @Acesso("administracao.funcoes_epi.inserir")
  async createJob(@Body(zod(jobSchema)) body: z.infer<typeof jobSchema>) {
    const { tenantId } = authed();
    const company = await this.prisma.company.findFirst({ where: { id: body.companyId, tenantId } });
    if (!company) throw notFound("Empresa");
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.create({ data: { tenantId, ...body } });
      await this.audit.record(tx, { action: "job.created", entityType: "Job", entityId: job.id, after: job });
      return job;
    });
  }

  @Patch("jobs/:id")
  @Acesso("administracao.funcoes_epi.alterar")
  async updateJob(@Param("id") id: string, @Body(zod(jobSchema.omit({ companyId: true }).partial().merge(activeSchema.partial()))) body: Record<string, unknown>) {
    const { tenantId } = authed();
    const before = await this.prisma.job.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Função");
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({ where: { id }, data: body });
      await this.audit.record(tx, { action: "job.updated", entityType: "Job", entityId: id, before, after: job });
      return job;
    });
  }

  @Get("jobs/:id/epi-requirements")
  @Acesso("administracao.funcoes_epi.visualizar")
  async requirements(@Param("id") id: string) {
    const { tenantId } = authed();
    return this.prisma.epiJobRequirement.findMany({
      where: { tenantId, jobId: id, active: true },
      include: { product: { select: { id: true, internalCode: true, description: true, category: true, replacementDays: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  @Put("jobs/:id/epi-requirements")
  @Acesso("administracao.funcoes_epi.alterar")
  async upsertRequirement(@Param("id") id: string, @Body(zod(jobRequirementSchema)) body: z.infer<typeof jobRequirementSchema>) {
    const { tenantId } = authed();
    const job = await this.prisma.job.findFirst({ where: { id, tenantId } });
    if (!job) throw notFound("Função");
    const product = await this.prisma.epiProduct.findFirst({ where: { id: body.productId, tenantId } });
    if (!product) throw notFound("EPI");
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.epiJobRequirement.findUnique({ where: { jobId_productId: { jobId: id, productId: body.productId } } });
      const req = await tx.epiJobRequirement.upsert({
        where: { jobId_productId: { jobId: id, productId: body.productId } },
        update: { quantity: body.quantity, replacementDays: body.replacementDays ?? null, notes: body.notes ?? null, active: true },
        create: { tenantId, jobId: id, productId: body.productId, quantity: body.quantity, replacementDays: body.replacementDays ?? null, notes: body.notes ?? null },
      });
      await this.audit.record(tx, { action: "job.epi_requirement_set", entityType: "Job", entityId: id, before, after: req });
      return req;
    });
  }

  @Delete("jobs/:id/epi-requirements/:productId")
  @Acesso("administracao.funcoes_epi.excluir")
  @HttpCode(204)
  async removeRequirement(@Param("id") id: string, @Param("productId") productId: string) {
    const { tenantId } = authed();
    const req = await this.prisma.epiJobRequirement.findFirst({ where: { tenantId, jobId: id, productId } });
    if (!req) throw notFound("Requisito");
    await this.prisma.$transaction(async (tx) => {
      await tx.epiJobRequirement.update({ where: { id: req.id }, data: { active: false } });
      await this.audit.record(tx, { action: "job.epi_requirement_removed", entityType: "Job", entityId: id, before: req });
    });
  }
}
