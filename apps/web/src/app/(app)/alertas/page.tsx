"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Empty, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

interface Notification { id: string; type: string; severity: "INFO" | "WARNING" | "CRITICAL"; title: string; body: string | null; entityType: string | null; entityId: string | null; readAt: string | null; resolvedAt: string | null; createdAt: string }

const SEV: Record<string, "red" | "amber" | "blue"> = { CRITICAL: "red", WARNING: "amber", INFO: "blue" };
const LINK: Record<string, (id: string) => string> = {
  employee: (id) => `/colaboradores/${id}`,
  epi_product: (id) => `/epis/${id}`,
  epi_variant: () => "/estoque?tab=alertas",
  stock_lot: () => "/estoque?tab=alertas",
  audit_log: () => "/auditoria",
};

export default function AlertsPage() {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["notifications", all], queryFn: () => api.get<Notification[]>(`/notifications${all ? "?all=1" : ""}`) });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }) });

  return (
    <>
      <PageHeader title="Alertas" subtitle="Gerados pelo worker a cada hora; resolvidos automaticamente quando a condição deixa de existir" actions={<Button variant="secondary" onClick={() => setAll(!all)}>{all ? "Só abertos" : "Incluir resolvidos"}</Button>} />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>Nenhum alerta.</Empty>
      ) : (
        <div className="space-y-2">
          {data.map((n) => (
            <Card key={n.id} className={n.readAt || n.resolvedAt ? "opacity-60" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    <Badge color={SEV[n.severity]}>{n.severity === "CRITICAL" ? "Crítico" : n.severity === "WARNING" ? "Atenção" : "Info"}</Badge>
                    {n.entityType && n.entityId && LINK[n.entityType] ? <Link href={LINK[n.entityType]!(n.entityId)} className="font-medium text-brand-800 hover:underline">{n.title}</Link> : n.title}
                  </p>
                  {n.body && <p className="mt-1 text-sm text-zinc-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-zinc-500">{fmtDateTime(n.createdAt)}{n.resolvedAt && ` · resolvido ${fmtDateTime(n.resolvedAt)}`}</p>
                </div>
                {!n.readAt && !n.resolvedAt && <Button variant="ghost" onClick={() => read.mutate(n.id)}>Marcar como lido</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
