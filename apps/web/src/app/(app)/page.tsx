"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, ErrorBox, LinkButton, Loading, PageHeader, Stat, Table } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";

interface Dashboard {
  cards: Record<string, number | null>;
  monthly: Array<{ month: string; quantity: number; cost: number }>;
  recent: Array<{ id: string; deliveredAt: string; status: string; employee: { name: string }; items: Array<{ productDescription: string; quantity: number }> }>;
  lowStock: Array<{ variantId: string; warehouseId: string; productDescription: string; warehouseName: string; quantity: number; minQty: number }>;
  expiring: Array<{ lotId: string; warehouseId: string; productDescription: string; lotNumber: string; expiryDate: string; quantity: number; expired: boolean }>;
}

export default function DashboardPage() {
  const { can, me } = useAuth();
  const { data, error, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard"), enabled: can("employee.view") });
  if (!can("employee.view")) return <PageHeader title={`Olá, ${me?.name ?? ""}`} subtitle="Seu perfil não tem acesso ao painel." />;
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const c = data.cards;
  const max = Math.max(1, ...data.monthly.map((m) => m.quantity));

  return (
    <>
      <PageHeader title="Painel SST" subtitle={me?.tenant.name} actions={can("epi.deliver") && <LinkButton href="/entregas/nova">＋ Nova entrega</LinkButton>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Colaboradores ativos" value={c.activeEmployees} href="/colaboradores" />
        <Stat label="Com EPI pendente" value={c.employeesWithPending} tone={c.employeesWithPending ? "amber" : "green"} href="/relatorios?r=pending" />
        <Stat label="Trocas vencidas" value={c.overdueReplacements} tone={c.overdueReplacements ? "red" : "green"} href="/relatorios?r=pending" />
        <Stat label="EPIs entregues no mês" value={c.deliveredThisMonth} href="/entregas" />
        <Stat label="Estoque crítico" value={c.lowStock} tone={c.lowStock ? "red" : "green"} href="/estoque" />
        <Stat label="Lotes vencendo" value={c.lotsExpiring} tone={c.lotsExpiring ? "amber" : "green"} href="/estoque?tab=alertas" />
        <Stat label="Lotes vencidos com saldo" value={c.lotsExpired} tone={c.lotsExpired ? "red" : "green"} href="/estoque?tab=alertas" />
        <Stat label="Alertas abertos" value={c.openAlerts} tone={c.openAlerts ? "amber" : "green"} href="/alertas" />
      </div>
      <p className="mt-2 text-xs text-zinc-400">ASO, treinamentos, acidentes e divergências eSocial entram nas próximas fases (plano mestre §87).</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Consumo de EPI — 12 meses">
          {data.monthly.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem entregas no período.</p>
          ) : (
            <div className="flex h-44 items-end gap-2">
              {data.monthly.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.quantity} un. · ${fmtMoney(m.cost)}`}>
                  <span className="text-[10px] text-zinc-500">{m.quantity}</span>
                  <div className="w-full rounded-t bg-brand-400" style={{ height: `${(m.quantity / max) * 120}px` }} />
                  <span className="text-[10px] text-zinc-500">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Últimas entregas" actions={<Link href="/entregas" className="text-sm font-medium text-brand-800 hover:underline">ver todas</Link>}>
          <Table
            rows={data.recent}
            rowKey={(r) => r.id}
            columns={[
              { key: "at", label: "Data", render: (r) => fmtDateTime(r.deliveredAt) },
              { key: "emp", label: "Colaborador", render: (r) => <Link href={`/entregas/${r.id}`} className="font-medium text-brand-800 hover:underline">{r.employee.name}</Link> },
              { key: "items", label: "Itens", render: (r) => r.items.map((i) => `${i.quantity}× ${i.productDescription}`).join(", ") },
            ]}
          />
        </Card>
        <Card title="Estoque abaixo do mínimo">
          <Table
            rows={data.lowStock}
            rowKey={(r) => `${r.warehouseId}:${r.variantId}`}
            empty="Nenhum item abaixo do mínimo."
            columns={[
              { key: "p", label: "EPI", render: (r) => r.productDescription },
              { key: "w", label: "Almoxarifado", render: (r) => r.warehouseName },
              { key: "q", label: "Saldo / mín.", render: (r) => <span className="font-medium text-red-700">{r.quantity} / {r.minQty}</span> },
            ]}
          />
        </Card>
        <Card title="Lotes vencendo">
          <Table
            rows={data.expiring}
            rowKey={(r) => `${r.lotId}:${r.warehouseId}`}
            empty="Nenhum lote vencendo."
            columns={[
              { key: "p", label: "EPI", render: (r) => r.productDescription },
              { key: "l", label: "Lote", render: (r) => r.lotNumber },
              { key: "v", label: "Validade", render: (r) => <span className={r.expired ? "font-medium text-red-700" : "text-amber-700"}>{fmtDate(r.expiryDate)}</span> },
              { key: "q", label: "Qtd", render: (r) => r.quantity },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
