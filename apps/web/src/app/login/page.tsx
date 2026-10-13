"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { BrandMark, Wordmark } from "@/components/brand";
import { IconDownload } from "@/components/icons";
import { usePwa } from "@/components/pwa";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { api, ApiError, hasSession, setTokens } from "@/lib/api";
import { type SsoConfig, ssoAuthorizeUrl, ssoAutoRedirectOnce, ssoConfig, ssoLogin, takeSsoTicket } from "@/lib/sso";

// Avaliado ao carregar o módulo: o ticket sai da URL antes de qualquer efeito/chamada da página.
let pendingTicket: string | null = typeof window === "undefined" ? null : takeSsoTicket();

const detail = (err: unknown, key: string): string | undefined =>
  err instanceof ApiError ? ((err.details as Record<string, string> | undefined)?.[key] ?? undefined) : undefined;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  /** Desafio do 2FA da central (conta local com 2FA ativo no login único). */
  const [centralMfaToken, setCentralMfaToken] = useState<string | null>(null);
  /** Desafio do TOTP do PreventBase (sem segundo fator na central). */
  const [appMfaToken, setAppMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [sso, setSso] = useState<SsoConfig | null>(null);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [showLocal, setShowLocal] = useState(false);
  const started = useRef(false);
  const { canInstall, install, iosHint } = usePwa();

  function enter() {
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  function failed(err: unknown) {
    const appToken = err instanceof ApiError && err.code.startsWith("MFA") ? detail(err, "mfaToken") : undefined;
    if (appToken) {
      setAppMfaToken(appToken);
      setError(err instanceof ApiError && err.code === "MFA_INVALID" ? err : null);
      return;
    }
    const centralToken = err instanceof ApiError && err.code.startsWith("SSO_MFA") ? detail(err, "ssoMfaToken") : undefined;
    if (centralToken) {
      setCentralMfaToken(centralToken);
      setError(err instanceof ApiError && err.code === "SSO_MFA_INVALID" ? err : null);
      return;
    }
    setAppMfaToken(null);
    setCentralMfaToken(null);
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
          failed(err);
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

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
      enter();
    } catch (err) {
      failed(err);
    } finally {
      setLoading(false);
    }
  }

  const submitAppMfa = (e: FormEvent) => {
    e.preventDefault();
    if (appMfaToken) void run(() => ssoLogin({ mfaToken: appMfaToken, mfaCode }));
  };

  const submitLocal = (e: FormEvent) => {
    e.preventDefault();
    const body = centralMfaToken ? { ssoMfaToken: centralMfaToken, codigo } : { login, senha };
    void run(async () => setTokens(await api.post<{ accessToken: string; refreshToken: string }>("/auth/login", body)));
  };

  const card = "relative w-full space-y-4 overflow-hidden rounded-2xl bg-white p-6 pt-7 shadow-2xl shadow-black/40 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-brand-400";

  if (appMfaToken) {
    return (
      <form onSubmit={submitAppMfa} className={card}>
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
      <Button type="button" loading={ssoBusy} disabled={!sso} className="min-h-11 w-full" onClick={() => sso && location.assign(ssoAuthorizeUrl(sso))}>
        {ssoBusy ? "Entrando…" : "Entrar com login único Veritech"}
      </Button>
      {sso?.local && !showLocal && (
        <button type="button" onClick={() => setShowLocal(true)} className="block min-h-11 w-full rounded-lg text-center text-sm text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-900 hover:underline">
          Usar conta local
        </button>
      )}
      {sso?.local && showLocal && (
        <form onSubmit={submitLocal} className="space-y-4 border-t border-zinc-100 pt-4">
          {centralMfaToken ? (
            <Field label="Código 2FA do login único Veritech" hint="App autenticador da sua conta Veritech">
              <Input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="CPF ou e-mail">
                <Input autoComplete="username" autoCapitalize="none" required value={login} onChange={(e) => setLogin(e.target.value)} />
              </Field>
              <Field label="Senha Veritech">
                <Input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
              </Field>
            </>
          )}
          <Button type="submit" variant="secondary" loading={loading} className="min-h-11 w-full">
            {centralMfaToken ? "Confirmar código" : "Entrar com conta local"}
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
