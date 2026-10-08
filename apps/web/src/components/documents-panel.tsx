"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { api, openFile, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Button, ErrorBox, Field, Input, Table, useToast } from "./ui";

interface Doc {
  id: string;
  title: string;
  category: string;
  isEvidence: boolean;
  createdAt: string;
  versions: Array<{ version: number; filename: string; mimeType: string; size: number; sha256: string; uploadedAt: string }>;
}

export function DocumentsPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["documents", entityType, entityId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<Doc[]>(`/documents${qs({ entityType, entityId })}`), enabled: can("documents.view") });
  const file = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("GERAL");
  const [versionOf, setVersionOf] = useState<string | null>(null);
  const versionFile = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const f = file.current?.files?.[0];
      if (!f) throw new Error("Selecione um arquivo");
      const form = new FormData();
      form.set("file", f);
      form.set("entityType", entityType);
      form.set("entityId", entityId);
      form.set("title", title || f.name);
      form.set("category", category || "GERAL");
      return api.upload("/documents", form);
    },
    onSuccess: () => {
      setTitle("");
      if (file.current) file.current.value = "";
      void qc.invalidateQueries({ queryKey: key });
      toast("Documento enviado");
    },
  });

  const newVersion = useMutation({
    mutationFn: async ({ id, f }: { id: string; f: File }) => {
      const form = new FormData();
      form.set("file", f);
      return api.upload(`/documents/${id}/versions`, form);
    },
    onSuccess: () => {
      setVersionOf(null);
      void qc.invalidateQueries({ queryKey: key });
      toast("Nova versão registrada (a anterior foi preservada)");
    },
  });

  if (!can("documents.view")) return <p className="text-sm text-slate-500">Sem permissão para documentos.</p>;

  return (
    <div className="space-y-4">
      {can("documents.upload") && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            upload.mutate();
          }}
          className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-4"
        >
          <Field label="Arquivo" className="sm:col-span-2">
            <input ref={file} type="file" required className="block w-full text-sm" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv,.txt,.zip,.xml,.mp4" />
          </Field>
          <Field label="Título">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Categoria">
            <Input value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} />
          </Field>
          <div className="sm:col-span-4">
            <ErrorBox error={upload.error ?? newVersion.error} />
          </div>
          <div className="flex justify-end sm:col-span-4">
            <Button type="submit" loading={upload.isPending}>Enviar</Button>
          </div>
        </form>
      )}
      <input
        ref={versionFile}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && versionOf) newVersion.mutate({ id: versionOf, f });
          e.target.value = "";
        }}
      />
      <Table
        rows={data}
        rowKey={(d) => d.id}
        empty="Nenhum documento."
        columns={[
          { key: "t", label: "Documento", render: (d) => <span className="font-medium">{d.title}</span> },
          { key: "c", label: "Categoria", render: (d) => d.category },
          { key: "v", label: "Versão", render: (d) => `v${d.versions[0]?.version ?? 1}` },
          { key: "u", label: "Enviado em", render: (d) => fmtDateTime(d.versions[0]?.uploadedAt ?? d.createdAt) },
          { key: "h", label: "SHA-256", render: (d) => <span className="font-mono text-xs">{d.versions[0]?.sha256.slice(0, 12)}…</span> },
          {
            key: "a",
            label: "",
            render: (d) => (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void openFile(`/documents/${d.id}/versions/${d.versions[0]?.version ?? 1}/download`)}>Abrir</Button>
                {can("documents.upload") && (
                  <Button
                    variant="ghost"
                    loading={newVersion.isPending && versionOf === d.id}
                    onClick={() => {
                      setVersionOf(d.id);
                      versionFile.current?.click();
                    }}
                  >
                    Nova versão
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
