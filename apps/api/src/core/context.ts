import { AsyncLocalStorage } from "node:async_hooks";
import type { Acesso } from "@preventbase/permissions";

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  deviceKey?: string;
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  /** isAdmin + permissoes da central Veritech (gravados na sessão). */
  acesso?: Acesso;
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
  acesso: Acesso;
}

export function authed(): AuthedContext {
  const c = ctx();
  if (!c.userId || !c.tenantId || !c.sessionId || !c.acesso) throw new Error("Contexto sem autenticação");
  return c as AuthedContext;
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
