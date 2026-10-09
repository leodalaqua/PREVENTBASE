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

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-400 text-zinc-900 shadow-sm hover:bg-brand-500 disabled:bg-brand-400/50 disabled:text-zinc-900/60",
  secondary: "bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
  ghost: "text-zinc-700 hover:bg-zinc-100 disabled:opacity-50",
};

export function Button({ variant = "primary", loading, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed", VARIANTS[variant], className)}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition", VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-400/30 disabled:bg-zinc-100";

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
    <label className={cx("block space-y-1", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-zinc-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="border-l-4 border-brand-400 pl-3 text-xl font-semibold text-zinc-900">{title}</h1>
        {subtitle && <p className="pl-4 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
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
  return <span className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", small ? "h-4 w-4" : "h-6 w-6 text-brand-500")} />;
}

export function Loading() {
  return (
    <div className="flex justify-center p-10">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</div>;
}

export function Empty({ children = "Nenhum registro." }: { children?: ReactNode }) {
  return <p className="p-6 text-center text-sm text-zinc-500">{children}</p>;
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
      <div className="space-y-2 py-2" aria-busy="true">
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
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
            {columns.map((c) => (
              <th key={c.key} className={cx("whitespace-nowrap px-4 py-2 font-medium", c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={cx("border-b border-zinc-100 last:border-0", onRow && "cursor-pointer hover:bg-zinc-50")}>
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
    <div className="flex items-center justify-between pt-3 text-xs text-zinc-500">
      <span>{total} registro(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <span>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("page-enter max-h-dvh w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[90dvh] sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="touch-target rounded-lg p-2 text-zinc-500 hover:bg-zinc-100" aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", value === t.id ? "border-brand-400 font-semibold text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800")}
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
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:shadow">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold", color)}>{value ?? "—"}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
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
      <div className="fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={cx("rounded-lg px-4 py-2 text-sm text-white shadow-lg", t.tone === "ok" ? "border-l-4 border-brand-400 bg-zinc-900" : "bg-red-700")}>
            {t.text}
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
