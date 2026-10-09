"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { DocumentsPanel } from "@/components/documents-panel";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, StatusBadge, Table, Tabs, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { type EpiProduct, variantLabel } from "@/lib/hooks";

interface EpiDetail extends EpiProduct {
  ca: { caNumber: string; validUntil: string | null; situation: string | null; equipmentName: string | null; manufacturerName: string | null; approvedFor: string | null; restrictions: string | null } | null;
}

const GUIDANCE: Array<[string, string]> = [
  ["usage", "Como usar"],
  ["adjustment", "Ajuste"],
  ["sanitization", "Higienização"],
  ["storage", "Armazenamento"],
  ["limitations", "Limitações"],
  ["coveredRisks", "Riscos cobertos"],
  ["videoUrl", "Vídeo (URL)"],
];

export default function EpiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("dados");
  const { data: p, isLoading, error } = useQuery({ queryKey: ["epi", id], queryFn: () => api.get<EpiDetail>(`/epis/${id}`) });
  const [form, setForm] = useState<Record<string, string>>({});
  const [guidance, setGuidance] = useState<Record<string, string>>({});
  const [variant, setVariant] = useState({ size: "", color: "", ean: "" });

  useEffect(() => {
    if (!p) return;
    setForm({ description: p.description, manufacturer: p.manufacturer ?? "", caNumber: p.cas.find((c) => c.isCurrent)?.caNumber ?? "", replacementDays: p.replacementDays?.toString() ?? "", unitCost: p.unitCost ?? "" });
    setGuidance(Object.fromEntries(GUIDANCE.map(([k]) => [k, (p.guidance?.[k] as string) ?? ""])));
  }, [p]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["epi", id] });
    void qc.invalidateQueries({ queryKey: ["epis"] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/epis/${id}`, {
        description: form.description,
        manufacturer: form.manufacturer || null,
        caNumber: form.caNumber || null,
        replacementDays: form.replacementDays ? Number(form.replacementDays) : null,
        unitCost: form.unitCost ? Number(String(form.unitCost).replace(",", ".")) : null,
        guidance: Object.fromEntries(Object.entries(guidance).map(([k, v]) => [k, v || null])),
      }),
    onSuccess: () => {
      refresh();
      toast("EPI atualizado");
    },
  });
  const toggle = useMutation({ mutationFn: () => api.patch(`/epis/${id}`, { status: p?.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }), onSuccess: refresh });
  const addVariant = useMutation({
    mutationFn: () => api.post(`/epis/${id}/variants`, { size: variant.size || null, color: variant.color || null, ean: variant.ean || null }),
    onSuccess: () => {
      setVariant({ size: "", color: "", ean: "" });
      refresh();
    },
  });

  if (isLoading) return <Loading />;
  if (error || !p) return <ErrorBox error={error} />;
  const editable = can("epi.create");
  const caExpired = p.ca?.validUntil ? new Date(p.ca.validUntil) < new Date() : false;

  return (
    <>
      <PageHeader
        title={p.description}
        subtitle={<span className="flex items-center gap-2">{p.internalCode} · {p.category} <StatusBadge status={p.status} /></span>}
        actions={editable && <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>{p.status === "ACTIVE" ? "Inativar" : "Reativar"}</Button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "dados", label: "Dados e CA" }, { id: "variacoes", label: "Variações" }, { id: "orientacoes", label: "Orientações" }, { id: "documentos", label: "Manual / fotos" }]} />

      {tab === "dados" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Dados">
            <div className="grid gap-3">
              <Field label="Descrição"><Input disabled={!editable} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <Field label="Fabricante"><Input disabled={!editable} value={form.manufacturer ?? ""} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></Field>
              <Field label="CA atual" hint="Trocar o CA preserva o histórico (lotes antigos mantêm o CA da compra)."><Input disabled={!editable} value={form.caNumber ?? ""} onChange={(e) => setForm({ ...form, caNumber: e.target.value })} /></Field>
              <Field label="Periodicidade de troca (dias)"><Input disabled={!editable} type="number" value={form.replacementDays ?? ""} onChange={(e) => setForm({ ...form, replacementDays: e.target.value })} /></Field>
              <Field label="Custo unitário" hint={fmtMoney(form.unitCost)}><Input disabled={!editable} value={form.unitCost ?? ""} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></Field>
              <ErrorBox error={save.error} />
              {editable && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>}
            </div>
          </Card>
          <Card title="Certificado de Aprovação (base CAEPI)">
            {p.ca ? (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-zinc-500">CA</dt><dd className="font-medium">{p.ca.caNumber} {caExpired ? <Badge color="amber">vencido hoje</Badge> : <Badge color="green">válido</Badge>}</dd></div>
                <div><dt className="text-xs text-zinc-500">Validade</dt><dd>{fmtDate(p.ca.validUntil)} · {p.ca.situation}</dd></div>
                <div><dt className="text-xs text-zinc-500">Equipamento</dt><dd>{p.ca.equipmentName}</dd></div>
                <div><dt className="text-xs text-zinc-500">Fabricante</dt><dd>{p.ca.manufacturerName}</dd></div>
                {p.ca.approvedFor && <div><dt className="text-xs text-zinc-500">Aprovado para</dt><dd>{p.ca.approvedFor}</dd></div>}
                {p.ca.restrictions && <div><dt className="text-xs text-zinc-500">Restrições</dt><dd>{p.ca.restrictions}</dd></div>}
                {caExpired && <p className="text-xs text-amber-700">Lotes comprados enquanto o CA era válido continuam podendo ser entregues (CA válido na compra ≠ CA válido hoje).</p>}
              </dl>
            ) : (
              <p className="text-sm text-zinc-500">{p.cas.length ? "CA não encontrado na base CAEPI local — sincronize em Consulta CA." : "Sem CA vinculado."}</p>
            )}
            {p.cas.length > 1 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase text-zinc-500">Histórico de CA</p>
                <ul className="text-sm">{p.cas.map((c) => <li key={c.caNumber + c.linkedAt}>{c.caNumber} — desde {fmtDate(c.linkedAt)} {c.isCurrent && <Badge color="green">atual</Badge>}</li>)}</ul>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "variacoes" && (
        <Card title="Variações (tamanho / cor / EAN)">
          <Table
            rows={p.variants}
            rowKey={(v) => v.id}
            columns={[
              { key: "s", label: "SKU", render: (v) => <span className="font-mono text-xs">{v.sku}</span> },
              { key: "l", label: "Variação", render: (v) => variantLabel(v) },
              { key: "e", label: "EAN", render: (v) => v.ean ?? "—" },
              { key: "a", label: "Situação", render: (v) => <StatusBadge status={v.active ? "ACTIVE" : "INACTIVE"} /> },
            ]}
          />
          {editable && (
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <Input placeholder="Tamanho" value={variant.size} onChange={(e) => setVariant({ ...variant, size: e.target.value })} />
              <Input placeholder="Cor" value={variant.color} onChange={(e) => setVariant({ ...variant, color: e.target.value })} />
              <Input placeholder="EAN" value={variant.ean} onChange={(e) => setVariant({ ...variant, ean: e.target.value })} />
              <Button loading={addVariant.isPending} onClick={() => addVariant.mutate()}>Adicionar</Button>
              <div className="sm:col-span-4"><ErrorBox error={addVariant.error} /></div>
            </div>
          )}
        </Card>
      )}

      {tab === "orientacoes" && (
        <Card title="Orientações exibidas na entrega e no comprovante">
          <div className="grid gap-3">
            {GUIDANCE.map(([k, label]) => (
              <Field key={k} label={label}>
                {k === "videoUrl" ? <Input disabled={!editable} value={guidance[k] ?? ""} onChange={(e) => setGuidance({ ...guidance, [k]: e.target.value })} /> : <Textarea disabled={!editable} value={guidance[k] ?? ""} onChange={(e) => setGuidance({ ...guidance, [k]: e.target.value })} />}
              </Field>
            ))}
            <ErrorBox error={save.error} />
            {editable && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar orientações</Button></div>}
          </div>
        </Card>
      )}

      {tab === "documentos" && (
        <Card title="Manual, ficha técnica e fotos">
          <DocumentsPanel entityType="EPI_PRODUCT" entityId={id} />
        </Card>
      )}
    </>
  );
}
