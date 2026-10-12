"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EpiPicker, type PickedVariant, WarehouseSelect } from "@/components/pickers";
import { IconPlus } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Pager, Select, Table, Tabs, Textarea, useToast } from "@/components/ui";
import { api, newIdempotencyKey, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, MOVEMENT_LABEL, today } from "@/lib/format";
import { type Paged, variantLabel } from "@/lib/hooks";

interface Balance {
  id: string;
  quantity: number;
  warehouse: { id: string; name: string; code: string };
  location: { id: string; code: string };
  lot: { id: string; lotNumber: string; caNumber: string; expiryDate: string | null; caValidAtPurchase: boolean | null; publicCode: string; variant: { sku: string; size: string | null; color: string | null; product: { description: string } } };
}
interface Movement { id: string; createdAt: string; type: string; quantity: number; balanceAfter: number; reason: string | null; lotNumber?: string; sku?: string; productDescription?: string; warehouseName?: string; referenceType: string | null }
interface Alerts {
  lowStock: Array<{ warehouseId: string; variantId: string; productDescription: string; sku: string; warehouseName: string; quantity: number; minQty: number }>;
  expiringLots: Array<{ lotId: string; warehouseId: string; productDescription: string; lotNumber: string; expiryDate: string; quantity: number; warehouseName: string }>;
  expiredLots: Array<{ lotId: string; warehouseId: string; productDescription: string; lotNumber: string; expiryDate: string; quantity: number; warehouseName: string }>;
  windowDays: number;
}
interface Level { id: string; warehouseId: string; minQty: number; maxQty: number | null; variant: { sku: string; product: { description: string } } }

function caBadge(v: boolean | null) {
  return v === true ? <Badge color="green">CA ok</Badge> : v === false ? <Badge color="red">CA vencido na compra</Badge> : <Badge color="amber">CA não verificado</Badge>;
}

function EntryForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<PickedVariant | null>(null);
  const [key] = useState(newIdempotencyKey);
  const [f, setF] = useState({ warehouseId: "", lotNumber: "", caNumber: "", expiryDate: "", purchaseDate: today(), quantity: 1, unitCost: "", supplier: "", invoiceNumber: "", caValidityAtPurchase: "" });
  const save = useMutation({
    mutationFn: () =>
      api.post<{ warnings: string[] }>(
        "/stock/entries",
        {
          warehouseId: f.warehouseId,
          variantId: picked!.variant.id,
          lotNumber: f.lotNumber,
          caNumber: f.caNumber || picked!.product.cas[0]?.caNumber,
          expiryDate: f.expiryDate || null,
          purchaseDate: f.purchaseDate,
          quantity: f.quantity,
          unitCost: f.unitCost ? Number(f.unitCost.replace(",", ".")) : null,
          supplier: f.supplier || null,
          invoiceNumber: f.invoiceNumber || null,
          caValidityAtPurchase: f.caValidityAtPurchase || null,
        },
        { "idempotency-key": key },
      ),
    onSuccess: (r) => {
      toast("Entrada registrada");
      r.warnings.forEach((w) => toast(w, "error"));
      onDone();
    },
  });
  if (!picked) return <EpiPicker onPick={(p) => { setPicked(p); setF((s) => ({ ...s, caNumber: p.product.cas[0]?.caNumber ?? "" })); }} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <p className="text-sm font-medium sm:col-span-2">{picked.product.description} — {variantLabel(picked.variant)} <button className="text-xs text-zinc-500 underline" onClick={() => setPicked(null)}>trocar</button></p>
      <Field label="Almoxarifado"><WarehouseSelect value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} /></Field>
      <Field label="Quantidade"><Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
      <Field label="Lote"><Input value={f.lotNumber} onChange={(e) => setF({ ...f, lotNumber: e.target.value })} /></Field>
      <Field label="CA do lote"><Input value={f.caNumber} onChange={(e) => setF({ ...f, caNumber: e.target.value })} /></Field>
      <Field label="Data da compra"><Input type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} /></Field>
      <Field label="Validade do lote (fabricante)"><Input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></Field>
      <Field label="Validade do CA na compra" hint="Vazio = usa a base CAEPI"><Input type="date" value={f.caValidityAtPurchase} onChange={(e) => setF({ ...f, caValidityAtPurchase: e.target.value })} /></Field>
      <Field label="Custo unitário"><Input inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>
      <Field label="Fornecedor"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
      <Field label="Nota fiscal"><Input value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} /></Field>
      <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>
      <div className="flex justify-end sm:col-span-2"><Button disabled={!f.warehouseId || !f.lotNumber || !f.purchaseDate} loading={save.isPending} onClick={() => save.mutate()}>Registrar entrada</Button></div>
    </div>
  );
}

