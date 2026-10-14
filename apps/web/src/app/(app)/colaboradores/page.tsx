"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmployeeForm } from "@/components/employee-form";
import { CompanySelect, type EmployeeLite } from "@/components/pickers";
import { IconPlus } from "@/components/icons";
import { Button, Card, Input, Modal, PageHeader, Pager, Select, StatusBadge, Table } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { maskCpf } from "@/lib/format";
import { companyName, type Paged } from "@/lib/hooks";

export default function EmployeesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data } = useQuery({
    queryKey: ["employees", q, companyId, status, page],
    queryFn: () => api.get<Paged<EmployeeLite & { establishment: { name: string } }>>(`/employees${qs({ q, companyId, status, page, pageSize: 50 })}`),
  });

  return (
    <>
      <PageHeader title="Colaboradores" subtitle="Entidade central do PreventBase" actions={can("colaboradores.cadastro.inserir") && <Button onClick={() => setCreating(true)}><IconPlus size={18} />Novo colaborador</Button>} />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Nome, matrícula ou CPF" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:col-span-2" />
          <CompanySelect allowAll value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Todas as situações</option>
            <option value="ACTIVE">Ativos</option>
            <option value="ON_LEAVE">Afastados</option>
            <option value="TERMINATED">Desligados</option>
          </Select>
        </div>
        <Table
          rows={data?.items}
          rowKey={(r) => r.id}
          onRow={(r) => router.push(`/colaboradores/${r.id}`)}
          columns={[
            { key: "name", label: "Nome", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "reg", label: "Matrícula", render: (r) => r.registration ?? "—" },
            { key: "cpf", label: "CPF", render: (r) => maskCpf(r.cpf) },
            { key: "job", label: "Função", render: (r) => r.job?.name ?? "—" },
            { key: "dep", label: "Setor", render: (r) => r.department?.name ?? "—" },
            { key: "co", label: "Empresa", render: (r) => companyName(r.company) },
            { key: "st", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <Modal open={creating} title="Novo colaborador" onClose={() => setCreating(false)} wide>
        <EmployeeForm onSaved={(e) => router.push(`/colaboradores/${e.id}`)} onCancel={() => setCreating(false)} />
      </Modal>
    </>
  );
}
