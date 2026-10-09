// Kit passkey (browser) — cópia idêntica nos fronts React do ecossistema.
// Fonte: C:\ROBBY\kits\passkey\ · Padrão: C:\ROBBY\docs\decisions\2026-10-09-login-passkey.md

type Json = { [key: string]: unknown };
type CredDesc = Json & { id: string };
type Cred = PublicKeyCredential & { authenticatorAttachment?: string | null };

const dec = (s: string): ArrayBuffer => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
};
const enc = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...Array.from(new Uint8Array(buf)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ids = (list: unknown) => ((list as CredDesc[] | undefined) ?? []).map((c) => ({ ...c, id: dec(c.id) }));

export function passkeySupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;
}

export async function platformPasskeyAvailable(): Promise<boolean> {
  try {
    return passkeySupported() && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** options JSON do servidor → navigator.credentials.create → JSON para o verify. */
export async function webauthnCreate(options: unknown): Promise<Json> {
  const o = options as Json & { challenge: string; user: Json & { id: string } };
  const publicKey = { ...o, challenge: dec(o.challenge), user: { ...o.user, id: dec(o.user.id) }, excludeCredentials: ids(o.excludeCredentials) };
  const cred = (await navigator.credentials.create({ publicKey: publicKey as unknown as PublicKeyCredentialCreationOptions })) as Cred;
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: enc(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: enc(r.clientDataJSON),
      attestationObject: enc(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    },
  };
}

/** options JSON do servidor → navigator.credentials.get → JSON para o verify. */
export async function webauthnGet(options: unknown): Promise<Json> {
  const o = options as Json & { challenge: string };
  const publicKey = { ...o, challenge: dec(o.challenge), allowCredentials: ids(o.allowCredentials) };
  const cred = (await navigator.credentials.get({ publicKey: publicKey as unknown as PublicKeyCredentialRequestOptions })) as Cred;
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: enc(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: enc(r.clientDataJSON),
      authenticatorData: enc(r.authenticatorData),
      signature: enc(r.signature),
      userHandle: r.userHandle ? enc(r.userHandle) : undefined,
    },
  };
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Aparelho";
  const br = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

export function passkeyMessage(e: unknown): string {
  const err = e as { name?: string; message?: string; response?: { data?: { message?: unknown; detail?: unknown; error?: unknown } } };
  if (err?.name === "NotAllowedError") return "Biometria cancelada ou expirada.";
  if (err?.name === "InvalidStateError") return "Este aparelho já tem biometria cadastrada.";
  if (err?.name === "SecurityError") return "Biometria indisponível neste endereço (use o HTTPS do servidor).";
  const data = err?.response?.data;
  const fromBody = data?.message ?? data?.detail ?? data?.error;
  if (typeof fromBody === "string" && fromBody) return fromBody;
  if (Array.isArray(fromBody) && fromBody[0]) return String(fromBody[0]);
  return err?.message || "Falha na biometria.";
}

/** Convite único após login por senha (flags por app). */
export function passkeyOffer(prefix: string) {
  const offer = `${prefix}_pk_offer`;
  const here = `${prefix}_pk_here`;
  const declined = `${prefix}_pk_declined`;
  return {
    mark: () => sessionStorage.setItem(offer, "1"),
    registeredHere: () => localStorage.setItem(here, "1"),
    removedHere: () => localStorage.removeItem(here),
    decline: () => localStorage.setItem(declined, "1"),
    async take(): Promise<boolean> {
      if (sessionStorage.getItem(offer) !== "1") return false;
      sessionStorage.removeItem(offer);
      if (localStorage.getItem(here) || localStorage.getItem(declined)) return false;
      return platformPasskeyAvailable();
    },
  };
}
