"use client";

// Kit passkey (UI React) — cópia idêntica nos fronts React do ecossistema; sem dependência do UI kit do app.
// Fonte: C:\ROBBY\kits\passkey\ · Padrão: C:\ROBBY\docs\decisions\2026-10-09-login-passkey.md
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  deviceName,
  optionsCache,
  passkeyMessage,
  passkeyOffer,
  passkeySupported,
  webauthnCreate,
  webauthnGet,
} from "./webauthn-browser";

export type PasskeyItem = { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null };

export type PasskeyApi = {
  /** Prefixo das flags no storage (ex.: "pid"). */
  prefix: string;
  loginOptions: () => Promise<unknown>;
  /** Conclui o login no app (grava token/cookie) com a resposta do verify. */
  loginVerify: (response: unknown) => Promise<unknown>;
  registerOptions: () => Promise<unknown>;
  registerVerify: (response: unknown, deviceName: string) => Promise<unknown>;
  list: () => Promise<PasskeyItem[]>;
  remove: (id: string) => Promise<unknown>;
};

export const PASSKEY_OPEN_EVENT = "passkeys:open";
export const openPasskeys = () => window.dispatchEvent(new Event(PASSKEY_OPEN_EVENT));

const S: Record<string, CSSProperties> = {
  btn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 40, padding: "0 14px",
    borderRadius: 8, border: "1px solid currentColor", background: "transparent", color: "inherit", font: "inherit",
    fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%",
  },
  primary: { background: "#1d4ed8", borderColor: "#1d4ed8", color: "#fff" },
  danger: { width: "auto", minHeight: 32, fontSize: 12, background: "#b42318", borderColor: "#b42318", color: "#fff" },
  or: { display: "flex", alignItems: "center", gap: 10, fontSize: 12, opacity: 0.7, margin: 0 },
  line: { flex: 1, height: 1, background: "currentColor", opacity: 0.25 },
  veil: {
    position: "fixed", inset: 0, zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16, background: "rgba(0,0,0,.5)",
  },
  card: {
    width: "min(100%, 400px)", display: "grid", gap: 14, padding: 20, borderRadius: 12, background: "#fff", color: "#1a1a2e",
    boxShadow: "0 20px 50px -20px rgba(0,0,0,.5)", fontFamily: "inherit",
  },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 },
  item: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #e2e5eb", borderRadius: 8, fontSize: 14 },
  err: { margin: 0, color: "#b42318", fontSize: 13 },
  muted: { margin: 0, color: "#5c6578", fontSize: 13 },
};

function Fingerprint() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}

/** "Entrar com biometria" + separador "ou com senha". Some fora de HTTPS/sem WebAuthn. */
export function PasskeyLoginButton({
  api,
  onDone,
  onError,
  className,
  style,
}: {
  api: PasskeyApi;
  onDone: (result: unknown) => void | Promise<void>;
  onError: (message: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const cache = useMemo(() => optionsCache(() => api.loginOptions()), [api]);
  useEffect(() => {
    const ok = passkeySupported();
    setShow(ok);
    if (ok) cache.warm();
  }, [cache]);
  if (!show) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        style={className ? style : { ...S.btn, ...style }}
        disabled={busy}
        onClick={async () => {
          const ready = cache.take();
          onError("");
          setBusy(true);
          try {
            const response = await webauthnGet(ready ?? (await cache.fetchNow()));
            await onDone(await api.loginVerify(response));
          } catch (e) {
            onError(passkeyMessage(e));
            cache.warm();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Fingerprint />
        {busy ? "Aguardando biometria..." : "Entrar com biometria"}
      </button>
      <p style={S.or}>
        <span style={S.line} />
        ou com senha
        <span style={S.line} />
      </p>
    </>
  );
}

/** Lista + "Ativar neste aparelho". Usável dentro de uma página (ex.: Conta/Segurança) ou no modal. */
export function PasskeyPanel({ api, invite = false, onDone }: { api: PasskeyApi; invite?: boolean; onDone?: () => void }) {
  const [items, setItems] = useState<PasskeyItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const offer = passkeyOffer(api.prefix);
  const cache = useMemo(() => optionsCache(() => api.registerOptions()), [api]);

  const load = useCallback(async () => {
    if (invite) return;
    try {
      setItems(await api.list());
    } catch (e) {
      setError(passkeyMessage(e));
    }
  }, [api, invite]);

  useEffect(() => {
    load();
    if (passkeySupported()) cache.warm();
  }, [load, cache]);

  const add = async () => {
    const ready = cache.take();
    setError("");
    setBusy(true);
    try {
      const response = await webauthnCreate(ready ?? (await cache.fetchNow()));
      await api.registerVerify(response, deviceName());
      offer.registeredHere();
      if (invite) onDone?.();
      else await load();
    } catch (e) {
      setError(passkeyMessage(e));
    } finally {
      cache.warm();
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={S.muted}>
        {invite
          ? "Entre nas próximas vezes com a digital ou o rosto, sem digitar senha."
          : "Aparelhos que entram com digital ou rosto (biometria do celular ou do computador)."}
      </p>
      {!invite && (
        <ul style={S.list}>
          {items.length === 0 && <li style={S.muted}>Nenhum aparelho cadastrado.</li>}
          {items.map((it) => (
            <li key={it.id} style={S.item}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontWeight: 600 }}>{it.deviceName}</strong>
                <small style={{ color: "#5c6578" }}>
                  Último uso: {it.lastUsedAt ? new Date(it.lastUsedAt).toLocaleString("pt-BR") : "nunca"}
                </small>
              </span>
              <button
                type="button"
                style={{ ...S.btn, ...S.danger }}
                onClick={async () => {
                  try {
                    await api.remove(it.id);
                    offer.removedHere();
                    await load();
                  } catch (e) {
                    setError(passkeyMessage(e));
                  }
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p style={S.err} role="alert">{error}</p>}
      {passkeySupported() ? (
        <button type="button" style={{ ...S.btn, ...S.primary }} disabled={busy} onClick={add}>
          <Fingerprint />
          {busy ? "Aguardando..." : "Ativar neste aparelho"}
        </button>
      ) : (
        <p style={S.muted}>Para ativar, abra o sistema pelo endereço HTTPS do servidor.</p>
      )}
    </div>
  );
}

/** Montar no layout autenticado: convite após login por senha + modal aberto por openPasskeys(). */
export function PasskeyManager({ api }: { api: PasskeyApi }) {
  const [mode, setMode] = useState<"invite" | "manage" | null>(null);

  useEffect(() => {
    passkeyOffer(api.prefix)
      .take()
      .then((ok) => {
        if (ok) setMode("invite");
      });
    const open = () => setMode("manage");
    window.addEventListener(PASSKEY_OPEN_EVENT, open);
    return () => window.removeEventListener(PASSKEY_OPEN_EVENT, open);
  }, [api.prefix]);

  if (!mode) return null;
  const invite = mode === "invite";
  const close = () => {
    if (invite) passkeyOffer(api.prefix).decline();
    setMode(null);
  };
  return (
    <div style={S.veil} role="dialog" aria-modal="true" onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}>
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Fingerprint />
          <strong style={{ flex: 1, fontSize: 17 }}>Biometria</strong>
          <button type="button" aria-label="Fechar" style={{ ...S.btn, width: "auto", minHeight: 32, border: 0 }} onClick={close}>
            {invite ? "Agora não" : "Fechar"}
          </button>
        </div>
        <PasskeyPanel api={api} invite={invite} onDone={() => setMode(null)} />
      </div>
    </div>
  );
}
