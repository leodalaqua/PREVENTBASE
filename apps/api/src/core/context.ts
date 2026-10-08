import { AsyncLocalStorage } from "node:async_hooks";
import type { PermissionKey } from "@preventbase/permissions";

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  deviceKey?: string;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  permissions?: Set<PermissionKey>;
  /** null = todas as empresas do tenant. */
  companyIds?: string[] | null;
  deviceId?: string;
  deviceStatus?: "PENDING" | "TRUSTED" | "BLOCKED";
}

export const contextStorage = new AsyncLocalStorage<RequestContext>();

export function ctx(): RequestContext {
  const c = contextStorage.getStore();
  if (!c) throw new Error("RequestContext ausente");
  return c;
}

export interface AuthedContext extends RequestContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  permissions: Set<PermissionKey>;
  companyIds: string[] | null;
}

export function authed(): AuthedContext {
  const c = ctx();
  if (!c.userId || !c.tenantId || !c.sessionId || !c.permissions) throw new Error("Contexto sem autenticação");
  return c as AuthedContext;
}

/** Filtro de escopo por empresa (perfis com companyId restrito). */
export function companyScope(field = "companyId"): Record<string, unknown> {
  const c = authed();
  return c.companyIds === null ? {} : { [field]: { in: c.companyIds } };
}

export function assertCompanyAccess(companyId: string): void {
  const c = authed();
  if (c.companyIds !== null && !c.companyIds.includes(companyId)) {
    throw new DomainError(403, "FORBIDDEN_COMPANY", "Sem acesso a esta empresa");
  }
}

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(404, "NOT_FOUND", `${what} não encontrado(a)`);
