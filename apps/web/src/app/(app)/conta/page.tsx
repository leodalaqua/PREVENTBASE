"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PasskeyPanel } from "@/components/passkey/passkey-ui";
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Table, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { passkeyApi } from "@/lib/passkey";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";

interface Session { id: string; ip: string | null; userAgent: string | null; createdAt: string; expiresAt: string }

export default function AccountPage() {
  const { me, reload } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState<{ qrDataUrl: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<Session[]>("/auth/sessions") });
  const start = useMutation({ mutationFn: () => api.post<{ qrDataUrl: string; otpauthUrl: string }>("/auth/mfa/setup"), onSuccess: setSetup });
  const enable = useMutation({ mutationFn: () => api.post("/auth/mfa/enable", { code }), onSuccess: () => { setSetup(null); setCode(""); reload(); toast("MFA habilitado"); } });
  const disable = useMutation({ mutationFn: () => api.post("/auth/mfa/disable", { code }), onSuccess: () => { setCode(""); reload(); toast("MFA desabilitado"); } });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["sessions"] }) });

  return (
    <>
      <PageHeader title="Minha conta" subtitle={`${me?.name} · ${me?.email}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Autenticação em dois fatores (TOTP)">
          {me?.mfaEnabled ? (
            <div className="space-y-3">
              <Badge color="green">Habilitado</Badge>
              <Field label="Código atual para desabilitar"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <ErrorBox error={disable.error} />
              <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>Desabilitar</Button>
            </div>
          ) : setup ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="QR MFA" className="h-48 w-48" />
              <p className="break-all text-xs text-zinc-500">{setup.otpauthUrl}</p>
              <Field label="Código do aplicativo"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <ErrorBox error={enable.error} />
              <Button loading={enable.isPending} onClick={() => enable.mutate()}>Confirmar</Button>
            </div>
          ) : (
            <Button loading={start.isPending} onClick={() => start.mutate()}>Habilitar MFA</Button>
          )}
        </Card>
        <Card title="Login por biometria (digital / rosto do aparelho)">
          <PasskeyPanel api={passkeyApi} />
        </Card>
        <Card title="Sessões ativas">
          <Table
            rows={sessions}
            rowKey={(s) => s.id}
            columns={[
              { key: "c", label: "Início", render: (s) => fmtDateTime(s.createdAt) },
              { key: "ip", label: "IP", render: (s) => s.ip ?? "—" },
              { key: "ua", label: "Navegador", render: (s) => <span className="text-xs">{s.userAgent?.slice(0, 60)}</span> },
              { key: "a", label: "", render: (s) => <Button variant="ghost" onClick={() => revoke.mutate(s.id)}>Encerrar</Button> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
