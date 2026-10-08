"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, Empty, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";

interface SearchResult {
  employees: Array<{ id: string; name: string; registration: string | null; status: string; job: { name: string } | null }>;
  epis: Array<{ id: string; description: string; internalCode: string }>;
  lots: Array<{ id: string; lotNumber: string; publicCode: string; caNumber: string; expiryDate: string | null; variant: { sku: string; product: { description: string } } }>;
  ca: { caNumber: string; equipmentName: string | null; manufacturerName: string | null; validUntil: string | null; situation: string | null } | null;
  documents: Array<{ id: string; title: string; entityType: string; entityId: string }>;
}

function Results() {
  const q = useSearchParams().get("q") ?? "";
  const { data, isLoading } = useQuery({ queryKey: ["search", q], queryFn: () => api.get<SearchResult>(`/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
  if (isLoading) return <Loading />;
  if (!data) return null;
  const none = !data.employees.length && !data.epis.length && !data.lots.length && !data.ca && !data.documents.length;
  return (
    <>
      <PageHeader title={`Busca: “${q}”`} />
      {none && <Empty>Nada encontrado.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">
        {data.employees.length > 0 && (
          <Card title="Colaboradores">
            <ul className="divide-y divide-slate-100">
              {data.employees.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/colaboradores/${e.id}`} className="text-teal-700">{e.name}</Link>
                  <span className="flex items-center gap-2 text-slate-500">
                    {e.registration} · {e.job?.name ?? "sem função"} <StatusBadge status={e.status} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {data.epis.length > 0 && (
          <Card title="EPIs">
            <ul className="divide-y divide-slate-100">
              {data.epis.map((e) => (
                <li key={e.id} className="py-2 text-sm">
                  <Link href={`/epis/${e.id}`} className="text-teal-700">{e.internalCode} — {e.description}</Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {data.ca && (
          <Card title={`CA ${data.ca.caNumber}`}>
            <p className="text-sm">{data.ca.equipmentName}</p>
            <p className="text-sm text-slate-500">{data.ca.manufacturerName} · validade {fmtDate(data.ca.validUntil)} · {data.ca.situation}</p>
            <Link href={`/ca?n=${data.ca.caNumber}`} className="text-sm text-teal-700">Detalhes</Link>
          </Card>
        )}
        {data.lots.length > 0 && (
          <Card title="Lotes">
            <ul className="divide-y divide-slate-100">
              {data.lots.map((l) => (
                <li key={l.id} className="py-2 text-sm">
                  {l.variant.product.description} — lote {l.lotNumber} ({l.publicCode}) · CA {l.caNumber} · val. {fmtDate(l.expiryDate)}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {data.documents.length > 0 && (
          <Card title="Documentos">
            <ul className="divide-y divide-slate-100">
              {data.documents.map((d) => (
                <li key={d.id} className="py-2 text-sm">{d.title} <span className="text-slate-400">({d.entityType})</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <Results />
    </Suspense>
  );
}
