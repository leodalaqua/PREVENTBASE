"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { BrandMark, Wordmark } from "@/components/brand";
import { IconDownload } from "@/components/icons";
import { PasskeyLoginButton } from "@/components/passkey/passkey-ui";
import { passkeyOffer } from "@/components/passkey/webauthn-browser";
import { usePwa } from "@/components/pwa";
import { Button, ErrorBox, Field, Input, Notice } from "@/components/ui";
import { api, ApiError, hasSession, setTokens } from "@/lib/api";
import { passkeyApi } from "@/lib/passkey";
import { type SsoConfig, ssoAuthorizeUrl, ssoAutoRedirectOnce, ssoConfig, ssoLogin, takeSsoTicket } from "@/lib/sso";

// Avaliado ao carregar o módulo: o ticket sai da URL antes de qualquer efeito/chamada da página.
let pendingTicket: string | null = typeof window === "undefined" ? null : takeSsoTicket();

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [sso, setSso] = useState<SsoConfig | null>(null);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoMfaToken, setSsoMfaToken] = useState<string | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const started = useRef(false);
  const { canInstall, install, iosHint } = usePwa();

  function enter() {
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  function ssoFailed(err: unknown) {
    const token = err instanceof ApiError && err.code.startsWith("MFA") ? (err.details as { mfaToken?: string } | undefined)?.mfaToken : undefined;
    if (token) {
      setSsoMfaToken(token);
      if (err instanceof ApiError && err.code === "MFA_INVALID") setError(err);
      return;
    }
    setSsoMfaToken(null);
    if (err instanceof ApiError && err.code === "SSO_PENDING") {
      setPendingMsg(err.message);
      setError(null);
      return;
    }
    setError(err);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = pendingTicket;
    pendingTicket = null;
    void (async () => {
      if (ticket) {
        setSsoBusy(true);
        try {
          await ssoLogin({ ticket });
          enter();
          return;
        } catch (err) {
          ssoFailed(err);
        } finally {
          setSsoBusy(false);
        }
      }
      try {
        const cfg = await ssoConfig();
        setSso(cfg);
        if (!ticket && !hasSession() && ssoAutoRedirectOnce()) location.assign(ssoAuthorizeUrl(cfg));
      } catch (err) {
        if (!ticket) setError(err);
      }
    })();
  }, []);

  async function submitSsoMfa(e: FormEvent) {
    e.preventDefault();
    if (!ssoMfaToken) return;
    setLoading(true);
    setError(null);
    try {
      await ssoLogin({ mfaToken: ssoMfaToken, mfaCode });
      enter();
    } catch (err) {
      ssoFailed(err);
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const tokens = await api.post<{ accessToken: string; refreshToken: string }>("/auth/login", { email, password, mfaCode: mfaCode || undefined });
      setTokens(tokens);
      passkeyOffer(passkeyApi.prefix).mark();
      enter();
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") setNeedMfa(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }

  const card = "relative w-full space-y-4 overflow-hidden rounded-2xl bg-white p-6 pt-7 shadow-2xl shadow-black/40 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-brand-400";

  if (ssoMfaToken) {
    return (
      <form onSubmit={submitSsoMfa} className={card}>
        <h2 className="text-center text-base font-semibold text-zinc-800">Confirme o acesso</h2>
        <p className="text-center text-sm text-zinc-500">Login único Veritech confirmado. Informe o código do seu autenticador do PreventBase.</p>
        <Field label="Código do autenticador">
          <Input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={loading} className="min-h-11 w-full">
          Entrar
        </Button>
      </form>
    );
  }

  return (
    <div className={card}>
      <h2 className="text-center text-base font-semibold text-zinc-800">Acesse sua conta</h2>
      {pendingMsg && <Notice tone="warn">{pendingMsg}</Notice>}
      <Button type="button" loading={ssoBusy} disabled={!sso} className="min-h-11 w-full" onClick={() => sso && location.assign(ssoAuthorizeUrl(sso))}>
        {ssoBusy ? "Entrando…" : "Entrar com login único Veritech"}
      </Button>
      {sso?.local && !showLocal && (
        <button type="button" onClick={() => setShowLocal(true)} className="block min-h-11 w-full rounded-lg text-center text-sm text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-900 hover:underline">
          Usar conta local
        </button>
      )}
      {sso?.local && showLocal && (
        <form onSubmit={submit} className="space-y-4 border-t border-zinc-100 pt-4">
          <PasskeyLoginButton api={passkeyApi} onDone={enter} onError={(msg) => setError(msg ? new Error(msg) : null)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60" />
          <Field label="E-mail">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {needMfa && (
            <Field label="Código do autenticador">
              <Input inputMode="numeric" autoComplete="one-time-code" autoFocus value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
            </Field>
          )}
          <Button type="submit" variant="secondary" loading={loading} className="min-h-11 w-full">
            Entrar com conta local
          </Button>
        </form>
      )}
      <ErrorBox error={error} />
      {canInstall && (
        <Button type="button" variant="secondary" className="w-full" onClick={() => void install()}>
          <IconDownload size={18} />
          Instalar aplicativo
        </Button>
      )}
      {iosHint && <p className="text-center text-xs text-zinc-500">No iPhone: Compartilhar → “Adicionar à Tela de Início”.</p>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-900 bg-[radial-gradient(ellipse_at_top,rgba(251,203,10,0.2),transparent_60%)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark className="w-32 drop-shadow-[0_8px_24px_rgba(251,203,10,0.3)] sm:w-40" />
          <h1>
            <Wordmark onDark className="w-60 sm:w-72" />
          </h1>
          <p className="text-sm text-zinc-400">Hub de Segurança e Saúde no Trabalho</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
