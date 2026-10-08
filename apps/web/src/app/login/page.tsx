"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { api, ApiError, setTokens } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const tokens = await api.post<{ accessToken: string; refreshToken: string }>("/auth/login", { email, password, mfaCode: mfaCode || undefined });
      setTokens(tokens);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") setNeedMfa(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-lg">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-10 w-10" />
        <div>
          <h1 className="text-lg font-semibold">PreventBase</h1>
          <p className="text-xs text-slate-500">Hub de Segurança e Saúde no Trabalho</p>
        </div>
      </div>
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
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-800 to-slate-900 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
