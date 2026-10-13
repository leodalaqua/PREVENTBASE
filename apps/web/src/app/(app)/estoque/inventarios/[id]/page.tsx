"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, ErrorBox, Input, Loading, PageHeader, StatusBadge, Table, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";

interface Item { id: string; lotId: string; systemQty: number; count1: number | null; count2: number | null; finalQty: number | null; lotNumber?: string; sku?: string; productDescription?: string; locationCode?: string }
interface Count { id: string; status: string; doubleCount: boolean; createdAt: string; startedAt: string | null; notes: string | null; items: Item[] }

export default function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [round, setRound] = useState<1 | 2>(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const { data: c, isLoading, error } = useQuery({ queryKey: ["count", id], queryFn: () => api.get<Count>(`/inventory-counts/${id}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["count", id] });
  const action = useMutation({
    mutationFn: (a: string) => api.post(`/inventory-counts/${id}/${a}`, a === "cancel" ? { reason: "Cancelado pelo usuário" } : {}),
    onSuccess: (_r, a) => {
      refresh();
      void qc.invalidateQueries({ queryKey: ["counts"] });
      toast({ start: "Snapshot gerado — contagem liberada", submit: "Contagem enviada", approve: "Inventário aprovado — ajustes lançados", close: "Inventário fechado", cancel: "Inventário cancelado" }[a] ?? "OK");
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.put(`/inventory-counts/${id}/items`, {
        round,
        items: Object.entries(values).filter(([, v]) => v !== "").map(([itemId, v]) => ({ itemId, quantity: Number(v) })),
      }),
    onSuccess: () => {
      setValues({});
      refresh();
      toast(`Contagem ${round} salva`);
    },
  });

  if (isLoading) return <Loading />;
  if (error || !c) return <ErrorBox error={error} />;
  const counting = ["COUNTING", "DIVERGENT"].includes(c.status) && can("estoque.inventarios.inserir");
  // contagem cega: o sistema só revela o saldo após a contagem ser enviada
  const blind = c.status === "COUNTING";
  const divergent = c.items.filter((i) => i.finalQty !== null && i.finalQty !== i.systemQty);

  return (
    <>
      <PageHeader
        title="Inventário"
        subtitle={<span className="flex items-center gap-2">Aberto em {fmtDateTime(c.createdAt)} <StatusBadge status={c.status} /></span>}
        actions={
          <>
            {c.status === "OPEN" && can("estoque.inventarios.inserir") && <Button loading={action.isPending} onClick={() => action.mutate("start")}>Iniciar (snapshot)</Button>}
            {counting && <Button variant="secondary" loading={action.isPending} onClick={() => action.mutate("submit")}>Enviar contagem</Button>}
            {c.status === "DIVERGENT" && can("estoque.inventarios.atualizar") && <Button loading={action.isPending} onClick={() => action.mutate("approve")}>Aprovar ajustes</Button>}
            {c.status === "APPROVED" && can("estoque.inventarios.atualizar") && <Button loading={action.isPending} onClick={() => action.mutate("close")}>Fechar</Button>}
            {!["CLOSED", "CANCELLED", "APPROVED"].includes(c.status) && can("estoque.inventarios.excluir") && <Button variant="danger" loading={action.isPending} onClick={() => action.mutate("cancel")}>Cancelar</Button>}
          </>
        }
      />
      <ErrorBox error={action.error ?? save.error} />
      {counting && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Rodada:</span>
            <Button variant={round === 1 ? "primary" : "secondary"} onClick={() => setRound(1)}>1ª contagem</Button>
            {c.doubleCount && <Button variant={round === 2 ? "primary" : "secondary"} onClick={() => setRound(2)}>2ª contagem</Button>}
            <Button className="ml-auto" loading={save.isPending} disabled={Object.keys(values).length === 0} onClick={() => save.mutate()}>Salvar contagem</Button>
          </div>
        </Card>
      )}
      {divergent.length > 0 && <p className="mb-2 text-sm text-amber-700">{divergent.length} item(ns) com divergência — aprovação gera movimentos de inventário (+/−).</p>}
      <Card>
        <Table
          rows={c.items}
          rowKey={(i) => i.id}
          empty={c.status === "OPEN" ? "Inicie o inventário para gerar a lista de contagem." : "Sem itens."}
          columns={[
            { key: "p", label: "EPI", render: (i) => <>{i.productDescription}<p className="text-xs text-zinc-500">{i.sku}</p></> },
            { key: "l", label: "Lote", render: (i) => i.lotNumber },
            { key: "loc", label: "Local", render: (i) => i.locationCode },
            { key: "s", label: "Sistema", render: (i) => (blind ? "•••" : i.systemQty) },
            { key: "c1", label: "1ª", render: (i) => (counting && round === 1 ? <Input className="w-20" type="number" min={0} value={values[i.id] ?? i.count1 ?? ""} onChange={(e) => setValues({ ...values, [i.id]: e.target.value })} /> : (i.count1 ?? "—")) },
            ...(c.doubleCount ? [{ key: "c2", label: "2ª", render: (i: Item) => (counting && round === 2 ? <Input className="w-20" type="number" min={0} value={values[i.id] ?? i.count2 ?? ""} onChange={(e) => setValues({ ...values, [i.id]: e.target.value })} /> : (i.count2 ?? "—")) }] : []),
            { key: "f", label: "Final", render: (i) => (i.finalQty === null ? "—" : <span className={i.finalQty !== i.systemQty ? "font-semibold text-amber-700" : ""}>{i.finalQty}</span>) },
          ]}
        />
      </Card>
    </>
  );
}
