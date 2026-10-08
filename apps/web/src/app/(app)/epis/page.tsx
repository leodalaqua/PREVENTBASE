"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Pager, Select, StatusBadge, Table, Textarea, useToast } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { EpiProduct, Paged } from "@/lib/hooks";

const CATEGORIES = ["Proteção da cabeça", "Proteção dos olhos e face", "Proteção auditiva", "Proteção respiratória", "Proteção do tronco", "Proteção dos membros superiores", "Proteção dos membros inferiores", "Proteção do corpo inteiro", "Proteção contra quedas"];

export default function EpisPage() {
  const router = useRouter();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ internalCode: "", description: "", category: CATEGORIES[0]!, manufacturer: "", caNumber: "", replacementDays: "", unitCost: "", reusable: false, requiresReturn: false, sizes: "", usage: "" });

  const { data } = useQuery({ queryKey: ["epis-admin", q, status, page], queryFn: () => api.get<Paged<EpiProduct>>(`/epis${qs({ q, status, page, pageSize: 50 })}`) });
  const create = useMutation({
    mutationFn: () =>
      api.post<EpiProduct>("/epis", {
        internalCode: f.internalCode,
        description: f.description,
        category: f.category,
        manufacturer: f.manufacturer || null,
        caNumber: f.caNumber || null,
        replacementDays: f.replacementDays ? Number(f.replacementDays) : null,
        unitCost: f.unitCost ? Number(f.unitCost.replace(",", ".")) : null,
        reusable: f.reusable,
        requiresReturn: f.requiresReturn,
        guidance: f.usage ? { usage: f.usage } : undefined,
        variants: f.sizes.trim() ? f.sizes.split(/[,;]/).map((s) => ({ size: s.trim() })).filter((v) => v.size) : undefined,
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["epis"] });
      void qc.invalidateQueries({ queryKey: ["epis-admin"] });
      toast("EPI cadastrado");
      router.push(`/epis/${p.id}`);
    },
  });

  return (
    <>
      <PageHeader title="EPIs" subtitle="Catálogo com CA, variações e orientações de uso" actions={can("epi.create") && <Button onClick={() => setOpen(true)}>＋ Novo EPI</Button>} />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Descrição, código, CA, SKU ou EAN" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:col-span-3" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Ativos</option>
            <option value="INACTIVE">Inativos</option>
            <option value="">Todos</option>
          </Select>
        </div>
        <Table
          rows={data?.items}
          rowKey={(r) => r.id}
          onRow={(r) => router.push(`/epis/${r.id}`)}
          columns={[
            { key: "c", label: "Código", render: (r) => r.internalCode },
            { key: "d", label: "Descrição", render: (r) => <span className="font-medium">{r.description}</span> },
            { key: "cat", label: "Categoria", render: (r) => r.category },
            { key: "ca", label: "CA", render: (r) => r.cas[0]?.caNumber ?? "—" },
            { key: "t", label: "Troca (dias)", render: (r) => r.replacementDays ?? "—" },
            { key: "v", label: "Variações", render: (r) => r.variants.length },
            { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      <Modal open={open} title="Novo EPI" onClose={() => setOpen(false)} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código interno"><Input value={f.internalCode} onChange={(e) => setF({ ...f, internalCode: e.target.value })} /></Field>
          <Field label="Número do CA"><Input inputMode="numeric" value={f.caNumber} onChange={(e) => setF({ ...f, caNumber: e.target.value })} /></Field>
          <Field label="Descrição" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Categoria">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Fabricante"><Input value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} /></Field>
          <Field label="Periodicidade de troca (dias)"><Input type="number" min={0} value={f.replacementDays} onChange={(e) => setF({ ...f, replacementDays: e.target.value })} /></Field>
          <Field label="Custo unitário (R$)"><Input inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>
          <Field label="Tamanhos (separados por vírgula)" hint="Vazio = variação única" className="sm:col-span-2"><Input placeholder="P, M, G, GG" value={f.sizes} onChange={(e) => setF({ ...f, sizes: e.target.value })} /></Field>
          <Field label="Orientação de uso" className="sm:col-span-2"><Textarea value={f.usage} onChange={(e) => setF({ ...f, usage: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.reusable} onChange={(e) => setF({ ...f, reusable: e.target.checked })} /> Reutilizável (higienização)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresReturn} onChange={(e) => setF({ ...f, requiresReturn: e.target.checked })} /> Exige devolução na troca</label>
          <div className="sm:col-span-2"><ErrorBox error={create.error} /></div>
          <div className="flex justify-end sm:col-span-2"><Button loading={create.isPending} disabled={!f.internalCode || f.description.length < 2} onClick={() => create.mutate()}>Cadastrar</Button></div>
        </div>
      </Modal>
    </>
  );
}
