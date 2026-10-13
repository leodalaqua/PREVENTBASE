import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Controller, Get, HttpCode, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CaepiBusyError, CaepiFileError, syncCaepiFile } from "@preventbase/caepi";
import { normalizeCaNumber, startOfUtcDay } from "@preventbase/contracts";
import { config } from "../../config.js";
import { AuditService } from "../../core/audit.service.js";
import { Acesso } from "../../core/auth.guard.js";
import { authed, DomainError } from "../../core/context.js";
import { PrismaService } from "../../core/prisma.service.js";
import { QueueService } from "../../core/queue.service.js";

@Controller("ca")
export class CaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  @Get("syncs")
  @Acesso("epi.integracao_caepi.visualizar")
  syncs() {
    return this.prisma.caSync.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
  }

  /** Consulta CA (§18): dados oficiais + última sincronização + EPIs do tenant que usam o CA. */
  @Get(":number")
  @Acesso("epi.ca.visualizar")
  async lookup(@Param("number") number: string) {
    const { tenantId } = authed();
    const caNumber = normalizeCaNumber(number);
    if (!caNumber) throw new DomainError(400, "CA_INVALID", "Número de CA inválido");
    const [ca, lastSync, products, history] = await Promise.all([
      this.prisma.caMaster.findUnique({ where: { caNumber } }),
      this.prisma.caSync.findFirst({ where: { status: "DONE" }, orderBy: { finishedAt: "desc" } }),
      this.prisma.epiProductCa.findMany({ where: { tenantId, caNumber }, include: { product: { select: { id: true, internalCode: true, description: true } } } }),
      this.prisma.caHistory.findMany({ where: { caNumber }, orderBy: { changedAt: "desc" }, take: 20, select: { changedAt: true, changedFields: true } }),
    ]);
    const today = startOfUtcDay(new Date());
    return {
      caNumber,
      found: !!ca,
      ca,
      validToday: ca?.validUntil ? ca.validUntil >= today : null,
      lastSyncAt: lastSync?.finishedAt ?? null,
      products,
      history,
      note: "CA válido hoje é diferente de CA válido na compra (§19): a entrega de lote adquirido com CA válido não é bloqueada pelo vencimento posterior.",
    };
  }

  @Post("sync")
  @Acesso("epi.integracao_caepi.atualizar")
  @HttpCode(202)
  async sync() {
    if (!config.caepiSourceUrl) throw new DomainError(422, "CAEPI_URL", "CAEPI_SOURCE_URL não configurada — use a importação manual do arquivo");
    const { userId } = authed();
    const jobId = await this.queue.enqueue("caepi-sync", { triggeredBy: userId }, `caepi-sync-${new Date().toISOString().slice(0, 13)}`);
    await this.audit.log({ action: "ca.sync_requested", entityType: "CaSync", entityId: jobId ?? null });
    return { queued: true, jobId };
  }

  /** Importação manual do tgg_export_caepi (.zip ou .txt) baixado do MTE. */
  @Post("import")
  @Acesso("epi.integracao_caepi.atualizar")
  @UseInterceptors(FileInterceptor("file", { dest: tmpdir(), limits: { fileSize: 200 * 1024 * 1024 } }))
  async import(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new DomainError(400, "FILE_REQUIRED", "Envie o arquivo da base CAEPI (.zip ou .txt)");
    const { userId } = authed();
    try {
      const result = await syncCaepiFile(this.prisma, file.path, { source: `upload:${file.originalname}`, triggeredBy: userId });
      await this.audit.log({ action: "ca.imported", entityType: "CaSync", entityId: result.syncId, after: result });
      return result;
    } catch (err) {
      if (err instanceof CaepiBusyError) throw new DomainError(409, "CAEPI_BUSY", err.message);
      if (err instanceof CaepiFileError) throw new DomainError(422, "CAEPI_FILE_INVALID", err.message);
      throw err;
    } finally {
      await rm(file.path, { force: true });
    }
  }
}
