"use client";

import { api, setTokens } from "./api";

/** Login único Veritech — C:\ROBBY\docs\robby\sso-veritech.md */
export interface SsoConfig {
  url: string;
  app: string;
  local: boolean;
}

const AUTO_KEY = "pb.ssoAuto";
let configPromise: Promise<SsoConfig> | null = null;

export function ssoConfig(): Promise<SsoConfig> {
  configPromise ??= api.get<SsoConfig>("/auth/sso-config").catch((err) => {
    configPromise = null;
    throw err;
  });
  return configPromise;
}

/** Tira o `sso_ticket` da URL (history.replaceState) e devolve o valor. */
export function takeSsoTicket(): string | null {
  const url = new URL(location.href);
  const ticket = url.searchParams.get("sso_ticket");
  if (!ticket) return null;
  url.searchParams.delete("sso_ticket");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return ticket;
}

export function ssoAuthorizeUrl(cfg: SsoConfig): string {
  const back = new URL(location.href);
  back.searchParams.delete("sso_ticket");
  return `${cfg.url}/sso/authorize?app=${encodeURIComponent(cfg.app)}&return_to=${encodeURIComponent(back.href)}`;
}

export function ssoLogoutUrl(cfg: SsoConfig): string {
  return `${cfg.url}/sair?return_to=${encodeURIComponent(`${location.origin}/login`)}`;
}

/** Redirecionamento automático à central só uma vez por aba (evita loop). */
export function ssoAutoRedirectOnce(): boolean {
  if (sessionStorage.getItem(AUTO_KEY)) return false;
  sessionStorage.setItem(AUTO_KEY, "1");
  return true;
}

export async function ssoLogin(body: { ticket: string } | { mfaToken: string; mfaCode: string }): Promise<void> {
  setTokens(await api.post<{ accessToken: string; refreshToken: string }>("/auth/sso", body));
}
