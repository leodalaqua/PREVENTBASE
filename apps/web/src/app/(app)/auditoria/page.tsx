"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Input, Modal, PageHeader, Pager, Table } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Paged } from "@/lib/hooks";

interface AuditRow { id: string; createdAt: string; action: string; entityType: string; entityId: string | null; userName: string | null; ip: string | null; before: unknown; after: unknown; currentHash: string; previousHash: string }

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const { data } = useQuery({ queryKey: ["audit", action, entityType, page], queryFn: () => api.get<Paged<AuditRow>>(`/audit${qs({ action, entityType, page, pageSize: 50 })}`) });
  const verify = useMutation({ mutationFn: () => api.get<{ ok: boolean; checked: number; brokenAtId?: string; reason?: string }>("/audit/verify-chain") });

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Trilha encadeada por hash SHA-256 — qualquer alteração quebra a cadeia" actions={<Button loading={verify.isPending} onClick={() => verify.mutate()}>Verificar integridade</Button>} />
      {verify.data && (
        <div className={`mb-4 rounded-lg p-3 text-sm ${verify.data.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {verify.data.ok ? `✔ Cadeia íntegra — ${verify.data.checked} registros verificados.` : `✖ Cadeia quebrada no registro ${verify.data.brokenAtId}: ${verify.data.reason}`}
        </div>
      )}
      <ErrorBox error={verify.error} />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <Input placeholder="Ação (ex.: epi.delivered)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Input placeholder="Entidade (ex.: EpiDelivery)" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} />
        </div>
        <Table
          rows={data?.items}
          rowKey={(r) => r.id}
          onRow={setDetail}
          columns={[
            { key: "d", label: "Data", render: (r) => fmtDateTime(r.createdAt) },
            { key: "u", label: "Usuário", render: (r) => r.userName ?? "sistema" },
            { key: "a", label: "Ação", render: (r) => <Badge color="blue">{r.action}</Badge> },
            { key: "e", label: "Entidade", render: (r) => `${r.entityType}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}` },
            { key: "ip", label: "IP", render: (r) => r.ip ?? "—" },
            { key: "h", label: "Hash", render: (r) => <span className="font-mono text-xs">{r.currentHash.slice(0, 10)}…</span> },
          ]}
        />
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <Modal open={!!detail} title={detail?.action ?? ""} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="break-all font-mono text-xs">prev {detail.previousHash}<br />hash {detail.currentHash}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">Antes</p>
                <pre className="max-h-96 overflow-auto rounded bg-zinc-50 p-2 text-xs">{JSON.stringify(detail.before, null, 2) ?? "—"}</pre>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">Depois</p>
                <pre className="max-h-96 overflow-auto rounded bg-zinc-50 p-2 text-xs">{JSON.stringify(detail.after, null, 2) ?? "—"}</pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
