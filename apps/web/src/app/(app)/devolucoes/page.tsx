"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type EmployeeLite, EmployeePicker, WarehouseSelect } from "@/components/pickers";
import { IconPlus } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, FormActions, Input, Modal, PageHeader, Select, Table, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";

interface ReturnRow {
  id: string;
  returnedAt: string;
  quantity: number;
  condition: string;
  destination: string;
  reason: string;
  stage: string;
  employee: { id: string; name: string };
  steps: Array<{ step: string; performedAt: string; notes: string | null }>;
}

interface SstItems {
  recentItems: Array<{ id: string; variantId: string; lotId: string; productDescription: string; quantity: number; lotNumber: string; delivery: { deliveredAt: string } }>;
}

const CONDITION: Record<string, string> = { GOOD: "Bom", WORN: "Desgastado", DAMAGED: "Danificado", CONTAMINATED: "Contaminado" };
const DEST: Record<string, string> = { REUSABLE: "Reutilizável", SANITIZATION: "Higienização", MAINTENANCE: "Manutenção", DISCARDED: "Descarte" };
const STAGE: Record<string, string> = { RECEIVED: "Recebido", SANITIZATION: "Higienização", MAINTENANCE: "Manutenção", INSPECTION: "Inspeção", RELEASED: "Liberado ao estoque", DISCARDED: "Descartado" };
const NEXT_STEPS = ["SANITIZATION", "MAINTENANCE", "INSPECTION", "RELEASED", "DISCARDED"] as const;

export default function ReturnsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [employee, setEmployee] = useState<EmployeeLite | null>(null);
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [f, setF] = useState({ quantity: 1, condition: "GOOD", destination: "REUSABLE", reason: "", notes: "" });
  const [stepFor, setStepFor] = useState<ReturnRow | null>(null);
  const [step, setStep] = useState<string>("RELEASED");
  const [stepNotes, setStepNotes] = useState("");

  const { data } = useQuery({ queryKey: ["returns"], queryFn: () => api.get<ReturnRow[]>("/returns") });
  const { data: sst } = useQuery({ queryKey: ["employee", employee?.id], queryFn: () => api.get<SstItems>(`/employees/${employee!.id}/sst`), enabled: !!employee });
  const item = sst?.recentItems.find((i) => i.id === itemId);

  const create = useMutation({
    mutationFn: () =>
      api.post("/returns", { employeeId: employee!.id, deliveryItemId: itemId, variantId: item!.variantId, lotId: item!.lotId, warehouseId, quantity: f.quantity, condition: f.condition, destination: f.destination, reason: f.reason, notes: f.notes || null }),
    onSuccess: () => {
      setOpen(false);
      setEmployee(null);
      setItemId("");
      void qc.invalidateQueries({ queryKey: ["returns"] });
      toast("Devolução registrada");
    },
  });
  const addStep = useMutation({
    mutationFn: () => api.post(`/returns/${stepFor!.id}/steps`, { step, notes: stepNotes || null }),
    onSuccess: () => {
      setStepFor(null);
      setStepNotes("");
      void qc.invalidateQueries({ queryKey: ["returns"] });
      toast(step === "RELEASED" ? "Liberado — retornou ao estoque" : "Etapa registrada");
    },
  });

  return (
    <>
      <PageHeader title="Devoluções e higienização" actions={can("entregas.devolucoes.inserir") && <Button onClick={() => setOpen(true)}><IconPlus size={18} />Registrar devolução</Button>} />
      <Card>
        <Table
          rows={data}
          rowKey={(r) => r.id}
          empty="Nenhuma devolução."
          columns={[
            { key: "d", label: "Data", render: (r) => fmtDateTime(r.returnedAt) },
            { key: "e", label: "Colaborador", render: (r) => r.employee.name },
            { key: "q", label: "Qtd", render: (r) => r.quantity },
            { key: "c", label: "Estado", render: (r) => CONDITION[r.condition] ?? r.condition },
            { key: "ds", label: "Destino", render: (r) => DEST[r.destination] ?? r.destination },
            { key: "s", label: "Etapa", render: (r) => <Badge color={r.stage === "RELEASED" ? "green" : r.stage === "DISCARDED" ? "slate" : "amber"}>{STAGE[r.stage] ?? r.stage}</Badge> },
            {
              key: "a",
              label: "",
              render: (r) => can("entregas.devolucoes.atualizar") && !["RELEASED", "DISCARDED"].includes(r.stage) && <Button variant="ghost" onClick={() => setStepFor(r)}>Avançar etapa</Button>,
            },
          ]}
        />
      </Card>

      <Modal open={open} title="Registrar devolução" onClose={() => setOpen(false)} wide>
        {!employee ? (
          <EmployeePicker onPick={setEmployee} />
        ) : (
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <p className="text-sm font-medium">{employee.name} <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setEmployee(null)}>trocar</button></p>
            <div className="form-grid">
              <Field label="Item entregue" className="form-span-full">
                <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {sst?.recentItems.map((i) => <option key={i.id} value={i.id}>{i.productDescription} — lote {i.lotNumber} — {fmtDateTime(i.delivery.deliveredAt)}</option>)}
                </Select>
              </Field>
              <Field label="Almoxarifado de recebimento"><WarehouseSelect value={warehouseId} onChange={setWarehouseId} companyId={employee.companyId} /></Field>
              <Field label="Quantidade"><Input type="number" min={1} max={item?.quantity} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
              <Field label="Estado">
                <Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>
                  {Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Destino">
                <Select value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>
                  {Object.entries(DEST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Motivo" className="form-span-full"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
              <Field label="Observações" className="form-span-full"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              <p className="form-span-full text-xs text-zinc-500">Só retorna ao estoque imediatamente se reutilizável e em bom estado; demais destinos passam pelo ciclo de higienização/inspeção.</p>
            </div>
            <ErrorBox error={create.error} />
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={!item || !warehouseId || f.reason.trim().length < 2} loading={create.isPending}>{create.isPending ? "Salvando…" : "Registrar"}</Button>
            </FormActions>
          </form>
        )}
      </Modal>

      <Modal open={!!stepFor} title="Avançar etapa" onClose={() => setStepFor(null)}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addStep.mutate();
          }}
        >
          <Field label="Etapa">
            <Select value={step} onChange={(e) => setStep(e.target.value)}>
              {NEXT_STEPS.map((s) => <option key={s} value={s}>{STAGE[s]}</option>)}
            </Select>
          </Field>
          <Field label="Observações"><Textarea rows={2} value={stepNotes} onChange={(e) => setStepNotes(e.target.value)} /></Field>
          <ErrorBox error={addStep.error} />
          <FormActions>
            <Button type="button" variant="secondary" onClick={() => setStepFor(null)}>Cancelar</Button>
            <Button type="submit" loading={addStep.isPending}>{addStep.isPending ? "Salvando…" : "Registrar etapa"}</Button>
          </FormActions>
        </form>
      </Modal>
    </>
  );
}
