import { createHash } from "node:crypto";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  deliveryReasonSchema,
  epiProductSchema,
  epiProductUpdateSchema,
  epiVariantSchema,
  normalizeCaNumber,
  paginationSchema,
  termsSchema,
} from "@preventbase/contracts";
import type { Prisma } from "@preventbase/database";
import { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Acesso } from "../../core/auth.guard.js";
import { authed, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";

const listSchema = paginationSchema.extend({ category: z.string().optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional() });

function sku(code: string, size?: string | null, color?: string | null): string {
  return [code, size, color].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, "");
}

@Controller()
export class EpiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("epis")
  @Acesso("epi.catalogo.visualizar", "entregas.entregas.inserir", "entregas.devolucoes.inserir", "estoque.saldos.visualizar", "estoque.inventarios.visualizar", "administracao.funcoes_epi.visualizar")
  async list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    const { tenantId } = authed();
    const where: Prisma.EpiProductWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.q
        ? {
            OR: [
              { description: { contains: q.q, mode: "insensitive" } },
              { internalCode: { contains: q.q, mode: "insensitive" } },
              { cas: { some: { caNumber: normalizeCaNumber(q.q) || "-", isCurrent: true } } },
              { variants: { some: { OR: [{ ean: q.q }, { sku: { contains: q.q, mode: "insensitive" } }] } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.epiProduct.findMany({
        where,
        include: { variants: { where: { active: true }, orderBy: { sku: "asc" } }, cas: { where: { isCurrent: true } } },
        orderBy: { description: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.epiProduct.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get("epis/:id")
  @Acesso("epi.catalogo.visualizar", "entregas.entregas.inserir", "entregas.devolucoes.inserir", "estoque.saldos.visualizar", "estoque.inventarios.visualizar", "administracao.funcoes_epi.visualizar")
  async get(@Param("id") id: string) {
    const { tenantId } = authed();
    const product = await this.prisma.epiProduct.findFirst({
      where: { id, tenantId },
      include: { variants: { orderBy: { sku: "asc" } }, cas: { orderBy: { linkedAt: "desc" } } },
    });
    if (!product) throw notFound("EPI");
    const current = product.cas.find((c) => c.isCurrent);
    const ca = current ? await this.prisma.caMaster.findUnique({ where: { caNumber: current.caNumber } }) : null;
    return { ...product, ca };
  }

  @Post("epis")
  @Acesso("epi.catalogo.inserir")
  async create(@Body(zod(epiProductSchema)) body: z.infer<typeof epiProductSchema>) {
    const { tenantId, userId } = authed();
    const { variants, caNumber, guidance, ...data } = body;
    const list = variants && variants.length > 0 ? variants : [{ size: null, color: null, ean: null }];
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.epiProduct.create({
        data: {
          ...data,
          tenantId,
          guidance: (guidance ?? {}) as Prisma.InputJsonValue,
          variants: { create: list.map((v) => ({ tenantId, size: v.size ?? null, color: v.color ?? null, ean: v.ean ?? null, sku: sku(data.internalCode, v.size, v.color) })) },
          ...(caNumber ? { cas: { create: [{ tenantId, caNumber: normalizeCaNumber(caNumber), linkedById: userId }] } } : {}),
        },
        include: { variants: true, cas: true },
      });
      await this.audit.record(tx, { action: "epi.created", entityType: "EpiProduct", entityId: product.id, after: product });
      return product;
    });
  }

  @Patch("epis/:id")
  @Acesso("epi.catalogo.alterar")
  async update(@Param("id") id: string, @Body(zod(epiProductUpdateSchema)) body: z.infer<typeof epiProductUpdateSchema>) {
    const { tenantId, userId } = authed();
    const before = await this.prisma.epiProduct.findFirst({ where: { id, tenantId }, include: { cas: { where: { isCurrent: true } } } });
    if (!before) throw notFound("EPI");
    const { caNumber, guidance, ...data } = body;
    return this.prisma.$transaction(async (tx) => {
      if (caNumber !== undefined) {
        const next = caNumber ? normalizeCaNumber(caNumber) : null;
        const current = before.cas[0]?.caNumber ?? null;
        if (next !== current) {
          await tx.epiProductCa.updateMany({ where: { productId: id, isCurrent: true }, data: { isCurrent: false, unlinkedAt: new Date() } });
          if (next) await tx.epiProductCa.create({ data: { tenantId, productId: id, caNumber: next, linkedById: userId } });
        }
      }
      const product = await tx.epiProduct.update({
        where: { id },
        data: { ...data, ...(guidance ? { guidance: guidance as Prisma.InputJsonValue } : {}) },
        include: { variants: true, cas: { where: { isCurrent: true } } },
      });
      await this.audit.record(tx, { action: "epi.updated", entityType: "EpiProduct", entityId: id, before, after: product });
      return product;
    });
  }

  @Post("epis/:id/variants")
  @Acesso("epi.catalogo.alterar")
  async addVariant(@Param("id") id: string, @Body(zod(epiVariantSchema)) body: z.infer<typeof epiVariantSchema>) {
    const { tenantId } = authed();
    const product = await this.prisma.epiProduct.findFirst({ where: { id, tenantId } });
    if (!product) throw notFound("EPI");
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.epiVariant.create({
        data: { tenantId, productId: id, size: body.size ?? null, color: body.color ?? null, ean: body.ean ?? null, sku: sku(product.internalCode, body.size, body.color) },
      });
      await this.audit.record(tx, { action: "epi.variant_created", entityType: "EpiVariant", entityId: variant.id, after: variant });
      return variant;
    });
  }

  @Patch("epis/:id/variants/:variantId")
  @Acesso("epi.catalogo.alterar")
  async updateVariant(@Param("id") id: string, @Param("variantId") variantId: string, @Body(zod(epiVariantSchema.extend({ active: z.boolean().optional() }).partial())) body: { ean?: string | null; active?: boolean }) {
    const { tenantId } = authed();
    const before = await this.prisma.epiVariant.findFirst({ where: { id: variantId, productId: id, tenantId } });
    if (!before) throw notFound("Variação");
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.epiVariant.update({ where: { id: variantId }, data: { ean: body.ean, active: body.active } });
      await this.audit.record(tx, { action: "epi.variant_updated", entityType: "EpiVariant", entityId: variantId, before, after: variant });
      return variant;
    });
  }

  /** Busca por código de barras/QR: EAN da variação ou código público do lote (§25). */
  @Get("scan/:code")
  @Acesso("epi.catalogo.visualizar", "entregas.entregas.inserir", "entregas.devolucoes.inserir", "estoque.saldos.visualizar", "estoque.inventarios.visualizar", "administracao.funcoes_epi.visualizar")
  async scan(@Param("code") code: string) {
    const { tenantId } = authed();
    const lot = await this.prisma.stockLot.findFirst({
      where: { tenantId, publicCode: code },
      include: { variant: { include: { product: true } } },
    });
    if (lot) return { kind: "lot", lot, variant: lot.variant, product: lot.variant.product };
    const variant = await this.prisma.epiVariant.findFirst({ where: { tenantId, OR: [{ ean: code }, { sku: code.toUpperCase() }] }, include: { product: true } });
    if (variant) return { kind: "variant", variant, product: variant.product };
    throw notFound("Código");
  }

  /* ---------- motivos (§13) ---------- */

  @Get("delivery-reasons")
  @Acesso("*")
  reasons() {
    const { tenantId } = authed();
    return this.prisma.deliveryReason.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } });
  }

  @Post("delivery-reasons")
  @Acesso("administracao.parametros.inserir", "administracao.parametros.alterar")
  upsertReason(@Body(zod(deliveryReasonSchema)) body: z.infer<typeof deliveryReasonSchema>) {
    const { tenantId } = authed();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.deliveryReason.findUnique({ where: { tenantId_code: { tenantId, code: body.code } } });
      const reason = await tx.deliveryReason.upsert({ where: { tenantId_code: { tenantId, code: body.code } }, update: body, create: { tenantId, ...body } });
      await this.audit.record(tx, { action: "settings.delivery_reason", entityType: "DeliveryReason", entityId: reason.id, before, after: reason });
      return reason;
    });
  }

  /* ---------- termos versionados (§10) ---------- */

  @Get("delivery-terms/active")
  @Acesso("*")
  async activeTerms() {
    const { tenantId } = authed();
    const terms = await this.prisma.deliveryTerms.findFirst({ where: { tenantId, active: true }, orderBy: { version: "desc" } });
    if (!terms) throw new DomainError(500, "TERMS_MISSING", "Termo de entrega não configurado");
    return terms;
  }

  @Get("delivery-terms")
  @Acesso("administracao.parametros.visualizar")
  allTerms() {
    const { tenantId } = authed();
    return this.prisma.deliveryTerms.findMany({ where: { tenantId }, orderBy: { version: "desc" } });
  }

  @Post("delivery-terms")
  @Acesso("administracao.parametros.inserir")
  newTerms(@Body(zod(termsSchema)) body: z.infer<typeof termsSchema>) {
    const { tenantId, userId } = authed();
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.deliveryTerms.findFirst({ where: { tenantId }, orderBy: { version: "desc" } });
      await tx.deliveryTerms.updateMany({ where: { tenantId, active: true }, data: { active: false } });
      const terms = await tx.deliveryTerms.create({
        data: { tenantId, version: (last?.version ?? 0) + 1, text: body.text, textHash: createHash("sha256").update(body.text, "utf8").digest("hex"), createdById: userId },
      });
      await this.audit.record(tx, { action: "settings.delivery_terms", entityType: "DeliveryTerms", entityId: terms.id, after: terms });
      return terms;
    });
  }
}
