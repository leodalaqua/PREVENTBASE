import { Injectable } from "@nestjs/common";
import { auditFields, auditHash, GENESIS_HASH, type AuditChainResult, type Prisma, verifyAuditChain } from "@preventbase/database";
import { ctx } from "./context.js";
import { PrismaService } from "./prisma.service.js";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  tenantId?: string;
  userId?: string | null;
}

/** Normaliza para o mesmo JSON que volta do jsonb (Date→ISO, Decimal→string). */
export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava na mesma transação da operação. Encadeamento serializado por tenant (advisory lock). */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const c = ctx();
    const tenantId = entry.tenantId ?? c.tenantId;
    if (!tenantId) throw new Error("Auditoria sem tenant");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + tenantId}))`;
    const last = await tx.auditLog.findFirst({ where: { tenantId }, orderBy: { id: "desc" }, select: { currentHash: true } });
    const previousHash = last?.currentHash ?? GENESIS_HASH;
    const row = {
      tenantId,
      userId: entry.userId === undefined ? (c.userId ?? null) : entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before) ?? null,
      after: toJson(entry.after) ?? null,
      ip: c.ip ?? null,
      userAgent: c.userAgent ?? null,
      deviceId: c.deviceId ?? null,
      requestId: c.requestId ?? null,
      createdAt: new Date(),
    };
    const currentHash = auditHash(previousHash, auditFields(row));
    await tx.auditLog.create({
      data: {
        ...row,
        before: row.before ?? undefined,
        after: row.after ?? undefined,
        previousHash,
        currentHash,
      },
    });
  }

  /** Atalho para operações sem outra escrita transacional. */
  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.$transaction((tx) => this.record(tx, entry));
  }

  verifyChain(tenantId: string): Promise<AuditChainResult> {
    return verifyAuditChain(this.prisma, tenantId);
  }
}
