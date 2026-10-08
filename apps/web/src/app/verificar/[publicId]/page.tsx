"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { Loading } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

interface VerifyResult {
  found: boolean;
  type?: string;
  valid?: boolean;
  hashValid?: boolean;
  status?: string;
  company?: string | null;
  employee?: string;
  deliveredAt?: string;
  items?: number;
  method?: string;
  hash?: string;
  checkedAt?: string;
}

export default function VerifyPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ["verify", publicId],
    queryFn: async () => {
      const r = await fetch(`/api/v1/public/verify/${encodeURIComponent(publicId)}`);
      if (!r.ok && r.status !== 404) throw new Error("Falha na verificação");
      return (await r.json()) as VerifyResult;
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="font-semibold">Verificação de comprovante</h1>
            <p className="text-xs text-slate-500">PreventBase · código {publicId}</p>
          </div>
        </div>
        {isLoading && <Loading />}
        {error && <p className="text-sm text-red-700">Não foi possível verificar agora.</p>}
        {data && !data.found && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-800">Comprovante não encontrado.</p>}
        {data?.found && (
          <div className="space-y-3 text-sm">
            <div className={`rounded-lg p-4 font-medium ${data.valid ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {data.valid ? "✔ Comprovante autêntico e íntegro" : data.status === "CANCELLED" ? "✖ Entrega cancelada" : "✖ Integridade não confirmada"}
            </div>
            <dl className="grid grid-cols-3 gap-y-2">
              <dt className="text-slate-500">Documento</dt>
              <dd className="col-span-2">{data.type}</dd>
              <dt className="text-slate-500">Empresa</dt>
              <dd className="col-span-2">{data.company ?? "—"}</dd>
              <dt className="text-slate-500">Colaborador</dt>
              <dd className="col-span-2">{data.employee}</dd>
              <dt className="text-slate-500">Data</dt>
              <dd className="col-span-2">{fmtDateTime(data.deliveredAt)}</dd>
              <dt className="text-slate-500">Itens</dt>
              <dd className="col-span-2">{data.items}</dd>
              <dt className="text-slate-500">Validação</dt>
              <dd className="col-span-2">{data.method === "FACIAL_BIOMETRIC_1_1" ? "Biometria facial 1:1 com prova de vida" : data.method}</dd>
              <dt className="text-slate-500">Hash</dt>
              <dd className="col-span-2 break-all font-mono text-xs">{data.hash}</dd>
            </dl>
            <p className="text-xs text-slate-400">Consulta em {fmtDateTime(data.checkedAt)}. Dados pessoais exibidos de forma reduzida (LGPD).</p>
          </div>
        )}
      </div>
    </main>
  );
}
