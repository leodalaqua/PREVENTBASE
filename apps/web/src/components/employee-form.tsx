"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { useDepartments, useEstablishments, useJobs } from "@/lib/hooks";
import { CompanySelect } from "./pickers";
import { Button, ErrorBox, Field, FormActions, Input, Select, useToast } from "./ui";

export interface EmployeeData {
  id?: string;
  companyId: string;
  establishmentId: string;
  departmentId: string | null;
  jobId: string | null;
  name: string;
  cpf: string;
  registration: string | null;
  birthDate: string | null;
  admissionDate: string | null;
  email: string | null;
  phone: string | null;
  status?: string;
}

const d = (v?: string | null) => (v ? v.slice(0, 10) : "");

export function EmployeeForm({ initial, onSaved, onCancel }: { initial?: EmployeeData; onSaved: (e: { id: string }) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const editing = !!initial?.id;
  const [f, setF] = useState({
    companyId: initial?.companyId ?? "",
    establishmentId: initial?.establishmentId ?? "",
    departmentId: initial?.departmentId ?? "",
    jobId: initial?.jobId ?? "",
    name: initial?.name ?? "",
    cpf: initial?.cpf ?? "",
    registration: initial?.registration ?? "",
    birthDate: d(initial?.birthDate),
    admissionDate: d(initial?.admissionDate),
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    status: initial?.status ?? "ACTIVE",
    terminationDate: "",
    changeReason: "",
    effectiveDate: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { data: ests } = useEstablishments(f.companyId || undefined);
  const { data: deps } = useDepartments(f.companyId || undefined);
  const { data: jobs } = useJobs(f.companyId || undefined);

  const jobChanged = editing && (f.jobId || null) !== (initial?.jobId ?? null);
  const save = useMutation({
    mutationFn: () => {
      const base = {
        establishmentId: f.establishmentId,
        departmentId: f.departmentId || null,
        jobId: f.jobId || null,
        name: f.name,
        registration: f.registration || null,
        birthDate: f.birthDate || null,
        admissionDate: f.admissionDate || null,
        email: f.email || null,
        phone: f.phone || null,
      };
      return editing
        ? api.patch<{ id: string }>(`/employees/${initial!.id}`, {
            ...base,
            status: f.status,
            terminationDate: f.status === "TERMINATED" ? f.terminationDate || null : undefined,
            changeReason: f.changeReason || undefined,
            effectiveDate: f.effectiveDate || undefined,
          })
        : api.post<{ id: string }>("/employees", { ...base, companyId: f.companyId, cpf: f.cpf });
    },
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["employee", e.id] });
      toast(editing ? "Colaborador atualizado" : "Colaborador cadastrado");
      onSaved(e);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="form-grid">
        <h3 className="form-section">Identificação</h3>
        <Field label="Nome completo">
          <Input required minLength={2} value={f.name} onChange={set("name")} />
        </Field>
        <Field label="CPF">
          <Input required={!editing} disabled={editing} inputMode="numeric" value={f.cpf} onChange={set("cpf")} />
        </Field>
        <Field label="Matrícula">
          <Input value={f.registration} onChange={set("registration")} />
        </Field>
        <Field label="Nascimento">
          <Input type="date" value={f.birthDate} onChange={set("birthDate")} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Telefone">
          <Input value={f.phone} onChange={set("phone")} />
        </Field>
        <h3 className="form-section">Vínculo</h3>
        <Field label="Empresa">
          {editing ? <Input disabled value="(não alterável)" /> : <CompanySelect value={f.companyId} onChange={(v) => setF((s) => ({ ...s, companyId: v, establishmentId: "", departmentId: "", jobId: "" }))} />}
        </Field>
        <Field label="Estabelecimento">
          <Select required value={f.establishmentId} onChange={set("establishmentId")}>
            <option value="">Selecione…</option>
            {ests?.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Setor">
          <Select value={f.departmentId} onChange={set("departmentId")}>
            <option value="">—</option>
            {deps?.filter((x) => !f.establishmentId || x.establishmentId === f.establishmentId).map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Função">
          <Select value={f.jobId} onChange={set("jobId")}>
            <option value="">—</option>
            {jobs?.map((x) => (
              <option key={x.id} value={x.id}>{x.name}{x.cbo ? ` (CBO ${x.cbo})` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="Admissão">
          <Input type="date" value={f.admissionDate} onChange={set("admissionDate")} />
        </Field>
        {editing && (
          <>
            <h3 className="form-section">Situação</h3>
            <Field label="Situação">
              <Select value={f.status} onChange={set("status")}>
                <option value="ACTIVE">Ativo</option>
                <option value="ON_LEAVE">Afastado</option>
                <option value="TERMINATED">Desligado</option>
              </Select>
            </Field>
            {f.status === "TERMINATED" && (
              <Field label="Data de desligamento">
                <Input type="date" required value={f.terminationDate} onChange={set("terminationDate")} />
              </Field>
            )}
            {(jobChanged || f.status !== initial?.status) && (
              <>
                <Field label="Vigência da alteração">
                  <Input type="date" value={f.effectiveDate} onChange={set("effectiveDate")} />
                </Field>
                <Field label="Motivo da alteração">
                  <Input value={f.changeReason} onChange={set("changeReason")} />
                </Field>
                {jobChanged && <p className="form-span-full text-xs text-amber-700">Troca de função recalcula os EPIs obrigatórios do colaborador (matriz Função × EPI).</p>}
              </>
            )}
          </>
        )}
      </div>
      <ErrorBox error={save.error} />
      <FormActions>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </FormActions>
    </form>
  );
}
