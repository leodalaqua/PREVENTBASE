"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CompanySelect, EpiPicker, type PickedVariant } from "@/components/pickers";
import { IconPlus } from "@/components/icons";
import { Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, StatusBadge, Table, Tabs, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, maskCnpj } from "@/lib/format";
import { companyName, type Job, useCompanies, useDepartments, useEstablishments, useJobs, useReasons, useWarehouses } from "@/lib/hooks";

function useSave<T>(fn: (body: T) => Promise<unknown>, keys: string[][], msg: string, done?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      keys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      toast(msg);
      done?.();
    },
  });
}

function Organization() {
  const { can } = useAuth();
  const manage = can("administracao.organizacao.inserir");
  const { data: companies } = useCompanies();
  const { data: ests } = useEstablishments();
  const { data: deps } = useDepartments();
  const [co, setCo] = useState({ legalName: "", tradeName: "", cnpj: "" });
  const [es, setEs] = useState({ companyId: "", name: "", code: "", cnpj: "" });
  const [dp, setDp] = useState({ establishmentId: "", name: "" });
  const saveCo = useSave(() => api.post("/companies", { ...co, tradeName: co.tradeName || null }), [["companies"]], "Empresa cadastrada", () => setCo({ legalName: "", tradeName: "", cnpj: "" }));
  const saveEs = useSave(() => api.post("/establishments", { ...es, code: es.code || null, cnpj: es.cnpj || null }), [["establishments"]], "Estabelecimento cadastrado", () => setEs({ ...es, name: "", code: "", cnpj: "" }));
  const saveDp = useSave(() => api.post("/departments", dp), [["departments"]], "Setor cadastrado", () => setDp({ ...dp, name: "" }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Empresas">
        <Table rows={companies} rowKey={(c) => c.id} columns={[{ key: "n", label: "Empresa", render: (c) => companyName(c) }, { key: "c", label: "CNPJ", render: (c) => maskCnpj(c.cnpj) }]} />
        {manage && (
          <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
            <Input placeholder="Razão social" value={co.legalName} onChange={(e) => setCo({ ...co, legalName: e.target.value })} />
            <Input placeholder="Nome fantasia" value={co.tradeName} onChange={(e) => setCo({ ...co, tradeName: e.target.value })} />
            <Input placeholder="CNPJ" value={co.cnpj} onChange={(e) => setCo({ ...co, cnpj: e.target.value })} />
            <ErrorBox error={saveCo.error} />
            <Button loading={saveCo.isPending} onClick={() => saveCo.mutate(undefined)}>Adicionar empresa</Button>
          </div>
        )}
      </Card>
      <Card title="Estabelecimentos">
        <Table rows={ests} rowKey={(e) => e.id} columns={[{ key: "n", label: "Nome", render: (e) => e.name }, { key: "c", label: "Empresa", render: (e) => companyName(e.company) }]} />
        {manage && (
          <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
            <CompanySelect value={es.companyId} onChange={(v) => setEs({ ...es, companyId: v })} />
            <Input placeholder="Nome" value={es.name} onChange={(e) => setEs({ ...es, name: e.target.value })} />
            <Input placeholder="Código" value={es.code} onChange={(e) => setEs({ ...es, code: e.target.value })} />
            <Input placeholder="CNPJ (filial)" value={es.cnpj} onChange={(e) => setEs({ ...es, cnpj: e.target.value })} />
            <ErrorBox error={saveEs.error} />
            <Button loading={saveEs.isPending} disabled={!es.companyId} onClick={() => saveEs.mutate(undefined)}>Adicionar estabelecimento</Button>
          </div>
        )}
      </Card>
      <Card title="Setores">
        <Table rows={deps} rowKey={(d) => d.id} columns={[{ key: "n", label: "Setor", render: (d) => d.name }, { key: "e", label: "Estabelecimento", render: (d) => d.establishment?.name ?? "—" }]} />
        {manage && (
          <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
            <Select value={dp.establishmentId} onChange={(e) => setDp({ ...dp, establishmentId: e.target.value })}>
              <option value="">Estabelecimento…</option>
              {ests?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
            <Input placeholder="Nome do setor" value={dp.name} onChange={(e) => setDp({ ...dp, name: e.target.value })} />
            <ErrorBox error={saveDp.error} />
            <Button loading={saveDp.isPending} disabled={!dp.establishmentId} onClick={() => saveDp.mutate(undefined)}>Adicionar setor</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

interface Requirement { id: string; quantity: number; replacementDays: number | null; product: { id: string; description: string; replacementDays: number | null } }

function Jobs() {
  const { can } = useAuth();
  const addJob = can("administracao.funcoes_epi.inserir");
  const manage = can("administracao.funcoes_epi.alterar");
  const removable = can("administracao.funcoes_epi.excluir");
  const qc = useQueryClient();
  const { data: jobs } = useJobs();
  const [job, setJob] = useState<Job | null>(null);
  const [nj, setNj] = useState({ companyId: "", name: "", cbo: "" });
  const [picking, setPicking] = useState(false);
  const [qty, setQty] = useState(1);
  const [days, setDays] = useState("");
  const { data: reqs } = useQuery({ queryKey: ["requirements", job?.id], queryFn: () => api.get<Requirement[]>(`/jobs/${job!.id}/epi-requirements`), enabled: !!job });
  const saveJob = useSave(() => api.post("/jobs", { ...nj, cbo: nj.cbo || null }), [["jobs"]], "Função cadastrada", () => setNj({ ...nj, name: "", cbo: "" }));
  const addReq = useSave((p: PickedVariant) => api.put(`/jobs/${job!.id}/epi-requirements`, { productId: p.product.id, quantity: qty, replacementDays: days ? Number(days) : null }), [["requirements"], ["jobs"]], "EPI obrigatório definido", () => setPicking(false));
  const removeReq = useMutation({ mutationFn: (productId: string) => api.del(`/jobs/${job!.id}/epi-requirements/${productId}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["requirements"] }) });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Funções">
        <Table
          rows={jobs}
          rowKey={(j) => j.id}
          onRow={setJob}
          columns={[
            { key: "n", label: "Função", render: (j) => <span className={job?.id === j.id ? "font-semibold text-brand-800" : ""}>{j.name}</span> },
            { key: "c", label: "CBO", render: (j) => j.cbo ?? "—" },
            { key: "e", label: "Colab.", render: (j) => j._count?.employees ?? 0 },
            { key: "r", label: "EPIs", render: (j) => j._count?.epiRequirements ?? 0 },
          ]}
        />
        {addJob && (
          <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2">
            <CompanySelect value={nj.companyId} onChange={(v) => setNj({ ...nj, companyId: v })} />
            <Input placeholder="Nome da função" value={nj.name} onChange={(e) => setNj({ ...nj, name: e.target.value })} />
            <Input placeholder="CBO" value={nj.cbo} onChange={(e) => setNj({ ...nj, cbo: e.target.value })} />
            <Button loading={saveJob.isPending} disabled={!nj.companyId || !nj.name} onClick={() => saveJob.mutate(undefined)}>Adicionar função</Button>
            <div className="sm:col-span-2"><ErrorBox error={saveJob.error} /></div>
          </div>
        )}
      </Card>
      <Card title={job ? `Matriz Função × EPI — ${job.name}` : "Matriz Função × EPI"} actions={job && manage && <Button onClick={() => setPicking(true)}><IconPlus size={18} />EPI obrigatório</Button>}>
        {!job ? (
          <p className="text-sm text-zinc-500">Selecione uma função.</p>
        ) : (
          <Table
            rows={reqs}
            rowKey={(r) => r.id}
            empty="Nenhum EPI obrigatório."
            columns={[
              { key: "p", label: "EPI", render: (r) => r.product.description },
              { key: "q", label: "Qtd", render: (r) => r.quantity },
              { key: "d", label: "Troca (dias)", render: (r) => r.replacementDays ?? r.product.replacementDays ?? "—" },
              { key: "a", label: "", render: (r) => removable && <Button variant="ghost" onClick={() => removeReq.mutate(r.product.id)}>remover</Button> },
            ]}
          />
        )}
      </Card>
      <Modal open={picking} title="EPI obrigatório" onClose={() => setPicking(false)}>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="Quantidade"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
          <Field label="Troca (dias)" hint="Vazio = padrão do EPI"><Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
        <ErrorBox error={addReq.error} />
        <EpiPicker onPick={(p) => addReq.mutate(p)} />
      </Modal>
    </div>
  );
}

function Warehouses() {
  const { can } = useAuth();
  const { data } = useWarehouses();
  const { data: ests } = useEstablishments();
  const [f, setF] = useState({ establishmentId: "", name: "", code: "", kind: "CENTRAL" });
  const save = useSave(() => api.post("/stock/warehouses", f), [["warehouses"]], "Almoxarifado criado", () => setF({ ...f, name: "", code: "" }));
  return (
    <Card title="Almoxarifados">
      <Table rows={data} rowKey={(w) => w.id} columns={[{ key: "n", label: "Nome", render: (w) => w.name }, { key: "c", label: "Código", render: (w) => w.code }, { key: "k", label: "Tipo", render: (w) => w.kind }, { key: "e", label: "Estabelecimento", render: (w) => w.establishment?.name ?? "—" }, { key: "l", label: "Localizações", render: (w) => w.locations.map((l) => l.code).join(", ") }]} />
      {can("administracao.almoxarifados.inserir") && (
        <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={f.establishmentId} onChange={(e) => setF({ ...f, establishmentId: e.target.value })}>
            <option value="">Estabelecimento…</option>
            {ests?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <Input placeholder="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Código" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="CENTRAL">Central</option>
            <option value="UNIT">Unidade</option>
            <option value="SECTOR">Setor</option>
          </Select>
          <Button loading={save.isPending} disabled={!f.establishmentId || !f.name || !f.code} onClick={() => save.mutate(undefined)}>Criar</Button>
          <div className="sm:col-span-5"><ErrorBox error={save.error} /></div>
        </div>
      )}
    </Card>
  );
}

interface Device { id: string; name: string; model: string | null; platform: string | null; status: string; lastSeenAt: string | null; lastIp: string | null; createdAt: string }

function Devices() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ["devices"], queryFn: () => api.get<Device[]>("/devices"), enabled: can("administracao.dispositivos.visualizar") });
  const update = useSave((p: { id: string; status: string }) => api.patch(`/devices/${p.id}`, { status: p.status }), [["devices"], ["me"]], "Dispositivo atualizado");
  return (
    <Card title="Dispositivos">
      <Table
        rows={data}
        rowKey={(d) => d.id}
        empty="Nenhum dispositivo registrado."
        columns={[
          { key: "n", label: "Nome", render: (d) => d.name },
          { key: "p", label: "Plataforma", render: (d) => <span className="text-xs">{d.platform} · {d.model?.slice(0, 50)}</span> },
          { key: "c", label: "Registrado", render: (d) => fmtDateTime(d.createdAt) },
          { key: "l", label: "Último uso", render: (d) => `${fmtDateTime(d.lastSeenAt)} ${d.lastIp ?? ""}` },
          { key: "s", label: "Situação", render: (d) => <StatusBadge status={d.status} /> },
          {
            key: "a",
            label: "",
            render: (d) =>
              can("administracao.dispositivos.atualizar") && (
                <div className="flex gap-1">
                  {d.status !== "TRUSTED" && <Button variant="ghost" onClick={() => update.mutate({ id: d.id, status: "TRUSTED" })}>Aprovar</Button>}
                  {d.status !== "BLOCKED" && <Button variant="ghost" onClick={() => update.mutate({ id: d.id, status: "BLOCKED" })}>Bloquear</Button>}
                </div>
              ),
          },
        ]}
      />
    </Card>
  );
}

interface Terms { id: string; version: number; text: string; active: boolean; createdAt: string }

function Settings() {
  const { can } = useAuth();
  const { data: reasons } = useReasons();
  const { data: terms } = useQuery({ queryKey: ["terms"], queryFn: () => api.get<Terms[]>("/delivery-terms"), enabled: can("administracao.parametros.visualizar") });
  const { data: lgpd } = useQuery({ queryKey: ["lgpd"], queryFn: () => api.get<Array<{ id: string; purpose: string; dataCategory: string; legalBasis: string; source: string; retention: string }>>("/lgpd/processing-records"), enabled: can("administracao.lgpd.visualizar") });
  const [r, setR] = useState({ code: "", name: "", requiresJustification: false });
  const [text, setText] = useState("");
  const saveReason = useSave(() => api.post("/delivery-reasons", { ...r, active: true }), [["reasons"]], "Motivo salvo", () => setR({ code: "", name: "", requiresJustification: false }));
  const toggleReason = useSave((x: { code: string; name: string; requiresJustification: boolean; active: boolean; sortOrder: number }) => api.post("/delivery-reasons", { ...x, active: !x.active }), [["reasons"]], "Motivo atualizado");
  const saveTerms = useSave(() => api.post("/delivery-terms", { text }), [["terms"]], "Nova versão do termo publicada", () => setText(""));
  const active = terms?.find((t) => t.active);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Motivos de entrega">
        <Table
          rows={reasons}
          rowKey={(x) => x.id}
          columns={[
            { key: "c", label: "Código", render: (x) => <span className="font-mono text-xs">{x.code}</span> },
            { key: "n", label: "Motivo", render: (x) => x.name },
            { key: "j", label: "Justificativa", render: (x) => (x.requiresJustification ? "obrigatória" : "—") },
            { key: "s", label: "", render: (x) => can("administracao.parametros.alterar") ? <Button variant="ghost" onClick={() => toggleReason.mutate(x)}>{x.active ? "Desativar" : "Ativar"}</Button> : <StatusBadge status={x.active ? "ACTIVE" : "INACTIVE"} /> },
          ]}
        />
        {can("administracao.parametros.inserir") && (
          <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-3">
            <Input placeholder="CÓDIGO" value={r.code} onChange={(e) => setR({ ...r, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
            <Input placeholder="Nome" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.requiresJustification} onChange={(e) => setR({ ...r, requiresJustification: e.target.checked })} /> exige justificativa</label>
            <Button loading={saveReason.isPending} onClick={() => saveReason.mutate(undefined)}>Salvar motivo</Button>
            <div className="sm:col-span-3"><ErrorBox error={saveReason.error} /></div>
          </div>
        )}
      </Card>
      {can("administracao.parametros.visualizar") && (
        <Card title={`Termo de entrega ${active ? `(v${active.version} vigente)` : ""}`}>
          {active && <p className="mb-3 whitespace-pre-line rounded bg-zinc-50 p-3 text-sm">{active.text}</p>}
          {can("administracao.parametros.inserir") && (
            <>
              <Field label="Nova versão" hint="Publicar cria nova versão; entregas antigas mantêm a versão aceita."><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <ErrorBox error={saveTerms.error} />
              <Button className="mt-2" loading={saveTerms.isPending} disabled={text.trim().length < 20} onClick={() => saveTerms.mutate(undefined)}>Publicar versão</Button>
            </>
          )}
          {terms && terms.length > 1 && <p className="mt-3 text-xs text-zinc-500">Histórico: {terms.map((t) => `v${t.version} (${fmtDateTime(t.createdAt)})`).join(", ")}</p>}
        </Card>
      )}
      {lgpd && (
        <Card title="LGPD — registro das operações de tratamento" className="lg:col-span-2">
          <Table rows={lgpd} rowKey={(x) => x.id} columns={[{ key: "f", label: "Finalidade", render: (x) => x.purpose }, { key: "d", label: "Categoria", render: (x) => x.dataCategory }, { key: "b", label: "Base legal", render: (x) => x.legalBasis }, { key: "s", label: "Origem", render: (x) => x.source }, { key: "r", label: "Retenção", render: (x) => x.retention }]} />
        </Card>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { can } = useAuth();
  const tabs = [
    { id: "org", label: "Organização", on: can("administracao.organizacao.visualizar") },
    { id: "jobs", label: "Funções × EPI", on: can("administracao.funcoes_epi.visualizar") },
    { id: "wh", label: "Almoxarifados", on: can("administracao.almoxarifados.visualizar") },
    { id: "devices", label: "Dispositivos", on: can("administracao.dispositivos.visualizar") },
    { id: "settings", label: "Motivos, termo e LGPD", on: can("administracao.parametros.visualizar", "administracao.lgpd.visualizar") },
  ].filter((t) => t.on);
  const [picked, setTab] = useState<string | null>(null);
  const tab = picked ?? tabs[0]?.id;
  return (
    <>
      <PageHeader title="Administração" />
      {tabs.length === 0 && <Empty>Sem acesso à administração no login único Veritech.</Empty>}
      <Tabs tabs={tabs} value={tab ?? ""} onChange={setTab} />
      {tab === "org" && <Organization />}
      {tab === "jobs" && <Jobs />}
      {tab === "wh" && <Warehouses />}
      {tab === "devices" && <Devices />}
      {tab === "settings" && <Settings />}
    </>
  );
}
