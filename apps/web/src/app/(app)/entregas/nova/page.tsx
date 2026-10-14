"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BiometricCapture, type VerifyResult } from "@/components/biometric-capture";
import { type EmployeeLite, EmployeePicker, EpiPicker, type PickedVariant, WarehouseSelect } from "@/components/pickers";
import { IconCheck, IconPlus } from "@/components/icons";
import { Badge, Button, Card, cx, ErrorBox, Field, FormActions, Input, LinkButton, Loading, Modal, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { api, newIdempotencyKey, openFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { companyName, useReasons, variantLabel } from "@/lib/hooks";

interface Line {
  key: string;
  product: PickedVariant["product"];
  variant: PickedVariant["variant"];
  lotId?: string;
  quantity: number;
  reasonCode: string;
  justification: string;
}

interface PreparedItem {
  index: number;
  productDescription: string | null;
  sku: string | null;
  quantity: number;
  reasonName: string | null;
  lot: { id: string; lotNumber: string; caNumber: string; expiryDate: string | null; caValidAtPurchase: boolean | null } | null;
  available: number;
  manufacturer: string | null;
  caToday: { validUntil: string | null; situation: string | null; validToday: boolean | null } | null;
  isEarlyReplacement: boolean;
  nextReplacementDue: string | null;
  requiredByJob: boolean;
  warnings: string[];
  errors: string[];
}

interface Prepared {
  ok: boolean;
  errors: string[];
  employee: { id: string; name: string; registration: string | null; job: { name: string } | null; company: { legalName: string; tradeName: string | null } };
  warehouse: { id: string; name: string };
  items: PreparedItem[];
  terms: { version: number; text: string; textHash: string } | null;
  biometric: { id: string; enrolledAt: string } | null;
}

interface Sst {
  requirements: Array<{ productId: string; productDescription: string; requiredQty: number; status: string; nextReplacementDue: string | null }>;
  biometric: { id: string } | null;
}

interface Created {
  id: string;
  publicId: string;
  hash: string | null;
  deliveredAt: string;
  replayed: boolean;
  warnings?: string[];
}

const STEPS = ["Colaborador", "Itens", "Conferência", "Termo e biometria", "Concluído"];

function Wizard() {
  const params = useSearchParams();
  const { me } = useAuth();
  const { data: reasons } = useReasons();
  const [step, setStep] = useState(0);
  const [employee, setEmployee] = useState<EmployeeLite | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [adding, setAdding] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [verification, setVerification] = useState<VerifyResult | null>(null);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());
  const [created, setCreated] = useState<Created | null>(null);

  const presetId = params.get("employeeId");
  useEffect(() => {
    if (presetId && !employee) {
      api.get<EmployeeLite>(`/employees/${presetId}`).then((e) => {
        setEmployee(e);
        setStep(1);
      }).catch(() => undefined);
    }
  }, [presetId, employee]);

  const { data: sst } = useQuery({ queryKey: ["employee", employee?.id], queryFn: () => api.get<Sst>(`/employees/${employee!.id}/sst`), enabled: !!employee });
  const pending = sst?.requirements.filter((r) => r.status !== "OK") ?? [];

  const activeReasons = useMemo(() => reasons?.filter((r) => r.active) ?? [], [reasons]);

  const prepare = useMutation({
    mutationFn: () =>
      api.post<Prepared>("/deliveries/prepare", {
        employeeId: employee!.id,
        warehouseId,
        items: lines.map((l) => ({ variantId: l.variant.id, lotId: l.lotId, quantity: l.quantity, reasonCode: l.reasonCode, justification: l.justification || null })),
      }),
    onSuccess: (p) => {
      setPrepared(p);
      setStep(2);
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<Created>(
        "/deliveries",
        {
          employeeId: employee!.id,
          warehouseId,
          items: lines.map((l) => ({ variantId: l.variant.id, lotId: prepared?.items[lines.indexOf(l)]?.lot?.id ?? l.lotId, quantity: l.quantity, reasonCode: l.reasonCode, justification: l.justification || null })),
          termsVersion: prepared!.terms!.version,
          confirmed: true,
          biometricVerificationId: verification!.verificationId,
        },
        { "idempotency-key": idemKey },
      ),
    onSuccess: (c) => {
      setCreated(c);
      setStep(4);
    },
  });

  function addLine(p: PickedVariant) {
    const pendingReq = pending.find((r) => r.productId === p.product.id);
    const defaultReason = pendingReq?.status === "MISSING" ? "INITIAL" : pendingReq?.status === "OVERDUE" ? "WEAR" : "";
    setLines((ls) => [...ls, { key: crypto.randomUUID(), product: p.product, variant: p.variant, lotId: p.lotId, quantity: pendingReq?.requiredQty ?? 1, reasonCode: defaultReason, justification: "" }]);
    setAdding(false);
  }

  async function addPending() {
    for (const r of pending) {
      if (lines.some((l) => l.product.id === r.productId)) continue;
      const product = await api.get<PickedVariant["product"]>(`/epis/${r.productId}`);
      const active = product.variants.filter((v) => v.active);
      if (active.length === 1) addLine({ product, variant: active[0]! });
    }
  }

  function reset() {
    setStep(0);
    setEmployee(null);
    setLines([]);
    setPrepared(null);
    setConfirmed(false);
    setVerification(null);
    setCreated(null);
    setIdemKey(newIdempotencyKey());
  }

  const deviceOk = me?.device?.status === "TRUSTED";
  const linesValid = lines.length > 0 && lines.every((l) => l.quantity > 0 && l.reasonCode && (!activeReasons.find((r) => r.code === l.reasonCode)?.requiresJustification || l.justification.trim()));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Entrega de EPI" subtitle="Validação legal no servidor · biometria facial 1:1 com prova de vida" />
      <ol className="mb-4 flex gap-1 overflow-x-auto text-xs" aria-label={`Etapa ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={cx(
              "tabular flex min-h-7 items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-center transition-colors duration-200",
              i === step ? "flex-[3] bg-brand-400 font-semibold text-zinc-900 sm:flex-1" : i < step ? "flex-1 bg-brand-100 text-brand-900" : "flex-1 bg-zinc-200 text-zinc-600",
            )}
          >
            {i + 1}
            <span className={cx(i === step ? "inline" : "hidden sm:inline")}>. {s}</span>
          </li>
        ))}
      </ol>
      {!deviceOk && step < 4 && (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Entregas só podem ser registradas em dispositivo autorizado. <Link href="/dispositivo" className="font-medium underline underline-offset-2">Ver dispositivo</Link>
        </div>
      )}

      {step === 0 && (
        <Card title="Quem vai receber?">
          <EmployeePicker
            onPick={(e) => {
              setEmployee(e);
              setStep(1);
            }}
          />
        </Card>
      )}

      {step === 1 && employee && (
        <div className="space-y-4">
          <Card
            title={employee.name}
            actions={<Button variant="ghost" onClick={() => { setEmployee(null); setLines([]); setStep(0); }}>Trocar</Button>}
          >
            <p className="break-any text-sm text-zinc-600">
              {employee.registration ?? "s/ matrícula"} · {employee.job?.name ?? "sem função"} · {employee.department?.name ?? "sem setor"} · {companyName(employee.company)}
            </p>
            {sst && !sst.biometric && (
              <Notice tone="error" className="mt-2">
                Colaborador sem biometria cadastrada — <Link className="font-medium underline underline-offset-2" href={`/colaboradores/${employee.id}`}>cadastre antes da entrega</Link>.
              </Notice>
            )}
            {pending.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">Pendências pela função:</p>
                <ul className="mt-1.5 list-inside list-disc space-y-1 text-amber-900">
                  {pending.map((r) => (
                    <li key={r.productId}>
                      {r.productDescription} — <StatusBadge status={r.status} /> {r.nextReplacementDue && `(troca prevista ${fmtDate(r.nextReplacementDue)})`}
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" className="mt-3" onClick={() => void addPending()}>Adicionar pendentes</Button>
              </div>
            )}
          </Card>
          <Card title="Itens da entrega">
            <Field label="Almoxarifado de saída" className="mb-3 max-w-md">
              <WarehouseSelect value={warehouseId} onChange={setWarehouseId} companyId={employee.companyId} />
            </Field>
            <div className="space-y-3">
              {lines.map((l, i) => {
                const reason = activeReasons.find((r) => r.code === l.reasonCode);
                return (
                  <div key={l.key} className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-any font-medium text-zinc-900">{l.product.description}</p>
                          <p className="break-any text-xs text-zinc-600">{variantLabel(l.variant)} · SKU {l.variant.sku} · CA {l.product.cas[0]?.caNumber ?? "—"}{l.lotId ? " · lote escaneado" : ""}</p>
                        </div>
                        <button className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 active:bg-red-100" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>remover</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 lg:w-96 lg:shrink-0">
                        <Field label="Qtd">
                          <Input type="number" inputMode="numeric" min={1} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                        </Field>
                        <Field label="Motivo" className="col-span-2">
                          <Select value={l.reasonCode} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, reasonCode: e.target.value } : x)))}>
                            <option value="">Selecione…</option>
                            {activeReasons.map((r) => (
                              <option key={r.code} value={r.code}>{r.name}</option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    </div>
                    {(reason?.requiresJustification || l.justification) && (
                      <Field label={`Justificativa${reason?.requiresJustification ? " (obrigatória)" : ""}`} className="mt-2">
                        <Textarea rows={2} value={l.justification} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, justification: e.target.value } : x)))} />
                      </Field>
                    )}
                    {!reason?.requiresJustification && !l.justification && (
                      <button className="mt-1 min-h-8 text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, justification: " " } : x)))}>adicionar justificativa</button>
                    )}
                  </div>
                );
              })}
              <Button variant="secondary" className="w-full border-dashed" onClick={() => setAdding(true)}>
                <IconPlus size={18} />
                Adicionar EPI
              </Button>
            </div>
          </Card>
          <ErrorBox error={prepare.error} />
          <FormActions className="rounded-xl border border-zinc-200 px-4">
            <Button disabled={!warehouseId || !linesValid} loading={prepare.isPending} onClick={() => prepare.mutate()}>
              {prepare.isPending ? "Conferindo…" : "Conferir entrega"}
            </Button>
          </FormActions>
        </div>
      )}

      {step === 2 && prepared && (
        <div className="space-y-4">
          {prepared.errors.length > 0 && (
            <div role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3">
              {prepared.errors.map((e) => <Notice key={e} tone="error">{e}</Notice>)}
            </div>
          )}
          {prepared.items.map((it) => (
            <Card key={it.index} title={`${it.quantity}× ${it.productDescription ?? "?"}`}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3 lg:grid-cols-5">
                <div><dt className="text-xs text-zinc-500">Lote (FEFO)</dt><dd>{it.lot?.lotNumber ?? "—"}</dd></div>
                <div><dt className="text-xs text-zinc-500">Validade do lote</dt><dd>{fmtDate(it.lot?.expiryDate)}</dd></div>
                <div><dt className="text-xs text-zinc-500">CA</dt><dd>{it.lot?.caNumber ?? "—"}</dd></div>
                <div>
                  <dt className="text-xs text-zinc-500">CA na compra</dt>
                  <dd>{it.lot?.caValidAtPurchase === true ? <Badge color="green">válido</Badge> : it.lot?.caValidAtPurchase === false ? <Badge color="red">vencido</Badge> : <Badge color="amber">não verificado</Badge>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">CA hoje</dt>
                  <dd>{it.caToday ? <>{it.caToday.validToday ? <Badge color="green">válido</Badge> : <Badge color="amber">vencido</Badge>} {fmtDate(it.caToday.validUntil)}</> : "sem base CAEPI"}</dd>
                </div>
                <div><dt className="text-xs text-zinc-500">Próxima troca</dt><dd>{fmtDate(it.nextReplacementDue)}</dd></div>
                <div><dt className="text-xs text-zinc-500">Motivo</dt><dd>{it.reasonName}{it.isEarlyReplacement && " (troca antecipada)"}</dd></div>
                <div><dt className="text-xs text-zinc-500">Saldo no lote</dt><dd>{it.available}</dd></div>
                <div><dt className="text-xs text-zinc-500">Fabricante</dt><dd>{it.manufacturer ?? "—"}</dd></div>
              </dl>
              {it.errors.map((e) => <Notice key={e} tone="error" className="mt-2">{e}</Notice>)}
              {it.warnings.map((w) => <Notice key={w} tone="warn" className="mt-2">{w}</Notice>)}
            </Card>
          ))}
          <FormActions className="rounded-xl border border-zinc-200 px-4">
            <Button variant="secondary" onClick={() => setStep(1)}>Voltar</Button>
            <Button disabled={!prepared.ok || !deviceOk} onClick={() => setStep(3)}>Prosseguir</Button>
          </FormActions>
        </div>
      )}

      {step === 3 && prepared?.terms && employee && (
        <div className="space-y-4">
          <Card title={`Termo de recebimento — versão ${prepared.terms.version}`}>
            <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-zinc-700">{prepared.terms.text}</p>
            <ul className="mt-3 list-inside list-disc space-y-0.5 text-sm text-zinc-700">
              {prepared.items.map((it) => <li key={it.index}>{it.quantity}× {it.productDescription} — CA {it.lot?.caNumber} — lote {it.lot?.lotNumber}</li>)}
            </ul>
            <label className={cx("mt-4 flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 text-sm leading-relaxed transition-colors", confirmed ? "border-brand-500 bg-brand-100" : "border-brand-400 bg-brand-50 hover:bg-brand-100/70")}>
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span><strong>{employee.name}</strong> confirma que recebeu os EPIs acima, foi orientado(a) sobre uso, guarda e conservação e está ciente das obrigações da NR-6.</span>
            </label>
          </Card>
          {confirmed && (
            <Card title="Biometria facial do colaborador">
              {verification ? (
                <Notice tone="ok">Identidade confirmada (similaridade {verification.score.toFixed(2)}, prova de vida aprovada).</Notice>
              ) : (
                <div className="max-w-3xl">
                  <BiometricCapture employeeId={employee.id} purpose="DELIVERY" onVerified={setVerification} />
                </div>
              )}
            </Card>
          )}
          <ErrorBox error={submit.error} />
          <FormActions className="rounded-xl border border-zinc-200 px-4">
            <Button variant="secondary" onClick={() => setStep(2)}>Voltar</Button>
            <Button disabled={!confirmed || !verification} loading={submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? "Registrando…" : "Registrar entrega"}
            </Button>
          </FormActions>
        </div>
      )}

      {step === 4 && created && (
        <Card>
          <div className="space-y-3 text-center" role="status">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-8 ring-emerald-50">
              <IconCheck size={34} strokeWidth={2.4} />
            </span>
            <p className="text-lg font-semibold text-zinc-900">Entrega registrada{created.replayed ? " (já registrada anteriormente)" : ""}</p>
            <p className="tabular text-sm text-zinc-600">{fmtDateTime(created.deliveredAt)} · código {created.publicId}</p>
            <p className="break-all font-mono text-xs text-zinc-500">SHA-256 {created.hash}</p>
            {created.warnings?.map((w) => <Notice key={w} tone="warn" className="justify-center text-left">{w}</Notice>)}
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button onClick={() => void openFile(`/deliveries/${created.id}/pdf`)}>Comprovante PDF</Button>
              <LinkButton variant="secondary" href={`/entregas/${created.id}`}>Detalhes</LinkButton>
              <Button variant="secondary" onClick={reset}>Nova entrega</Button>
            </div>
          </div>
        </Card>
      )}

      <Modal open={adding} title="Adicionar EPI" onClose={() => setAdding(false)}>
        <EpiPicker onPick={addLine} />
      </Modal>
    </div>
  );
}

export default function NewDeliveryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Wizard />
    </Suspense>
  );
}
