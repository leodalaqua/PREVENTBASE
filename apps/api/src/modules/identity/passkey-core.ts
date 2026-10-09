import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

// Núcleo WebAuthn (passkey) do ecossistema — contrato em C:\ROBBY\docs\decisions\2026-10-09-login-passkey.md.
// Mesmo arquivo em todos os backends Node; só o armazenamento e a emissão de sessão mudam por app.

export type PasskeyConfig = { rpId: string; rpName: string; origins: string[] };

export type PasskeyCredential = {
  /** credential id (base64url) */
  id: string;
  userKey: string;
  /** chave pública COSE (base64url) */
  publicKey: string;
  counter: number;
  transports: string[];
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export class PasskeyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const DEFAULT_RP_ID = "servidor.taild57d57.ts.net";
const CHALLENGE_TTL_MS = 5 * 60_000;

/** `defaultOrigins`: portas HTTPS tailnet do app (`httpsPort` em C:\ROBBY\config\magicdns.json). */
export function passkeyConfig(rpName: string, defaultHttpsPorts: number[], env: NodeJS.ProcessEnv = process.env): PasskeyConfig {
  const rpId = (env.WEBAUTHN_RP_ID ?? "").trim() || DEFAULT_RP_ID;
  const fromEnv = (env.WEBAUTHN_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const origins = fromEnv.length ? fromEnv : defaultHttpsPorts.map((p) => `https://${rpId}:${p}`);
  return { rpId, rpName: (env.WEBAUTHN_RP_NAME ?? "").trim() || rpName, origins };
}

export function newUserHandle(): string {
  return randomBytes(32).toString("base64url");
}

type Pending = { kind: "register" | "login"; userKey: string | null; exp: number };
const pending = new Map<string, Pending>();

function remember(challenge: string, entry: Omit<Pending, "exp">): void {
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp <= now) pending.delete(k);
  if (pending.size > 5000) pending.clear();
  pending.set(challenge, { ...entry, exp: now + CHALLENGE_TTL_MS });
}

/** Challenge de uso único: consumido na primeira verificação, válida ou não. */
function consume(challenge: string, kind: Pending["kind"], userKey: string | null): boolean {
  const entry = pending.get(challenge);
  pending.delete(challenge);
  return !!entry && entry.kind === kind && entry.userKey === userKey && entry.exp > Date.now();
}

const transportsOf = (c: PasskeyCredential) => c.transports as AuthenticatorTransportFuture[];

export async function registrationOptions(
  cfg: PasskeyConfig,
  user: { key: string; handle: string; email: string; displayName: string },
  existing: PasskeyCredential[],
) {
  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userID: Buffer.from(user.handle, "base64url"),
    // Mesma RP ID em todos os apps: o nome do sistema no seletor do celular diferencia as passkeys.
    userName: `${user.email} (${cfg.rpName})`,
    userDisplayName: `${user.displayName} (${cfg.rpName})`,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: transportsOf(c) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    timeout: CHALLENGE_TTL_MS,
  });
  remember(options.challenge, { kind: "register", userKey: user.key });
  return options;
}

export async function verifyRegistration(
  cfg: PasskeyConfig,
  userKey: string,
  response: unknown,
  deviceName: string,
): Promise<PasskeyCredential> {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: (c) => consume(c, "register", userKey),
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new PasskeyError(`Biometria não confirmada: ${err instanceof Error ? err.message : err}`);
  }
  if (!result.verified || !result.registrationInfo) throw new PasskeyError("Biometria não confirmada.");
  const { credential } = result.registrationInfo;
  return {
    id: credential.id,
    userKey,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceName: cleanDeviceName(deviceName),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

export async function loginOptions(cfg: PasskeyConfig) {
  const options = await generateAuthenticationOptions({
    rpID: cfg.rpId,
    userVerification: "required",
    timeout: CHALLENGE_TTL_MS,
  });
  remember(options.challenge, { kind: "login", userKey: null });
  return options;
}

/** `lookup` busca a credencial no banco do app; ausente = passkey de outro sistema ou removida. */
export async function verifyLogin(
  cfg: PasskeyConfig,
  response: unknown,
  lookup: (credentialId: string) => Promise<PasskeyCredential | null | undefined>,
): Promise<{ credential: PasskeyCredential; newCounter: number }> {
  const body = response as AuthenticationResponseJSON;
  if (!body || typeof body.id !== "string") throw new PasskeyError("Requisição inválida.");
  const credential = await lookup(body.id);
  if (!credential) throw new PasskeyError("Esta biometria não está cadastrada neste sistema. Entre com a senha e ative a biometria.", 401);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: (c) => consume(c, "login", null),
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpId,
      credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: transportsOf(credential) },
      requireUserVerification: true,
    });
  } catch {
    throw new PasskeyError("Biometria não confirmada. Tente de novo ou entre com a senha.", 401);
  }
  if (!result.verified) throw new PasskeyError("Biometria não confirmada.", 401);
  return { credential, newCounter: result.authenticationInfo.newCounter };
}

export function cleanDeviceName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
  return s || "Aparelho";
}

/** Formato devolvido ao front em "Meus aparelhos" (sem chave pública). */
export function publicView(c: PasskeyCredential) {
  return { id: c.id, deviceName: c.deviceName, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt };
}
