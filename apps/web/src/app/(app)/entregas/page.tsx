"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconPlus } from "@/components/icons";
import { Card, Input, LinkButton, PageHeader, Pager, Select, StatusBadge, Table } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysAgo, fmtDateTime, today } from "@/lib/format";
import type { Paged } from "@/lib/hooks";

interface DeliveryRow {
  id: string;
  deliveredAt: string;
  status: string;
  publicId: string;
  employee: { id: string; name: string; registration: string | null };
  items: Array<{ productDescription: string; quantity: number; caNumber: string; lotNumber: string }>;
}

export default function DeliveriesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ["deliveries", q, from, to, status, page],
    queryFn: () => api.get<Paged<DeliveryRow>>(`/deliveries${qs({ q, from, to, status, page, pageSize: 50 })}`),
  });
  return (
    <>
      <PageHeader title="Entregas de EPI" actions={can("entregas.entregas.inserir") && <LinkButton href="/entregas/nova"><IconPlus size={18} />Nova entrega</LinkButton>} />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Colaborador ou matrícula" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:col-span-2" />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            <option value="ACTIVE">Ativas</option>
            <option value="CANCELLED">Canceladas</option>
          </Select>
        </div>
        <Table
          rows={data?.items}
          rowKey={(r) => r.id}
          onRow={(r) => router.push(`/entregas/${r.id}`)}
          columns={[
            { key: "d", label: "Data", render: (r) => fmtDateTime(r.deliveredAt) },
            { key: "e", label: "Colaborador", render: (r) => <span className="font-medium">{r.employee.name}</span> },
            { key: "i", label: "Itens", render: (r) => r.items.map((i) => `${i.quantity}× ${i.productDescription} (CA ${i.caNumber})`).join("; ") },
            { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
            { key: "c", label: "Código", render: (r) => <span className="font-mono text-xs">{r.publicId}</span> },
          ]}
        />
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
