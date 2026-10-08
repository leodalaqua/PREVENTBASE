import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { canonicalJson } from "@preventbase/contracts";
import { Prisma } from "@preventbase/database";
import { toJson } from "./audit.service.js";
import { authed, DomainError } from "./context.js";
import { PrismaService } from "./prisma.service.js";

/**
 * Idempotência genérica (§81). Mesma chave + mesmo corpo → mesma resposta; corpo diferente → 409.
 * Requisição em andamento com a mesma chave → 409 (cliente deve repetir depois).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(scope: string, key: string | undefined, body: unknown, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    if (key.length < 8 || key.length > 120) throw new DomainError(400, "IDEMPOTENCY_KEY", "Idempotency-Key inválida");
    const { tenantId } = authed();
    const requestHash = createHash("sha256").update(canonicalJson(body ?? null)).digest("hex");

    try {
      await this.prisma.idempotencyRecord.create({ data: { tenantId, scope, key, requestHash } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
      const existing = await this.prisma.idempotencyRecord.findUnique({ where: { tenantId_scope_key: { tenantId, scope, key } } });
      if (!existing) throw err;
      if (existing.requestHash !== requestHash) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "Idempotency-Key reutilizada com conteúdo diferente");
      if (existing.responseStatus === null) throw new DomainError(409, "IDEMPOTENCY_IN_PROGRESS", "Requisição idêntica ainda em processamento");
      return existing.responseBody as T;
    }

    try {
      const result = await fn();
      await this.prisma.idempotencyRecord.update({
        where: { tenantId_scope_key: { tenantId, scope, key } },
        data: { responseStatus: 200, responseBody: toJson(result) ?? Prisma.JsonNull },
      });
      return result;
    } catch (err) {
      await this.prisma.idempotencyRecord.delete({ where: { tenantId_scope_key: { tenantId, scope, key } } }).catch(() => undefined);
      throw err;
    }
  }
}
