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
  sid: string;
  metodo: "senha" | "passkey";
  /** Entrou com segundo fator na central (senha + 2FA ou biometria). */
  mfa: boolean;
}

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

export async function ssoRedeem(ticket: string): Promise<SsoIdentity> {
  let res: Response;
  try {
    res = await post("/sso/redeem", { ticket, app: SSO_APP });
  } catch {
    throw unavailable();
  }
  if (res.status >= 500) throw unavailable();
  if (!res.ok) throw invalid();
  const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: Record<string, unknown> } | null;
  const u = data?.user;
  if (!data?.ok || !u || typeof u.sid !== "string" || !u.sid || (u.app !== undefined && u.app !== SSO_APP)) throw invalid();
  return {
    cpf: String(u.cpf ?? "").replace(/\D/g, ""),
    nome: String(u.nome ?? "").trim(),
    email: String(u.email ?? "").trim().toLowerCase(),
    isAdmin: u.isAdmin === true,
    sid: u.sid,
    metodo: u.metodo === "passkey" ? "passkey" : "senha",
    mfa: u.mfa === true,
  };
}

/** false = sessão central encerrada; null = central indisponível (não derruba a sessão local). */
export async function ssoCheck(sid: string): Promise<boolean | null> {
  try {
    const res = await post("/sso/check", { sid, app: SSO_APP });
    if (res.status >= 500) return null;
    const data = (await res.json()) as { active?: boolean };
    return typeof data.active === "boolean" ? data.active : null;
  } catch {
    return null;
  }
}
