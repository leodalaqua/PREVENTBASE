import { createHash } from "node:crypto";
import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { documentMetaSchema } from "@preventbase/contracts";
import type { Response } from "express";
import type { z } from "zod";
import { AuditService } from "../../core/audit.service.js";
import { Acesso } from "../../core/auth.guard.js";
import { authed, DomainError, notFound } from "../../core/context.js";
import { zod } from "../../core/http.js";
import { PrismaService } from "../../core/prisma.service.js";
import { StorageService } from "../../core/storage.service.js";

const MAX = 50 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp)|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|text\/(csv|plain)|application\/zip|application\/xml|text\/xml|video\/mp4)$/;

function safeName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
}

/** Central documental (§45) — arquivo no MinIO, metadados + SHA-256 no banco; versões nunca sobrescrevem (§46). */
@Controller("documents")
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Acesso("documentos.anexos.visualizar")
  list(@Query("entityType") entityType?: string, @Query("entityId") entityId?: string) {
    const { tenantId } = authed();
    return this.prisma.document.findMany({
      where: { tenantId, status: "ACTIVE", ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}) },
      include: { versions: { orderBy: { version: "desc" }, select: { version: true, filename: true, mimeType: true, size: true, sha256: true, uploadedAt: true, uploadedById: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  private validateFile(file?: Express.Multer.File): Express.Multer.File {
    if (!file) throw new DomainError(400, "FILE_REQUIRED", "Arquivo obrigatório");
    if (file.size > MAX) throw new DomainError(413, "FILE_TOO_LARGE", "Arquivo acima de 50 MB");
    if (!ALLOWED.test(file.mimetype)) throw new DomainError(415, "FILE_TYPE", `Tipo não permitido: ${file.mimetype}`);
    return file;
  }

  @Post()
  @Acesso("documentos.anexos.inserir")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX } }))
  async upload(@UploadedFile() upload: Express.Multer.File | undefined, @Body(zod(documentMetaSchema)) meta: z.infer<typeof documentMetaSchema>) {
    const { tenantId, userId } = authed();
    const file = this.validateFile(upload);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const doc = await this.prisma.document.create({
      data: { tenantId, entityType: meta.entityType, entityId: meta.entityId, category: meta.category, title: meta.title, isEvidence: meta.isEvidence, createdById: userId },
    });
    const key = `${tenantId}/${meta.entityType}/${doc.id}/v1-${safeName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.documentVersion.create({
        data: { documentId: doc.id, version: 1, filename: file.originalname, mimeType: file.mimetype, size: file.size, sha256, storagePath: key, uploadedById: userId },
      });
      await this.audit.record(tx, { action: "document.uploaded", entityType: "Document", entityId: doc.id, after: { ...meta, sha256, size: file.size } });
      return { ...doc, versions: [version] };
    });
  }

  @Post(":id/versions")
  @Acesso("documentos.anexos.inserir")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX } }))
  async newVersion(@Param("id") id: string, @UploadedFile() upload?: Express.Multer.File) {
    const { tenantId, userId } = authed();
    const file = this.validateFile(upload);
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId, status: "ACTIVE" } });
    if (!doc) throw notFound("Documento");
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const next = doc.currentVersion + 1;
    const key = `${tenantId}/${doc.entityType}/${doc.id}/v${next}-${safeName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.documentVersion.create({
        data: { documentId: id, version: next, filename: file.originalname, mimeType: file.mimetype, size: file.size, sha256, storagePath: key, uploadedById: userId },
      });
      await tx.document.update({ where: { id }, data: { currentVersion: next } });
      await this.audit.record(tx, { action: "document.versioned", entityType: "Document", entityId: id, after: { version: next, sha256 } });
      return version;
    });
  }

  @Get(":id/versions/:version/download")
  @Acesso("documentos.anexos.visualizar")
  async download(@Param("id") id: string, @Param("version") version: string, @Res() res: Response) {
    const { tenantId } = authed();
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw notFound("Documento");
    const v = await this.prisma.documentVersion.findUnique({ where: { documentId_version: { documentId: id, version: Number(version) } } });
    if (!v) throw notFound("Versão");
    const stream = await this.storage.get(v.storagePath);
    res.setHeader("Content-Type", v.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${safeName(v.filename)}"`);
    res.setHeader("X-Content-SHA256", v.sha256);
    stream.pipe(res);
  }
}
