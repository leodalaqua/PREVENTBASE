"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CompanySelect } from "@/components/pickers";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { api, openFile, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysAgo, fmtDate, fmtDateTime, today } from "@/lib/format";

const REPORTS = [
  { id: "deliveries", label: "Entregas por período", period: true },
  { id: "consumption", label: "Consumo por agrupamento", period: true, groupBy: true },
  { id: "pending", label: "EPIs pendentes / trocas vencidas", period: false },
  { id: "stock", label: "Posição de estoque por lote", period: false },
  { id: "movements", label: "Movimentações de estoque", period: true },
  { id: "expiring-lots", label: "Lotes vencendo / vencidos", period: false },
  { id: "audit", label: "Trilha de auditoria", period: true, perm: "audit.view" },
] as const;

interface Report {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && ISO.test(v)) return /T00:00:00(\.000)?Z$/.test(v) ? fmtDate(v) : fmtDateTime(v);
  if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return String(v);
}

function Reports() {
  const params = useSearchParams();
  const { can } = useAuth();
  const [report, setReport] = useState<string>(params.get("r") ?? "deliveries");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [companyId, setCompanyId] = useState("");
  const [groupBy, setGroupBy] = useState("product");
  const def = REPORTS.find((r) => r.id === report)!;
  const query = qs({ from: def.period ? from : undefined, to: def.period ? to : undefined, companyId, groupBy: "groupBy" in def ? groupBy : undefined });
  const { data, error, isFetching, refetch } = useQuery({ queryKey: ["report", report, query], queryFn: () => api.get<Report>(`/reports/${report}${query}${query ? "&" : "?"}format=json`), enabled: false });

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Todos exportáveis em PDF, XLSX e CSV" />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Relatório" className="sm:col-span-2">
            <Select value={report} onChange={(e) => setReport(e.target.value)}>
              {REPORTS.filter((r) => !("perm" in r) || can(r.perm)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
          {def.period && (
            <>
              <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </>
          )}
          <Field label="Empresa"><CompanySelect allowAll value={companyId} onChange={setCompanyId} /></Field>
          {"groupBy" in def && (
            <Field label="Agrupar por">
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="product">EPI</option>
                <option value="employee">Colaborador</option>
                <option value="department">Setor</option>
                <option value="job">Função</option>
                <option value="manager">Responsável</option>
              </Select>
            </Field>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button loading={isFetching} onClick={() => void refetch()}>Visualizar</Button>
          <Button variant="secondary" onClick={() => void openFile(`/reports/${report}${query}${query ? "&" : "?"}format=pdf`)}>PDF</Button>
          <Button variant="secondary" onClick={() => void openFile(`/reports/${report}${query}${query ? "&" : "?"}format=xlsx`, true)}>XLSX</Button>
          <Button variant="secondary" onClick={() => void openFile(`/reports/${report}${query}${query ? "&" : "?"}format=csv`, true)}>CSV</Button>
        </div>
      </Card>
      <ErrorBox error={error} />
      {data && (
        <Card className="mt-4" title={`${data.title} — ${data.rows.length} linha(s)`}>
          <Table
            rows={data.rows.slice(0, 500)}
            rowKey={(r) => JSON.stringify(r).slice(0, 200) + Math.random()}
            columns={data.columns.map((c) => ({ key: c.key, label: c.label, render: (r: Record<string, unknown>) => cell(r[c.key]) }))}
          />
          {data.rows.length > 500 && <p className="pt-2 text-xs text-zinc-500">Exibindo 500 linhas — exporte para ver todas.</p>}
        </Card>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
