"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, qs } from "@/lib/api";
import { companyName, type EpiProduct, type Paged, useCompanies, useEpis, type Variant, variantLabel, useWarehouses } from "@/lib/hooks";
import { maskCpf } from "@/lib/format";
import { IconScan } from "./icons";
import { Button, Input, Select, StatusBadge } from "./ui";

export function CompanySelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const { data } = useCompanies();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowAll ? "Todas as empresas" : "Selecione…"}</option>
      {data?.map((c) => (
        <option key={c.id} value={c.id}>
          {companyName(c)}
        </option>
      ))}
    </Select>
  );
}

export function WarehouseSelect({ value, onChange, allowAll, companyId }: { value: string; onChange: (v: string) => void; allowAll?: boolean; companyId?: string }) {
  const { data } = useWarehouses();
  const list = data?.filter((w) => !companyId || w.companyId === companyId);
  useEffect(() => {
    if (!allowAll && !value && list && list.length === 1) onChange(list[0]!.id);
  }, [allowAll, value, list, onChange]);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowAll ? "Todos os almoxarifados" : "Selecione…"}</option>
      {list?.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name} ({w.code})
        </option>
      ))}
    </Select>
  );
}

export interface EmployeeLite {
  id: string;
  name: string;
  cpf: string;
  registration: string | null;
  status: string;
  companyId: string;
  job: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  company: { legalName: string; tradeName: string | null };
}

export function EmployeePicker({ onPick }: { onPick: (e: EmployeeLite) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["employees-pick", term],
    queryFn: () => api.get<Paged<EmployeeLite>>(`/employees${qs({ q: term, status: "ACTIVE", pageSize: 15 })}`),
    enabled: term.length >= 2,
  });
  return (
    <div className="space-y-2">
      <Input type="search" enterKeyHint="search" autoFocus placeholder="Nome, matrícula ou CPF" aria-label="Buscar colaborador" value={q} onChange={(e) => setQ(e.target.value)} />
      {isFetching && (
        <p className="text-xs text-zinc-600" role="status">
          Buscando…
        </p>
      )}
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white empty:hidden">
        {data?.items.map((e) => (
          <li key={e.id}>
            <button className="flex min-h-14 w-full items-center justify-between gap-2 px-3 py-3 text-left transition-colors duration-100 hover:bg-zinc-50 active:bg-brand-50" onClick={() => onPick(e)}>
              <span className="min-w-0">
                <span className="break-any block font-medium text-zinc-900">{e.name}</span>
                <span className="break-any text-xs text-zinc-600">
                  {e.registration ?? "s/ matrícula"} · {maskCpf(e.cpf)} · {e.job?.name ?? "sem função"} · {companyName(e.company)}
                </span>
              </span>
              <StatusBadge status={e.status} />
            </button>
          </li>
        ))}
      </ul>
      {term.length >= 2 && data?.items.length === 0 && <p className="text-sm text-zinc-500">Nenhum colaborador ativo encontrado.</p>}
    </div>
  );
}

/** Leitor de código (EAN da variação ou QR do lote). Usa BarcodeDetector quando disponível; leitores USB digitam no campo. */
export function ScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (!video.current) return;
      video.current.srcObject = stream;
      await video.current.play();
      // @ts-expect-error BarcodeDetector ainda não está no lib.dom
      const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "qr_code"] });
      while (!stop) {
        const codes = (await detector.detect(video.current).catch(() => [])) as Array<{ rawValue: string }>;
        if (codes[0]?.rawValue) {
          onCode(codes[0].rawValue);
          setOpen(false);
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    })().catch(() => setOpen(false));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onCode]);

  if (!supported) return null;
  return (
    <>
      <Button type="button" variant="secondary" className="shrink-0" onClick={() => setOpen(true)} title="Ler código de barras / QR">
        <IconScan size={18} />
        Ler
      </Button>
      {open && (
        <div className="backdrop-enter fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" onClick={() => setOpen(false)}>
          <video ref={video} playsInline muted className="max-h-[70dvh] w-full max-w-md rounded-lg" />
          <p className="mt-3 max-w-md text-center text-sm text-white">Aponte para o código de barras ou QR do lote. Toque para cancelar.</p>
        </div>
      )}
    </>
  );
}

export interface PickedVariant {
  product: EpiProduct;
  variant: Variant;
  lotId?: string;
}

export function EpiPicker({ onPick }: { onPick: (p: PickedVariant) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [product, setProduct] = useState<EpiProduct | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useEpis(term);

  async function scan(code: string) {
    setError("");
    try {
      const r = await api.get<{ kind: string; product: EpiProduct; variant: Variant; lot?: { id: string } }>(`/scan/${encodeURIComponent(code)}`);
      const full = await api.get<EpiProduct>(`/epis/${r.product.id}`);
      onPick({ product: full, variant: r.variant, lotId: r.lot?.id });
    } catch {
      setError(`Código ${code} não encontrado`);
    }
  }

  if (product) {
    return (
      <div className="space-y-2">
        <p className="break-any text-sm font-medium text-zinc-900">{product.description}</p>
        <div className="flex flex-wrap gap-2">
          {product.variants.filter((v) => v.active).map((v) => (
            <Button key={v.id} variant="secondary" onClick={() => onPick({ product, variant: v })}>
              {variantLabel(v)}
            </Button>
          ))}
        </div>
        <button className="min-h-8 text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900" onClick={() => setProduct(null)}>
          trocar EPI
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Descrição, código, CA ou EAN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && /^\d{8,14}$|^L[0-9A-F]{12}$/.test(q.trim())) {
              e.preventDefault();
              void scan(q.trim());
            }
          }}
        />
        <ScanButton onCode={(c) => void scan(c)} />
      </div>
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      <ul className="max-h-[min(16rem,50dvh)] divide-y divide-zinc-100 overflow-y-auto overscroll-contain rounded-lg border border-zinc-200 bg-white empty:hidden">
        {data?.items.map((p) => (
          <li key={p.id}>
            <button
              className="min-h-12 w-full px-3 py-2.5 text-left text-sm transition-colors duration-100 hover:bg-zinc-50 active:bg-brand-50"
              onClick={() => {
                const active = p.variants.filter((v) => v.active);
                if (active.length === 1) onPick({ product: p, variant: active[0]! });
                else setProduct(p);
              }}
            >
              <span className="break-any font-medium text-zinc-900">{p.description}</span>
              <span className="block text-xs text-zinc-600">
                {p.internalCode} · CA {p.cas[0]?.caNumber ?? "—"} · {p.variants.length} variação(ões)
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
