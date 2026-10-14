"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { BiometricCapture } from "@/components/biometric-capture";
import { DocumentsPanel } from "@/components/documents-panel";
import { EmployeeForm, type EmployeeData } from "@/components/employee-form";
import { IconPlus } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, FormActions, Input, LinkButton, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Tabs, useToast } from "@/components/ui";
import { api, openFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, maskCpf } from "@/lib/format";
import { companyName } from "@/lib/hooks";

interface Sst {
  employee: EmployeeData & {
    id: string;
    status: string;
    company: { legalName: string; tradeName: string | null };
    establishment: { name: string };
    department: { name: string } | null;
    job: { name: string; cbo: string | null } | null;
  };
  summary: { required: number; delivered: number; pending: number; lastDeliveryAt: string | null; nextReplacement: string | null; deliveries: number; returns: number };
  requirements: Array<{ productId: string; productDescription: string; requiredQty: number; replacementDays: number | null; lastDeliveredAt: string | null; nextReplacementDue: string | null; status: string }>;
  recentItems: Array<{ id: string; productDescription: string; quantity: number; caNumber: string; lotNumber: string; reasonCode: string; nextReplacementDue: string | null; delivery: { id: string; deliveredAt: string; publicId: string } }>;
  biometric: { id: string; enrolledAt: string; quality: number; legalBasis: string } | null;
}

