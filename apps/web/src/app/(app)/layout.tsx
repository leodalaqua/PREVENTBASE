"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { cx, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";

const NAV: Array<{ href: string; label: string; perm?: string; icon: string }> = [
  { href: "/", label: "Painel", icon: "▦" },
  { href: "/entregas/nova", label: "Nova entrega", perm: "epi.deliver", icon: "＋" },
  { href: "/colaboradores", label: "Colaboradores", perm: "employee.view", icon: "👤" },
  { href: "/entregas", label: "Entregas", perm: "epi.view", icon: "✔" },
  { href: "/devolucoes", label: "Devoluções", perm: "epi.view", icon: "↩" },
  { href: "/epis", label: "EPIs", perm: "epi.view", icon: "⛑" },
  { href: "/ca", label: "Consulta CA", perm: "ca.view", icon: "#" },
  { href: "/estoque", label: "Estoque", perm: "inventory.view", icon: "▤" },
  { href: "/estoque/inventarios", label: "Inventários", perm: "inventory.view", icon: "☑" },
  { href: "/relatorios", label: "Relatórios", perm: "reports.view", icon: "▥" },
  { href: "/alertas", label: "Alertas", icon: "!" },
  { href: "/auditoria", label: "Auditoria", perm: "audit.view", icon: "⚖" },
  { href: "/admin", label: "Administração", perm: "organization.view", icon: "⚙" },
];

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) router.push(`/busca?q=${encodeURIComponent(q.trim())}`);
      }}
      className="flex-1"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar colaborador, CPF, EPI, CA, lote…"
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:bg-white"
      />
    </form>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, loading, can, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const { data: alerts } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<unknown[]>("/notifications"), enabled: !!me, refetchInterval: 120_000 });

  if (loading || !me) return <Loading />;
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || (pathname.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && pathname.startsWith(i.href))));

  return (
    <div className="min-h-screen lg:flex">
      <aside className={cx("fixed inset-y-0 left-0 z-40 w-64 transform bg-slate-900 text-slate-200 transition lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-2 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div>
            <p className="font-semibold text-white">PreventBase</p>
            <p className="text-xs text-slate-400">{me.tenant.name}</p>
          </div>
        </div>
        <nav className="space-y-0.5 px-2">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", active(n.href) ? "bg-teal-700 text-white" : "hover:bg-slate-800")}>
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
              {n.href === "/alertas" && alerts && alerts.length > 0 && <span className="ml-auto rounded-full bg-red-600 px-2 text-xs text-white">{alerts.length}</span>}
            </Link>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-slate-800 p-4 text-xs">
          <p className="truncate text-slate-300">{me.name}</p>
          <p className="truncate text-slate-500">{me.roles.map((r) => r.role.name).join(", ")}</p>
          <div className="mt-2 flex gap-3">
            <Link href="/conta" className="text-teal-400 hover:underline">
              Minha conta
            </Link>
            <button onClick={() => void logout()} className="text-slate-400 hover:text-white">
              Sair
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <button className="rounded p-2 text-slate-600 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <SearchBox />
        </header>
        {me.device?.status !== "TRUSTED" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {me.device?.status === "BLOCKED"
              ? "Este dispositivo está bloqueado."
              : me.device
                ? "Este dispositivo aguarda aprovação do administrador para registrar entregas e biometria."
                : "Este dispositivo não está registrado — entregas e biometria exigem dispositivo autorizado."}{" "}
            <Link href="/dispositivo" className="font-medium underline">
              {me.device ? "Ver status" : "Registrar dispositivo"}
            </Link>
          </div>
        )}
        <main className="mx-auto max-w-7xl p-4 pb-24">{children}</main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
