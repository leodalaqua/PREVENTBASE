"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CompanySelect, EpiPicker, type PickedVariant } from "@/components/pickers";
import { IconPlus } from "@/components/icons";
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, StatusBadge, Table, Tabs, Textarea, useToast } from "@/components/ui";
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
  const manage = can("organization.manage");
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
  const manage = can("organization.manage");
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
        {manage && (
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
              { key: "a", label: "", render: (r) => manage && <Button variant="ghost" onClick={() => removeReq.mutate(r.product.id)}>remover</Button> },
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
      {can("organization.manage") && (
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

interface UserRow { id: string; name: string; email: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null; createdAt: string; roles: Array<{ companyId: string | null; establishmentId: string | null; role: { key: string; name: string } }> }
interface Role { id: string; key: string; name: string; permissions: Array<{ permission: { key: string } }> }
interface Assignment { roleKey: string; companyId: string; establishmentId: string | null }
type UserFilter = "all" | "pending" | "active" | "blocked";

const isPending = (u: UserRow) => u.status === "BLOCKED" && u.roles.length === 0;
const grantsUsersManage = (r: Role | undefined) => !!r?.permissions.some((p) => p.permission.key === "users.manage");

function UserStatus({ u }: { u: UserRow }) {
  return isPending(u) ? <Badge color="amber">Aguardando liberação</Badge> : <StatusBadge status={u.status} />;
}

function RoleEditor({ user, roles, onClose }: { user: UserRow; roles: Role[]; onClose: () => void }) {
  const { me, can } = useAuth();
  const self = me?.id === user.id;
  const [rows, setRows] = useState<Assignment[]>(() =>
    user.roles.length ? user.roles.map((r) => ({ roleKey: r.role.key, companyId: r.companyId ?? "", establishmentId: r.establishmentId })) : [{ roleKey: "", companyId: "", establishmentId: null }],
  );
  const options = roles.filter((r) => r.key !== "super_admin" || can("tenant.manage") || rows.some((a) => a.roleKey === "super_admin"));
  const byKey = (k: string) => roles.find((r) => r.key === k);
  const filled = rows.filter((a) => a.roleKey);
  const duplicated = new Set(filled.map((a) => `${a.roleKey}|${a.companyId}`)).size !== filled.length;
  const losesAdmin = self && !filled.some((a) => grantsUsersManage(byKey(a.roleKey)));
  const blocked = filled.length === 0 || filled.length !== rows.length || duplicated || losesAdmin;
  const payload = () => filled.map((a) => ({ roleKey: a.roleKey, companyId: a.companyId || null, establishmentId: a.establishmentId }));
  const release = useSave(() => api.patch(`/users/${user.id}`, { roles: payload(), status: "ACTIVE" }), [["users"]], "Acesso liberado", onClose);
  const save = useSave(() => api.patch(`/users/${user.id}`, { roles: payload() }), [["users"]], "Perfis atualizados", onClose);
  const set = (i: number, patch: Partial<Assignment>) => setRows(rows.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const busy = release.isPending || save.isPending;

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <p className="break-any font-medium text-zinc-900">{user.name}</p>
        <p className="break-any text-zinc-600">{user.email}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <UserStatus u={user} />
          <span>criado em {fmtDateTime(user.createdAt)}</span>
        </div>
      </div>
      <ul className="space-y-3">
        {rows.map((a, i) => (
          <li key={i} className="grid gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:border-0 sm:p-0">
            <Field label="Perfil">
              <Select value={a.roleKey} onChange={(e) => set(i, { roleKey: e.target.value })}>
                <option value="" disabled>Selecione o perfil</option>
                {options.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Escopo (empresa)">
              <CompanySelect allowAll value={a.companyId} onChange={(v) => set(i, { companyId: v, establishmentId: null })} />
            </Field>
            <Button variant="ghost" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remover</Button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={() => setRows([...rows, { roleKey: "", companyId: "", establishmentId: null }])}><IconPlus size={18} />Adicionar perfil</Button>
      <p className="text-xs text-zinc-500">"Todas as empresas" vale para todas as empresas do tenant. Perfil com empresa limita o acesso aos dados dela.</p>
      {duplicated && <Notice tone="warn">Perfil repetido com o mesmo escopo.</Notice>}
      {losesAdmin && <Notice tone="warn">Você não pode remover o próprio perfil de administrador.</Notice>}
      <ErrorBox error={release.error ?? save.error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        {user.status === "ACTIVE" ? (
          <Button loading={save.isPending} disabled={blocked || busy} onClick={() => save.mutate(undefined)}>Salvar perfis</Button>
        ) : (
          <>
            {user.roles.length > 0 && <Button variant="secondary" loading={save.isPending} disabled={blocked || busy} onClick={() => save.mutate(undefined)}>Salvar sem liberar</Button>}
            <Button loading={release.isPending} disabled={blocked || busy} onClick={() => release.mutate(undefined)}>Liberar acesso</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Users() {
  const { can, me } = useAuth();
  const manage = can("users.manage");
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserRow[]>("/users?pageSize=500") });
  const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles") });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [filter, setFilter] = useState<UserFilter>("all");
  const [f, setF] = useState({ name: "", email: "", password: "", roleKey: "", companyId: "" });
  const create = useSave(() => api.post("/users", { name: f.name, email: f.email, password: f.password, roles: [{ roleKey: f.roleKey, companyId: f.companyId || null }] }), [["users"]], "Usuário criado", () => setOpen(false));
  const toggle = useSave((u: UserRow) => api.patch(`/users/${u.id}`, { status: u.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" }), [["users"]], "Usuário atualizado");
  const pending = data?.filter(isPending) ?? [];
  const match: Record<UserFilter, (u: UserRow) => boolean> = { all: () => true, pending: isPending, active: (u) => u.status === "ACTIVE", blocked: (u) => u.status === "BLOCKED" };
  const rows = data?.filter(match[filter]);
  const filters: Array<{ id: UserFilter; label: string }> = [
    { id: "all", label: `Todos${data ? ` (${data.length})` : ""}` },
    { id: "pending", label: `Aguardando liberação (${pending.length})` },
    { id: "active", label: "Ativos" },
    { id: "blocked", label: "Bloqueados" },
  ];
  const actions = (u: UserRow) =>
    manage && (
      <div className="flex flex-wrap gap-1">
        {isPending(u) ? (
          <Button onClick={() => setEditing(u)}>Liberar acesso</Button>
        ) : (
          <Button variant="ghost" onClick={() => setEditing(u)}>Perfis</Button>
        )}
        {me?.id === u.id ? null : !isPending(u) && <Button variant="ghost" onClick={() => toggle.mutate(u)}>{u.status === "ACTIVE" ? "Bloquear" : "Reativar"}</Button>}
      </div>
    );

  return (
    <Card title="Usuários" actions={manage && <Button onClick={() => setOpen(true)}><IconPlus size={18} />Usuário</Button>}>
      {pending.length > 0 && filter !== "pending" && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Notice tone="warn">{pending.length === 1 ? "1 usuário entrou pelo login único e aguarda liberação." : `${pending.length} usuários entraram pelo login único e aguardam liberação.`}</Notice>
          <Button variant="secondary" onClick={() => setFilter("pending")}>Ver pendentes</Button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar usuários">
        {filters.map((x) => (
          <Button key={x.id} variant={filter === x.id ? "primary" : "secondary"} aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>{x.label}</Button>
        ))}
      </div>
      <ErrorBox error={toggle.error} />
      {!rows && <div className="space-y-2 sm:hidden" role="status" aria-busy="true"><span className="sr-only">Carregando…</span><div className="skeleton h-24" /><div className="skeleton h-24" /></div>}
      {rows?.length === 0 && <div className="sm:hidden"><Empty>{filter === "pending" ? "Nenhum usuário aguardando liberação." : undefined}</Empty></div>}
      <ul className="space-y-2 sm:hidden">
        {rows?.map((u) => (
          <li key={u.id} className={cx("rounded-lg border p-3", isPending(u) ? "border-amber-200 bg-amber-50/60" : "border-zinc-200")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-any font-medium text-zinc-900">{u.name}</p>
                <p className="break-any text-sm text-zinc-600">{u.email}</p>
              </div>
              <UserStatus u={u} />
            </div>
            <p className="mt-1 text-xs text-zinc-500">{u.roles.map((r) => r.role.name).join(", ") || "Sem perfil"} · último acesso {fmtDateTime(u.lastLoginAt)}</p>
            <div className="mt-2">{actions(u)}</div>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table
          rows={rows}
          rowKey={(u) => u.id}
          empty={filter === "pending" ? "Nenhum usuário aguardando liberação." : undefined}
          columns={[
            { key: "n", label: "Nome", render: (u) => u.name },
            { key: "e", label: "E-mail", render: (u) => <span className="break-any">{u.email}</span> },
            { key: "r", label: "Perfis", render: (u) => u.roles.map((r) => r.role.name).join(", ") || <span className="text-zinc-500">Sem perfil</span> },
            { key: "m", label: "MFA", render: (u) => (u.mfaEnabled ? <Badge color="green">sim</Badge> : "não") },
            { key: "l", label: "Último acesso", render: (u) => fmtDateTime(u.lastLoginAt) },
            { key: "s", label: "Situação", render: (u) => <UserStatus u={u} /> },
            { key: "a", label: "", render: actions },
          ]}
        />
      </div>
      <Modal open={!!editing} title={editing && isPending(editing) ? "Liberar acesso" : "Perfis do usuário"} onClose={() => setEditing(null)} wide>
        {editing && roles && <RoleEditor key={editing.id} user={editing} roles={roles} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal open={open} title="Novo usuário" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Senha inicial" hint="Mínimo 10 caracteres"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Perfil">
            <Select value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value })}>
              <option value="" disabled>Selecione o perfil</option>
              {roles?.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Escopo (empresa)" hint="Vazio = todas"><CompanySelect allowAll value={f.companyId} onChange={(v) => setF({ ...f, companyId: v })} /></Field>
          <ErrorBox error={create.error} />
          <div className="flex justify-end"><Button loading={create.isPending} disabled={!f.roleKey} onClick={() => create.mutate(undefined)}>Criar</Button></div>
        </div>
      </Modal>
    </Card>
  );
}

interface Device { id: string; name: string; model: string | null; platform: string | null; status: string; lastSeenAt: string | null; lastIp: string | null; createdAt: string }

function Devices() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ["devices"], queryFn: () => api.get<Device[]>("/devices"), enabled: can("devices.view") });
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
              can("devices.manage") && (
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
  const { data: terms } = useQuery({ queryKey: ["terms"], queryFn: () => api.get<Terms[]>("/delivery-terms"), enabled: can("settings.manage") });
  const { data: lgpd } = useQuery({ queryKey: ["lgpd"], queryFn: () => api.get<Array<{ id: string; purpose: string; dataCategory: string; legalBasis: string; source: string; retention: string }>>("/lgpd/processing-records"), enabled: can("audit.view") });
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
            { key: "s", label: "", render: (x) => can("settings.manage") ? <Button variant="ghost" onClick={() => toggleReason.mutate(x)}>{x.active ? "Desativar" : "Ativar"}</Button> : <StatusBadge status={x.active ? "ACTIVE" : "INACTIVE"} /> },
          ]}
        />
        {can("settings.manage") && (
          <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-3">
            <Input placeholder="CÓDIGO" value={r.code} onChange={(e) => setR({ ...r, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
            <Input placeholder="Nome" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.requiresJustification} onChange={(e) => setR({ ...r, requiresJustification: e.target.checked })} /> exige justificativa</label>
            <Button loading={saveReason.isPending} onClick={() => saveReason.mutate(undefined)}>Salvar motivo</Button>
            <div className="sm:col-span-3"><ErrorBox error={saveReason.error} /></div>
          </div>
        )}
      </Card>
      {can("settings.manage") && (
        <Card title={`Termo de entrega ${active ? `(v${active.version} vigente)` : ""}`}>
          {active && <p className="mb-3 whitespace-pre-line rounded bg-zinc-50 p-3 text-sm">{active.text}</p>}
          <Field label="Nova versão" hint="Publicar cria nova versão; entregas antigas mantêm a versão aceita."><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <ErrorBox error={saveTerms.error} />
          <Button className="mt-2" loading={saveTerms.isPending} disabled={text.trim().length < 20} onClick={() => saveTerms.mutate(undefined)}>Publicar versão</Button>
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
  const [tab, setTab] = useState("org");
  const tabs = [
    { id: "org", label: "Organização" },
    { id: "jobs", label: "Funções × EPI" },
    { id: "wh", label: "Almoxarifados" },
    ...(can("users.view") ? [{ id: "users", label: "Usuários" }] : []),
    ...(can("devices.view") ? [{ id: "devices", label: "Dispositivos" }] : []),
    { id: "settings", label: "Motivos, termo e LGPD" },
  ];
  return (
    <>
      <PageHeader title="Administração" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "org" && <Organization />}
      {tab === "jobs" && <Jobs />}
      {tab === "wh" && <Warehouses />}
      {tab === "users" && <Users />}
      {tab === "devices" && <Devices />}
      {tab === "settings" && <Settings />}
    </>
  );
}
