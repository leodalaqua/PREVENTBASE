"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useRef, useState } from "react";
import { Badge, Button, Card, ErrorBox, Input, PageHeader, Table, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";

interface CaLookup {
  caNumber: string;
  found: boolean;
  validToday: boolean | null;
  lastSyncAt: string | null;
  note: string;
  ca: Record<string, string | null> | null;
  products: Array<{ product: { id: string; internalCode: string; description: string }; isCurrent: boolean }>;
  history: Array<{ changedAt: string; changedFields: string[] }>;
}
interface Sync { id: string; source: string; status: string; rowsRead: number; inserted: number; updated: number; unchanged: number; errorMessage: string | null; startedAt: string; finishedAt: string | null }

const FIELDS: Array<[string, string]> = [
  ["equipmentName", "Equipamento"],
  ["equipmentDescription", "Descrição"],
  ["manufacturerName", "Fabricante"],
  ["manufacturerCnpj", "CNPJ fabricante"],
  ["nature", "Natureza"],
  ["approvedFor", "Aprovado para"],
  ["restrictions", "Restrições"],
  ["observations", "Observações"],
  ["standard", "Norma"],
  ["labName", "Laboratório"],
  ["reportNumber", "Laudo"],
  ["processNumber", "Processo"],
];

function CaContent() {
  const params = useSearchParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [n, setN] = useState(params.get("n") ?? "");
  const [query, setQuery] = useState(params.get("n") ?? "");
  const file = useRef<HTMLInputElement>(null);

  const { data, error, isFetching } = useQuery({ queryKey: ["ca", query], queryFn: () => api.get<CaLookup>(`/ca/${encodeURIComponent(query)}`), enabled: !!query });
  const { data: syncs } = useQuery({ queryKey: ["ca-syncs"], queryFn: () => api.get<Sync[]>("/ca/syncs"), enabled: can("ca.sync"), refetchInterval: 15_000 });
  const sync = useMutation({ mutationFn: () => api.post("/ca/sync"), onSuccess: () => { toast("Sincronização CAEPI enfileirada"); void qc.invalidateQueries({ queryKey: ["ca-syncs"] }); } });
  const upload = useMutation({
    mutationFn: () => {
      const f = file.current?.files?.[0];
      if (!f) throw new Error("Selecione o arquivo tgg_export_caepi (.zip ou .txt)");
      const form = new FormData();
      form.set("file", f);
      return api.upload<{ rowsRead: number; inserted: number; updated: number }>("/ca/import", form);
    },
    onSuccess: (r) => {
      toast(`Base CAEPI importada: ${r.rowsRead} CAs (${r.inserted} novos, ${r.updated} alterados)`);
      void qc.invalidateQueries({ queryKey: ["ca-syncs"] });
    },
  });

  return (
    <>
      <PageHeader title="Consulta de CA" subtitle="Base oficial CAEPI (MTE) — somente leitura" />
      <Card>
        <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); setQuery(n.trim()); }}>
          <Input inputMode="numeric" placeholder="Número do CA" value={n} onChange={(e) => setN(e.target.value)} />
          <Button type="submit" loading={isFetching}>Consultar</Button>
        </form>
      </Card>
      <ErrorBox error={error} />
      {data && (
        <Card className="mt-4" title={`CA ${data.caNumber}`} actions={data.found && (data.validToday ? <Badge color="green">válido hoje</Badge> : <Badge color="red">vencido hoje</Badge>)}>
          {!data.found ? (
            <p className="text-sm text-slate-500">CA não encontrado na base local. Última sincronização: {fmtDateTime(data.lastSyncAt)}.</p>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Validade</dt><dd className="font-medium">{fmtDate(data.ca?.validUntil)}</dd></div>
                <div><dt className="text-xs text-slate-500">Situação</dt><dd>{data.ca?.situation}</dd></div>
                {FIELDS.filter(([k]) => data.ca?.[k]).map(([k, label]) => (
                  <div key={k}><dt className="text-xs text-slate-500">{label}</dt><dd>{data.ca?.[k]}</dd></div>
                ))}
              </dl>
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{data.note}</p>
              {data.products.length > 0 && <p className="text-sm">EPIs do catálogo com este CA: {data.products.map((p) => p.product.description).join(", ")}</p>}
              {data.history.length > 0 && <p className="text-xs text-slate-500">Alterações registradas: {data.history.map((h) => `${fmtDate(h.changedAt)} (${h.changedFields.join(", ")})`).join("; ")}</p>}
              <p className="text-xs text-slate-400">Base atualizada em {fmtDateTime(data.lastSyncAt)}.</p>
            </div>
          )}
        </Card>
      )}
      {can("ca.sync") && (
        <Card
          className="mt-4"
          title="Sincronização da base CAEPI"
          actions={
            <>
              <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>Sincronizar agora</Button>
            </>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <input ref={file} type="file" accept=".zip,.txt,.csv" className="text-sm" />
            <Button variant="secondary" loading={upload.isPending} onClick={() => upload.mutate()}>Importar arquivo</Button>
          </div>
          <ErrorBox error={sync.error ?? upload.error} />
          <Table
            rows={syncs}
            rowKey={(s) => s.id}
            empty="Nenhuma sincronização."
            columns={[
              { key: "d", label: "Início", render: (s) => fmtDateTime(s.startedAt) },
              { key: "o", label: "Origem", render: (s) => <span className="text-xs">{s.source}</span> },
              { key: "s", label: "Status", render: (s) => <Badge color={s.status === "DONE" ? "green" : s.status === "FAILED" ? "red" : "blue"}>{s.status}</Badge> },
              { key: "r", label: "Lidos", render: (s) => s.rowsRead },
              { key: "i", label: "Novos / alterados", render: (s) => `${s.inserted} / ${s.updated}` },
              { key: "e", label: "Erro", render: (s) => <span className="text-xs text-red-700">{s.errorMessage}</span> },
            ]}
          />
        </Card>
      )}
    </>
  );
}

export default function CaPage() {
  return (
    <Suspense>
      <CaContent />
    </Suspense>
  );
}