function MoveForm({ balance, mode, onDone }: { balance: Balance; mode: "transfer" | "adjust"; onDone: () => void }) {
  const toast = useToast();
  const [key] = useState(newIdempotencyKey);
  const [toWarehouseId, setTo] = useState("");
  const [type, setType] = useState("ADJUSTMENT_OUT");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () =>
      mode === "transfer"
        ? api.post("/stock/transfers", { fromWarehouseId: balance.warehouse.id, toWarehouseId, notes: reason || null, items: [{ lotId: balance.lot.id, locationId: balance.location.id, quantity }] }, { "idempotency-key": key })
        : api.post("/stock/adjustments", { warehouseId: balance.warehouse.id, locationId: balance.location.id, lotId: balance.lot.id, type, quantity, reason }, { "idempotency-key": key }),
    onSuccess: () => {
      toast(mode === "transfer" ? "Transferência registrada" : "Ajuste registrado");
      onDone();
    },
  });
  return (
    <div className="space-y-3">
      <p className="text-sm">{balance.lot.variant.product.description} — lote {balance.lot.lotNumber} · saldo {balance.quantity} em {balance.warehouse.name}/{balance.location.code}</p>
      {mode === "transfer" ? (
        <Field label="Destino"><WarehouseSelect value={toWarehouseId} onChange={setTo} /></Field>
      ) : (
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ADJUSTMENT_OUT">Ajuste (−)</option>
            <option value="ADJUSTMENT_IN">Ajuste (+)</option>
            <option value="LOSS">Perda</option>
            <option value="DISPOSAL">Descarte</option>
          </Select>
        </Field>
      )}
      <Field label="Quantidade"><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field>
      <Field label={mode === "transfer" ? "Observação" : "Motivo (obrigatório)"}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorBox error={save.error} />
      <div className="flex justify-end">
        <Button disabled={mode === "transfer" ? !toWarehouseId : reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Confirmar</Button>
      </div>
    </div>
  );
}

