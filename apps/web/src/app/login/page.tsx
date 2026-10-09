"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { BrandMark, Wordmark } from "@/components/brand";
import { PasskeyLoginButton } from "@/components/passkey/passkey-ui";
import { passkeyOffer } from "@/components/passkey/webauthn-browser";
import { usePwa } from "@/components/pwa";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { api, ApiError, setTokens } from "@/lib/api";
import { passkeyApi } from "@/lib/passkey";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const { canInstall, install, iosHint } = usePwa();

  function enter() {
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
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

  return (
    <form onSubmit={submit} className="w-full space-y-4 rounded-2xl border-t-4 border-brand-400 bg-white p-6 shadow-2xl shadow-black/40">
      <h2 className="text-center text-base font-semibold text-zinc-800">Acesse sua conta</h2>
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
      <ErrorBox error={error} />
      <Button type="submit" loading={loading} className="w-full">
        Entrar
      </Button>
      {canInstall && (
        <Button type="button" variant="secondary" className="w-full" onClick={() => void install()}>
          ⤓ Instalar aplicativo
        </Button>
      )}
      {iosHint && <p className="text-center text-xs text-zinc-500">No iPhone: Compartilhar → “Adicionar à Tela de Início”.</p>}
    </form>
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
