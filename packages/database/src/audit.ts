import { createHash } from "node:crypto";
import { canonicalJson } from "@preventbase/contracts";
import type { PrismaClient } from "@prisma/client";

export const GENESIS_HASH = "0".repeat(64);

export function auditHash(previousHash: string, fields: Record<string, unknown>): string {
  return createHash("sha256").update(previousHash).update(canonicalJson(fields)).digest("hex");
}

export function auditFields(row: {
  tenantId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  requestId: string | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    tenantId: row.tenantId,
    userId: row.userId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: row.ip,
    userAgent: row.userAgent,
    deviceId: row.deviceId,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AuditChainResult {
  ok: boolean;
  checked: number;
  brokenAtId?: string;
  reason?: string;
}

/** Recalcula a cadeia de hash da auditoria do tenant (§51). */
export async function verifyAuditChain(prisma: PrismaClient, tenantId: string): Promise<AuditChainResult> {
  let previousHash = GENESIS_HASH;
  let cursor: bigint | undefined;
  let checked = 0;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { tenantId, ...(cursor !== undefined ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: 1000,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.previousHash !== previousHash) return { ok: false, checked, brokenAtId: r.id.toString(), reason: "previousHash não confere" };
      if (auditHash(previousHash, auditFields(r)) !== r.currentHash) return { ok: false, checked, brokenAtId: r.id.toString(), reason: "conteúdo alterado" };
      previousHash = r.currentHash;
      checked++;
    }
    cursor = rows[rows.length - 1]!.id;
  }
  return { ok: true, checked };
}
