"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function DevicePage() {
  const { me, reload } = useAuth();
  const [name, setName] = useState("");
  const register = useMutation({
    mutationFn: () => {
      const ua = navigator.userAgent;
      return api.post("/devices/register", { deviceKey: localStorage.getItem("pb.deviceKey"), name: name || "Dispositivo", model: ua.slice(0, 200), platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform });
    },
    onSuccess: reload,
  });
  const status = me?.device?.status;
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Este dispositivo" subtitle="Entregas e biometria só podem ser registradas em dispositivos autorizados (§56)" />
      <Card>
        {status ? (
          <div className="space-y-2 text-sm">
            <p>Situação: {status === "TRUSTED" ? <Badge color="green">Autorizado</Badge> : status === "PENDING" ? <Badge color="amber">Aguardando aprovação</Badge> : <Badge color="red">Bloqueado</Badge>}</p>
            {status === "PENDING" && <p className="text-zinc-600">Peça ao administrador para aprovar em Administração › Dispositivos.</p>}
            <Button variant="secondary" onClick={reload}>Atualizar</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Nome do dispositivo" hint="Ex.: Tablet almoxarifado central"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <ErrorBox error={register.error} />
            <Button loading={register.isPending} onClick={() => register.mutate()}>Registrar dispositivo</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
