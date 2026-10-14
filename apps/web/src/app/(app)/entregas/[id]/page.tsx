"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, FormActions, Loading, Modal, PageHeader, StatusBadge, Table, Textarea, useToast } from "@/components/ui";
import { api, openFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, maskCpf } from "@/lib/format";
import { companyName } from "@/lib/hooks";

interface Delivery {
  id: string;
  publicId: string;
  status: string;
  deliveredAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  hashValid: boolean;
  employee: { id: string; name: string; cpf: string; registration: string | null };
  manager: { name: string } | null;
  warehouse: { name: string } | null;
  company: { legalName: string; tradeName: string | null } | null;
  items: Array<{ id: string; productDescription: string; quantity: number; caNumber: string; lotNumber: string; lotExpiryDate: string | null; caValidAtPurchase: boolean | null; reasonCode: string; justification: string | null; isEarlyReplacement: boolean; nextReplacementDue: string | null }>;
  evidence: { hash: string; verificationMethod: string; biometricScore: number | null; livenessResult: boolean | null; livenessChallenge: string | null; termsVersion: number; ipAddress: string | null; userAgent: string | null; createdAt: string } | null;
}

export default function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const { data: d, error, isLoading } = useQuery({ queryKey: ["delivery", id], queryFn: () => api.get<Delivery>(`/deliveries/${id}`) });
  const cancel = useMutation({
    mutationFn: () => api.post(`/deliveries/${id}/cancel`, { reason }),
    onSuccess: () => {
      setCancelling(false);
      void qc.invalidateQueries({ queryKey: ["delivery", id] });
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      toast("Entrega cancelada — estoque estornado, registro original preservado");
    },
  });

  if (isLoading) return <Loading />;
  if (error || !d) return <ErrorBox error={error} />;

  return (
    <>
      <PageHeader
        title={`Entrega ${d.publicId}`}
        subtitle={<span className="flex items-center gap-2">{fmtDateTime(d.deliveredAt)} <StatusBadge status={d.status} /></span>}
        actions={
          <>
            <Button onClick={() => void openFile(`/deliveries/${id}/pdf`)}>Comprovante PDF</Button>
            <Link href={`/verificar/${d.publicId}`} target="_blank" className="inline-flex min-h-10 items-center rounded-lg border border-zinc-300 bg-white px-4 text-sm">Verificação pública</Link>
            {can("entregas.entregas.excluir") && d.status === "ACTIVE" && <Button variant="danger" onClick={() => setCancelling(true)}>Cancelar</Button>}
          </>
        }
      />
      {d.status === "CANCELLED" && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Cancelada em {fmtDateTime(d.cancelledAt)}: {d.cancellationReason}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dados" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-zinc-500">Colaborador</dt><dd><Link className="font-medium text-brand-800 hover:underline" href={`/colaboradores/${d.employee.id}`}>{d.employee.name}</Link> · {maskCpf(d.employee.cpf)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Empresa</dt><dd>{companyName(d.company)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Responsável</dt><dd>{d.manager?.name ?? "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Almoxarifado</dt><dd>{d.warehouse?.name ?? "—"}</dd></div>
          </dl>
        </Card>
        <Card title="Evidência" className="lg:col-span-2">
          {d.evidence ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-zinc-500">Integridade</dt><dd>{d.hashValid ? <Badge color="green">hash confere</Badge> : <Badge color="red">hash NÃO confere</Badge>}</dd></div>
              <div><dt className="text-xs text-zinc-500">Método</dt><dd>Biometria facial 1:1 + prova de vida ({d.evidence.livenessChallenge})</dd></div>
              <div><dt className="text-xs text-zinc-500">Similaridade</dt><dd>{d.evidence.biometricScore?.toFixed(3) ?? "—"}</dd></div>
              <div><dt className="text-xs text-zinc-500">Termo</dt><dd>versão {d.evidence.termsVersion}</dd></div>
              <div><dt className="text-xs text-zinc-500">IP</dt><dd>{d.evidence.ipAddress ?? "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-zinc-500">SHA-256</dt><dd className="break-all font-mono text-xs">{d.evidence.hash}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-zinc-500">Sem evidência.</p>
          )}
        </Card>
      </div>
      <Card title="Itens" className="mt-4">
        <Table
          rows={d.items}
          rowKey={(i) => i.id}
          columns={[
            { key: "p", label: "EPI", render: (i) => i.productDescription },
            { key: "q", label: "Qtd", render: (i) => i.quantity },
            { key: "ca", label: "CA", render: (i) => <>{i.caNumber} {i.caValidAtPurchase === false && <Badge color="red">vencido na compra</Badge>}</> },
            { key: "l", label: "Lote / validade", render: (i) => `${i.lotNumber} · ${fmtDate(i.lotExpiryDate)}` },
            { key: "m", label: "Motivo", render: (i) => <>{i.reasonCode}{i.isEarlyReplacement && <Badge color="amber">antecipada</Badge>}{i.justification && <p className="text-xs text-zinc-500">{i.justification}</p>}</> },
            { key: "n", label: "Próx. troca", render: (i) => fmtDate(i.nextReplacementDue) },
          ]}
        />
      </Card>
      <Modal open={cancelling} title="Cancelar entrega" onClose={() => setCancelling(false)}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate();
          }}
        >
          <p className="text-sm text-zinc-600">O registro original não é apagado: a entrega fica marcada como cancelada, o estoque é estornado por movimento e a ação é auditada.</p>
          <Field label="Motivo do cancelamento">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorBox error={cancel.error} />
          <FormActions>
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)}>Voltar</Button>
            <Button type="submit" variant="danger" disabled={reason.trim().length < 5} loading={cancel.isPending}>{cancel.isPending ? "Cancelando…" : "Confirmar cancelamento"}</Button>
          </FormActions>
        </form>
      </Modal>
    </>
  );
}