function StockContent() {
  const params = useSearchParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState(params.get("tab") ?? "saldos");
  const [warehouseId, setWarehouseId] = useState("");
  const [entry, setEntry] = useState(false);
  const [move, setMove] = useState<{ b: Balance; mode: "transfer" | "adjust" } | null>(null);
  const [mvPage, setMvPage] = useState(1);
  const [mvType, setMvType] = useState("");
  const [level, setLevel] = useState<PickedVariant | null>(null);
  const [levelOpen, setLevelOpen] = useState(false);
  const [minQty, setMinQty] = useState(0);
  const [maxQty, setMaxQty] = useState("");
  const toast = useToast();

  const { data: balances } = useQuery({ queryKey: ["balances", warehouseId], queryFn: () => api.get<Balance[]>(`/stock/balances${qs({ warehouseId })}`), enabled: tab === "saldos" });
  const { data: movements } = useQuery({ queryKey: ["movements", warehouseId, mvType, mvPage], queryFn: () => api.get<Paged<Movement>>(`/stock/movements${qs({ warehouseId, type: mvType, page: mvPage, pageSize: 50 })}`), enabled: tab === "movimentos" });
  const { data: alerts } = useQuery({ queryKey: ["stock-alerts"], queryFn: () => api.get<Alerts>("/stock/alerts"), enabled: tab === "alertas" });
  const { data: levels } = useQuery({ queryKey: ["levels", warehouseId], queryFn: () => api.get<Level[]>(`/stock/levels${qs({ warehouseId })}`), enabled: tab === "minimos" });
  const saveLevel = useMutation({
    mutationFn: () => api.post("/stock/levels", { warehouseId, variantId: level!.variant.id, minQty, maxQty: maxQty ? Number(maxQty) : null }),
    onSuccess: () => {
      setLevelOpen(false);
      setLevel(null);
      void qc.invalidateQueries({ queryKey: ["levels"] });
      toast("Mínimo/máximo definido");
    },
  });

  const refresh = () => {
    setEntry(false);
    setMove(null);
    void qc.invalidateQueries({ queryKey: ["balances"] });
    void qc.invalidateQueries({ queryKey: ["movements"] });
    void qc.invalidateQueries({ queryKey: ["stock-alerts"] });
  };

  const total = balances?.reduce((s, b) => s + b.quantity, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Estoque"
        subtitle="Saldo é consequência dos movimentos — FEFO por lote"
        actions={can("inventory.entry") && <Button onClick={() => setEntry(true)}><IconPlus size={18} />Entrada</Button>}
      />
      <div className="mb-3 max-w-sm"><WarehouseSelect allowAll value={warehouseId} onChange={setWarehouseId} /></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "saldos", label: "Saldos por lote" }, { id: "movimentos", label: "Movimentos" }, { id: "alertas", label: "Alertas" }, { id: "minimos", label: "Mínimo / máximo" }]} />

      {tab === "saldos" && (
        <Card title={`${balances?.length ?? 0} posições · ${total} unidades`}>
          <Table
            rows={balances}
            rowKey={(b) => b.id}
            empty="Sem saldo."
            columns={[
              { key: "p", label: "EPI", render: (b) => <><span className="font-medium">{b.lot.variant.product.description}</span><p className="text-xs text-zinc-500">{b.lot.variant.sku}</p></> },
              { key: "l", label: "Lote", render: (b) => <>{b.lot.lotNumber}<p className="font-mono text-xs text-zinc-500">{b.lot.publicCode}</p></> },
              { key: "ca", label: "CA", render: (b) => <>{b.lot.caNumber} {caBadge(b.lot.caValidAtPurchase)}</> },
              { key: "v", label: "Validade", render: (b) => <span className={b.lot.expiryDate && new Date(b.lot.expiryDate) < new Date() ? "font-medium text-red-700" : ""}>{fmtDate(b.lot.expiryDate)}</span> },
              { key: "w", label: "Local", render: (b) => `${b.warehouse.code}/${b.location.code}` },
              { key: "q", label: "Saldo", render: (b) => <span className="font-semibold">{b.quantity}</span> },
              {
                key: "a",
                label: "",
                render: (b) => (
                  <div className="flex gap-1">
                    {can("inventory.transfer") && <Button variant="ghost" onClick={() => setMove({ b, mode: "transfer" })}>Transferir</Button>}
                    {can("inventory.adjust") && <Button variant="ghost" onClick={() => setMove({ b, mode: "adjust" })}>Ajustar</Button>}
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}

      {tab === "movimentos" && (
        <Card
          title="Movimentos (imutáveis)"
          actions={
            <Select value={mvType} onChange={(e) => { setMvType(e.target.value); setMvPage(1); }}>
              <option value="">Todos os tipos</option>
              {Object.entries(MOVEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          }
        >
          <Table
            rows={movements?.items}
            rowKey={(m) => m.id}
            columns={[
              { key: "d", label: "Data", render: (m) => fmtDateTime(m.createdAt) },
              { key: "t", label: "Tipo", render: (m) => MOVEMENT_LABEL[m.type] ?? m.type },
              { key: "p", label: "EPI", render: (m) => m.productDescription },
              { key: "l", label: "Lote", render: (m) => m.lotNumber },
              { key: "w", label: "Almox.", render: (m) => m.warehouseName },
              { key: "q", label: "Qtd", render: (m) => <span className={m.quantity < 0 ? "text-red-700" : "text-emerald-700"}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
              { key: "b", label: "Saldo após", render: (m) => m.balanceAfter },
              { key: "r", label: "Motivo", render: (m) => <span className="text-xs">{m.reason ?? m.referenceType}</span> },
            ]}
          />
          {movements && <Pager page={mvPage} pageSize={movements.pageSize} total={movements.total} onPage={setMvPage} />}
        </Card>
      )}

      {tab === "alertas" && alerts && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Abaixo do mínimo">
            <Table rows={alerts.lowStock} rowKey={(r) => r.warehouseId + r.variantId} empty="Nenhum." columns={[{ key: "p", label: "EPI", render: (r) => r.productDescription }, { key: "q", label: "Saldo/mín.", render: (r) => `${r.quantity}/${r.minQty}` }]} />
          </Card>
          <Card title={`Vencendo em ${alerts.windowDays} dias`}>
            <Table rows={alerts.expiringLots} rowKey={(r) => r.lotId + r.warehouseId} empty="Nenhum." columns={[{ key: "p", label: "EPI / lote", render: (r) => `${r.productDescription} · ${r.lotNumber}` }, { key: "v", label: "Validade", render: (r) => fmtDate(r.expiryDate) }, { key: "q", label: "Qtd", render: (r) => r.quantity }]} />
          </Card>
          <Card title="Vencidos com saldo (bloqueados)">
            <Table rows={alerts.expiredLots} rowKey={(r) => r.lotId + r.warehouseId} empty="Nenhum." columns={[{ key: "p", label: "EPI / lote", render: (r) => `${r.productDescription} · ${r.lotNumber}` }, { key: "v", label: "Validade", render: (r) => <span className="text-red-700">{fmtDate(r.expiryDate)}</span> }, { key: "q", label: "Qtd", render: (r) => r.quantity }]} />
          </Card>
        </div>
      )}

      {tab === "minimos" && (
        <Card title="Mínimo / máximo por almoxarifado" actions={can("inventory.adjust") && warehouseId && <Button onClick={() => setLevelOpen(true)}><IconPlus size={18} />Definir</Button>}>
          {!warehouseId && <p className="mb-2 text-sm text-zinc-500">Selecione um almoxarifado para definir níveis.</p>}
          <Table rows={levels} rowKey={(l) => l.id} empty="Nenhum nível definido." columns={[{ key: "p", label: "EPI", render: (l) => l.variant.product.description }, { key: "s", label: "SKU", render: (l) => l.variant.sku }, { key: "mi", label: "Mínimo", render: (l) => l.minQty }, { key: "ma", label: "Máximo", render: (l) => l.maxQty ?? "—" }]} />
        </Card>
      )}

      <Modal open={entry} title="Entrada de estoque" onClose={() => setEntry(false)} wide>
        <EntryForm onDone={refresh} />
      </Modal>
      <Modal open={!!move} title={move?.mode === "transfer" ? "Transferência" : "Ajuste / perda / descarte"} onClose={() => setMove(null)}>
        {move && <MoveForm balance={move.b} mode={move.mode} onDone={refresh} />}
      </Modal>
      <Modal open={levelOpen} title="Definir mínimo / máximo" onClose={() => setLevelOpen(false)}>
        {!level ? (
          <EpiPicker onPick={setLevel} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{level.product.description} — {variantLabel(level.variant)}</p>
            <Field label="Mínimo"><Input type="number" min={0} value={minQty} onChange={(e) => setMinQty(Number(e.target.value))} /></Field>
            <Field label="Máximo"><Input type="number" min={0} value={maxQty} onChange={(e) => setMaxQty(e.target.value)} /></Field>
            <ErrorBox error={saveLevel.error} />
            <div className="flex justify-end"><Button loading={saveLevel.isPending} onClick={() => saveLevel.mutate()}>Salvar</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function StockPage() {
  return (
    <Suspense>
      <StockContent />
    </Suspense>
  );
}
