import { normalizarPermissoes, type Permissoes } from "@preventbase/permissions";
import { config } from "../../config.js";
import { DomainError } from "../../core/context.js";

/** Login único Veritech — contrato: C:\ROBBY\docs\robby\sso-veritech.md */
export const SSO_APP = "preventbase";
const TIMEOUT_MS = 5_000;

export interface SsoIdentity {
  cpf: string;
  nome: string;
  email: string;
  isAdmin: boolean;
  permissoes: Permissoes;
  sid: string;
  metodo: "senha" | "passkey";
  /** Entrou com segundo fator na central (senha + 2FA ou biometria). */
  mfa: boolean;
}

export type SsoPasswordResult = { identity: SsoIdentity } | { mfaToken: string };

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${config.sso.internalUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const unavailable = () => new DomainError(503, "SSO_UNAVAILABLE", "Login central indisponível. Tente novamente em instantes.");
const invalid = () => new DomainError(401, "SSO_INVALID", "Login único inválido ou expirado. Entre novamente.");

async function call(path: string, body: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await post(path, body);
  } catch {
    throw unavailable();
  }
  if (res.status >= 500) throw unavailable();
  return res;
}

function toIdentity(data: { ok?: boolean; user?: Record<string, unknown> } | null): SsoIdentity {
  const u = data?.user;
  if (!data?.ok || !u || typeof u.sid !== "string" || !u.sid || (u.app !== undefined && u.app !== SSO_APP)) throw invalid();
  return {
    cpf: String(u.cpf ?? "").replace(/\D/g, ""),
    nome: String(u.nome ?? "").trim(),
    email: String(u.email ?? "").trim().toLowerCase(),
    isAdmin: u.isAdmin === true,
    permissoes: normalizarPermissoes(u.permissoes),
    sid: u.sid,
    metodo: u.metodo === "passkey" ? "passkey" : "senha",
    mfa: u.mfa === true,
  };
}

export async function ssoRedeem(ticket: string): Promise<SsoIdentity> {
  const res = await call("/sso/redeem", { ticket, app: SSO_APP });
  if (!res.ok) throw invalid();
  return toIdentity((await res.json().catch(() => null)) as Parameters<typeof toIdentity>[0]);
}

/** "Usar conta local": CPF/e-mail + senha Veritech validados na central (`/sso/password` e `/sso/password/2fa`). */
export async function ssoPassword(input: { login: string; senha: string } | { mfaToken: string; codigo: string }, ip: string | undefined): Promise<SsoPasswordResult> {
  const path = "mfaToken" in input ? "/sso/password/2fa" : "/sso/password";
  const res = await call(path, { ...input, app: SSO_APP, ip: ip ?? "" });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; mfa?: boolean; mfaToken?: string; error?: string; user?: Record<string, unknown> } | null;
  const msg = typeof data?.error === "string" && data.error ? data.error : null;
  if (res.status === 429) throw new DomainError(429, "TOO_MANY_ATTEMPTS", msg ?? "Login bloqueado após 3 tentativas. Aguarde 15 minutos.");
  if (res.status === 403) throw new DomainError(403, "SSO_FORBIDDEN", msg ?? "Sem acesso ao PreventBase no login único Veritech.");
  if (!res.ok) throw new DomainError(401, "INVALID_CREDENTIALS", msg ?? "CPF/e-mail ou senha inválidos");
  if (data?.ok && data.mfa === true && typeof data.mfaToken === "string" && data.mfaToken) return { mfaToken: data.mfaToken };
  return { identity: toIdentity(data) };
}

export interface SsoCheck {
  active: boolean;
  isAdmin: boolean;
  permissoes: Permissoes;
}

/** null = central indisponível (não derruba a sessão local). */
export async function ssoCheck(sid: string): Promise<SsoCheck | null> {
  try {
    const res = await post("/sso/check", { sid, app: SSO_APP });
    if (res.status >= 500) return null;
    const data = (await res.json()) as { active?: unknown; isAdmin?: unknown; permissoes?: unknown };
    if (typeof data.active !== "boolean") return null;
    return { active: data.active, isAdmin: data.isAdmin === true, permissoes: normalizarPermissoes(data.permissoes) };
  } catch {
    return null;
  }
}
