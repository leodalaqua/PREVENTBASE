"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WarehouseSelect } from "@/components/pickers";
import { Button, Card, ErrorBox, Field, Modal, PageHeader, StatusBadge, Table, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useWarehouses } from "@/lib/hooks";

interface Count { id: string; warehouseId: string; status: string; doubleCount: boolean; createdAt: string; startedAt: string | null; closedAt: string | null; _count: { items: number } }

export default function CountsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: whs } = useWarehouses();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [doubleCount, setDouble] = useState(false);
  const [notes, setNotes] = useState("");
  const { data } = useQuery({ queryKey: ["counts"], queryFn: () => api.get<Count[]>("/inventory-counts") });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>("/inventory-counts", { warehouseId, doubleCount, notes: notes || null }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["counts"] });
      router.push(`/estoque/inventarios/${c.id}`);
    },
  });
  const wname = (id: string) => whs?.find((w) => w.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader title="Inventários" subtitle="Contagem cega com snapshot, dupla contagem opcional e aprovação" actions={can("inventory.count") && <Button onClick={() => setOpen(true)}>＋ Abrir inventário</Button>} />
      <Card>
        <Table
          rows={data}
          rowKey={(c) => c.id}
          onRow={(c) => router.push(`/estoque/inventarios/${c.id}`)}
          empty="Nenhum inventário."
          columns={[
            { key: "d", label: "Aberto em", render: (c) => fmtDateTime(c.createdAt) },
            { key: "w", label: "Almoxarifado", render: (c) => wname(c.warehouseId) },
            { key: "i", label: "Itens", render: (c) => c._count.items },
            { key: "dc", label: "Dupla contagem", render: (c) => (c.doubleCount ? "Sim" : "Não") },
            { key: "s", label: "Situação", render: (c) => <StatusBadge status={c.status} /> },
          ]}
        />
      </Card>
      <Modal open={open} title="Abrir inventário" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <Field label="Almoxarifado"><WarehouseSelect value={warehouseId} onChange={setWarehouseId} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={doubleCount} onChange={(e) => setDouble(e.target.checked)} /> Dupla contagem (2º contador diferente)</label>
          <Field label="Observações"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <ErrorBox error={create.error} />
          <div className="flex justify-end"><Button disabled={!warehouseId} loading={create.isPending} onClick={() => create.mutate()}>Abrir</Button></div>
        </div>
      </Modal>
    </>
  );
}
