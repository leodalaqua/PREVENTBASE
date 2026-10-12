"use client";

import Link from "next/link";
import {
  type ButtonHTMLAttributes,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ApiError } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import { IconAlert, IconCheck, IconClose, IconError } from "./icons";

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-400 text-zinc-900 shadow-sm hover:bg-brand-500 active:bg-brand-500 disabled:bg-brand-400/50 disabled:text-zinc-900/60 disabled:shadow-none",
  secondary: "bg-white text-zinc-800 border border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-600/50",
  ghost: "text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50",
};
const btnBase =
  "inline-flex min-h-10 select-none items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 motion-reduce:transition-colors motion-reduce:active:scale-100";

export function Button({ variant = "primary", loading, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} className={cx(btnBase, VARIANTS[variant], className)}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx(btnBase, VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

const inputCls =
  "w-full min-h-10 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-500 hover:border-zinc-400 focus:border-brand-700 focus:ring-3 focus:ring-brand-400/40 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 aria-invalid:border-red-600 aria-invalid:focus:ring-red-500/25";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputCls, props.className)}>
      {children}
    </select>
  );
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, props.className)} />;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="block text-xs font-medium uppercase tracking-wide text-zinc-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-600">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-zinc-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <h2 className="break-any min-w-0 text-sm font-semibold text-zinc-800">{title}</h2>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="break-any border-l-4 border-brand-400 pl-3 font-semibold leading-tight tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="break-any mt-1 pl-4 text-sm text-zinc-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  slate: "bg-zinc-100 text-zinc-700",
  blue: "bg-sky-100 text-sky-800",
};
const STATUS_COLOR: Record<string, keyof typeof BADGE> = {
  ACTIVE: "green",
  OK: "green",
  TRUSTED: "green",
  APPROVED: "green",
  CLOSED: "slate",
  CANCELLED: "red",
  BLOCKED: "red",
  OVERDUE: "red",
  TERMINATED: "slate",
  MISSING: "amber",
  PENDING: "amber",
  DIVERGENT: "amber",
  ON_LEAVE: "blue",
  COUNTING: "blue",
  OPEN: "blue",
  CRITICAL: "red",
  WARNING: "amber",
  INFO: "blue",
};

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: keyof typeof BADGE }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", BADGE[color])}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLOR[status] ?? "slate"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden="true" className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-[spin_1.6s_linear_infinite]", small ? "h-4 w-4" : "h-6 w-6 text-brand-600")} />;
}

export function Loading() {
  return (
    <div className="space-y-3 py-2" role="status" aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <div className="skeleton h-7 w-48 max-w-full" />
      <div className="skeleton h-24" />
      <div className="skeleton h-40" />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
      <IconError size={18} className="mt-px text-red-600" />
      <span className="break-any min-w-0">{msg}</span>
    </div>
  );
}

export function Notice({ tone, children, className }: { tone: "ok" | "warn" | "error"; children: ReactNode; className?: string }) {
  const Icon = tone === "ok" ? IconCheck : tone === "warn" ? IconAlert : IconError;
  const color = { ok: "text-emerald-800", warn: "text-amber-800", error: "text-red-800" }[tone];
  const iconColor = { ok: "text-emerald-600", warn: "text-amber-600", error: "text-red-600" }[tone];
  return (
    <p className={cx("flex items-start gap-2 text-sm", color, className)}>
      <Icon size={18} className={cx("mt-px", iconColor)} />
      <span className="break-any min-w-0">{children}</span>
    </p>
  );
}

export function Empty({ children = "Nenhum registro." }: { children?: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-zinc-500">{children}</p>;
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, onRow, empty }: { columns: Column<T>[]; rows: T[] | undefined; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: string }) {
  if (!rows)
    return (
      <div className="space-y-2 py-2" role="status" aria-busy="true">
        <span className="sr-only">Carregando…</span>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-9" />
        ))}
      </div>
    );
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-600">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-2 font-medium", c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={
                onRow
                  ? (e) => {
                      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                        e.preventDefault();
                        onRow(r);
                      }
                    }
                  : undefined
              }
              tabIndex={onRow ? 0 : undefined}
              className={cx("border-b border-zinc-100 transition-colors duration-100 last:border-0", onRow && "cursor-pointer hover:bg-zinc-50 focus-visible:bg-brand-50 focus-visible:outline-offset-[-2px] active:bg-zinc-100")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx("px-4 py-2 align-top", c.className)}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="pt-3 text-xs text-zinc-500">{total} registro(s)</p>;
  return (
    <div className="tabular flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-zinc-600">
      <span>{total} registro(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <span aria-live="polite">
          {page}/{pages}
        </span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop-enter fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("sheet-enter max-h-[calc(100dvh-env(safe-area-inset-top))] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(24,24,27,0.18)] sm:max-h-[90dvh] sm:rounded-2xl sm:shadow-xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-100 bg-white px-4 py-3">
          <h3 className="min-w-0 font-semibold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="touch-target -mr-1 inline-flex items-center justify-center rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800" aria-label="Fechar">
            <IconClose />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto overscroll-x-contain border-b border-zinc-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors", value === t.id ? "border-brand-400 font-semibold text-zinc-900" : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone = "slate", href }: { label: string; value: ReactNode; tone?: "slate" | "red" | "amber" | "green"; href?: string }) {
  const color = { slate: "text-zinc-900", red: "text-red-700", amber: "text-amber-700", green: "text-emerald-700" }[tone];
  const body = (
    <div className={cx("h-full rounded-xl border border-zinc-200 bg-white p-4 shadow-sm", href && "transition-[border-color,box-shadow] duration-150 group-hover:border-zinc-300 group-hover:shadow-md")}>
      <p className="text-xs uppercase leading-snug tracking-wide text-zinc-600">{label}</p>
      <p className={cx("tabular mt-1 text-2xl font-semibold tracking-tight", color)}>{value ?? "—"}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="group block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}
const ToastCtx = createContext<(text: string, tone?: "ok" | "error") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-4" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("sheet-enter pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg", t.tone === "ok" ? "bg-zinc-900" : "bg-red-700")}>
            {t.tone === "ok" ? <IconCheck size={18} className="mt-px text-brand-400" /> : <IconError size={18} className="mt-px text-white" />}
            <span className="break-any min-w-0">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