interface TimelineEvent {
  at: string;
  type: string;
  title: string;
  detail: string | null;
  ref: string;
}

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("sst");
  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const { data, error, isLoading } = useQuery({ queryKey: ["employee", id], queryFn: () => api.get<Sst>(`/employees/${id}/sst`) });
  const { data: timeline } = useQuery({ queryKey: ["employee", id, "timeline"], queryFn: () => api.get<TimelineEvent[]>(`/employees/${id}/timeline`), enabled: tab === "timeline" });

  const revoke = useMutation({
    mutationFn: () => api.del(`/biometrics/profiles/${id}`, { reason: revokeReason }),
    onSuccess: () => {
      setRevoking(false);
      void qc.invalidateQueries({ queryKey: ["employee", id] });
      toast("Biometria revogada e template eliminado");
    },
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const e = data.employee;
  const s = data.summary;

  return (
    <>
      <PageHeader
        title={e.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {e.registration ?? "s/ matrícula"} · CPF {maskCpf(e.cpf)} · {e.job?.name ?? "sem função"} · {e.department?.name ?? "sem setor"} · {companyName(e.company)} / {e.establishment.name}
            <StatusBadge status={e.status} />
          </span>
        }
        actions={
          <>
            {can("entregas.entregas.inserir") && e.status === "ACTIVE" && <LinkButton href={`/entregas/nova?employeeId=${id}`}><IconPlus size={18} />Entregar EPI</LinkButton>}
            <Button variant="secondary" onClick={() => void openFile(`/employees/${id}/epi-sheet?format=pdf`)}>Ficha de EPI (PDF)</Button>
            {can("colaboradores.cadastro.alterar") && <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "sst", label: "SST / EPI" },
          { id: "entregas", label: "Entregas" },
          { id: "biometria", label: "Biometria" },
          { id: "timeline", label: "Linha do tempo" },
          { id: "documentos", label: "Documentos" },
        ]}
      />

      {tab === "sst" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="EPIs obrigatórios" value={s.required} />
            <Stat label="Pendentes" value={s.pending} tone={s.pending ? "amber" : "green"} />
            <Stat label="Última entrega" value={<span className="text-base">{fmtDate(s.lastDeliveryAt)}</span>} />
            <Stat label="Próxima troca" value={<span className="text-base">{fmtDate(s.nextReplacement)}</span>} />
          </div>
          {!data.biometric && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Sem biometria cadastrada — necessária para entregas. <button className="font-medium underline" onClick={() => setTab("biometria")}>Cadastrar</button></div>}
          <Card title="EPIs obrigatórios pela função">
            <Table
              rows={data.requirements}
              rowKey={(r) => r.productId}
              empty="A função não possui EPIs obrigatórios cadastrados (Administração › Funções)."
              columns={[
                { key: "p", label: "EPI", render: (r) => r.productDescription },
                { key: "q", label: "Qtd", render: (r) => r.requiredQty },
                { key: "per", label: "Troca (dias)", render: (r) => r.replacementDays ?? "—" },
                { key: "l", label: "Última entrega", render: (r) => fmtDate(r.lastDeliveredAt) },
                { key: "n", label: "Próx. troca", render: (r) => fmtDate(r.nextReplacementDue) },
                { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </Card>
          <p className="text-xs text-zinc-500">Exames/ASO, treinamentos, riscos e eventos eSocial (somente leitura) entram nas próximas fases do plano mestre.</p>
        </div>
      )}

      {tab === "entregas" && (
        <Card
          title="Itens entregues (ativos)"
          actions={
            <>
              <Button variant="secondary" onClick={() => void openFile(`/employees/${id}/epi-sheet?format=xlsx`, true)}>XLSX</Button>
              <Button variant="secondary" onClick={() => void openFile(`/employees/${id}/epi-sheet?format=csv`, true)}>CSV</Button>
            </>
          }
        >
          <Table
            rows={data.recentItems}
            rowKey={(r) => r.id}
            empty="Nenhuma entrega."
            columns={[
              { key: "d", label: "Data", render: (r) => <Link className="font-medium text-brand-800 hover:underline" href={`/entregas/${r.delivery.id}`}>{fmtDateTime(r.delivery.deliveredAt)}</Link> },
              { key: "p", label: "EPI", render: (r) => r.productDescription },
              { key: "q", label: "Qtd", render: (r) => r.quantity },
              { key: "ca", label: "CA", render: (r) => r.caNumber },
              { key: "l", label: "Lote", render: (r) => r.lotNumber },
              { key: "m", label: "Motivo", render: (r) => r.reasonCode },
              { key: "n", label: "Próx. troca", render: (r) => fmtDate(r.nextReplacementDue) },
            ]}
          />
        </Card>
      )}

      {tab === "biometria" && (
        <Card title="Biometria facial">
          {data.biometric ? (
            <div className="space-y-3 text-sm">
              <p>
                <Badge color="green">Cadastrada</Badge> em {fmtDateTime(data.biometric.enrolledAt)} · qualidade {(data.biometric.quality * 100).toFixed(0)}%
              </p>
              <p className="text-zinc-500">Base legal: {data.biometric.legalBasis}</p>
              <p className="text-xs text-zinc-500">O template é cifrado e fica isolado no serviço de biometria; nenhuma imagem é armazenada.</p>
              <div className="flex flex-wrap gap-2">
                {can("colaboradores.biometria.inserir") && <Button variant="secondary" onClick={() => setEnrolling(true)}>Recadastrar</Button>}
                {can("colaboradores.biometria.excluir") && <Button variant="danger" onClick={() => setRevoking(true)}>Revogar</Button>}
              </div>
            </div>
          ) : can("colaboradores.biometria.inserir") ? (
            enrolling ? null : <Button onClick={() => setEnrolling(true)}>Cadastrar biometria</Button>
          ) : (
            <p className="text-sm text-zinc-500">Sem biometria cadastrada.</p>
          )}
          {enrolling && (
            <div className="mt-4 max-w-xl">
              <p className="mb-2 text-sm text-zinc-600">Finalidade: comprovação de recebimento de EPI (NR-6). Informe o colaborador antes da captura (LGPD art. 9º).</p>
              <BiometricCapture
                employeeId={id}
                purpose="ENROLL"
                onEnrolled={() => {
                  setEnrolling(false);
                  void qc.invalidateQueries({ queryKey: ["employee", id] });
                  toast("Biometria cadastrada");
                }}
              />
            </div>
          )}
        </Card>
      )}

      {tab === "timeline" && (
        <Card title="Linha do tempo">
          {!timeline ? (
            <Loading />
          ) : (
            <ol className="relative space-y-4 border-l border-zinc-200 pl-5">
              {timeline.map((ev) => (
                <li key={`${ev.type}:${ev.ref}:${ev.at}`}>
                  <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${ev.type.includes("cancel") || ev.type.includes("revoked") ? "bg-red-500" : "bg-brand-500"}`} />
                  <p className="text-xs text-zinc-500">{fmtDateTime(ev.at)}</p>
                  <p className="text-sm font-medium">{ev.title}</p>
                  {ev.detail && <p className="text-sm text-zinc-600">{ev.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === "documentos" && (
        <Card title="Documentos do colaborador">
          <DocumentsPanel entityType="EMPLOYEE" entityId={id} />
        </Card>
      )}

      <Modal open={editing} title="Editar colaborador" onClose={() => setEditing(false)} wide>
        <EmployeeForm initial={{ ...e, id }} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </Modal>
      <Modal open={revoking} title="Revogar biometria" onClose={() => setRevoking(false)}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            revoke.mutate();
          }}
        >
          <p className="text-sm text-zinc-600">O template será eliminado do serviço de biometria. Entregas futuras exigirão novo cadastro. O histórico de entregas permanece íntegro.</p>
          <Field label="Motivo">
            <Input value={revokeReason} onChange={(ev) => setRevokeReason(ev.target.value)} />
          </Field>
          <ErrorBox error={revoke.error} />
          <FormActions>
            <Button type="button" variant="secondary" onClick={() => setRevoking(false)}>Voltar</Button>
            <Button type="submit" variant="danger" disabled={revokeReason.trim().length < 5} loading={revoke.isPending}>{revoke.isPending ? "Revogando…" : "Revogar"}</Button>
          </FormActions>
        </form>
      </Modal>
    </>
  );
}
