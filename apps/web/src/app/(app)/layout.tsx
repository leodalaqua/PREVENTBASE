"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { BrandMark, BrandSplash, BrandTile, Wordmark } from "@/components/brand";
import { openPasskeys, PasskeyManager } from "@/components/passkey/passkey-ui";
import { usePwa } from "@/components/pwa";
import { cx } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { passkeyApi } from "@/lib/passkey";

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

const TABS = ["/", "/entregas/nova", "/colaboradores", "/estoque"];

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) router.push(`/busca?q=${encodeURIComponent(q.trim())}`);
      }}
      className="min-w-0 flex-1"
    >
      <input
        type="search"
        enterKeyHint="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar colaborador, CPF, EPI, CA, lote…"
        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-400/30"
      />
    </form>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, loading, can, logout } = useAuth();
  const { canInstall, install, iosHint } = usePwa();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      removeEventListener("keydown", onKey);
    };
  }, [open]);
  const { data: alerts } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<unknown[]>("/notifications"), enabled: !!me, refetchInterval: 120_000 });

  if (loading || !me) return <BrandSplash />;
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || (pathname.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && pathname.startsWith(i.href))));
  const tabs = items.filter((i) => TABS.includes(i.href));
  const alertCount = alerts?.length ?? 0;

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-[min(18rem,85vw)] flex-col bg-zinc-900 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-zinc-200 shadow-xl transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:translate-x-0 lg:shadow-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Menu principal"
      >
        <div className="relative bg-[radial-gradient(ellipse_at_top,rgba(251,203,10,0.16),transparent_70%)] px-4 pb-4 pt-5">
          <button className="touch-target absolute right-2 top-2 rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            ✕
          </button>
          <Link href="/" className="flex flex-col items-center gap-2" aria-label="PreventBase — painel">
            <BrandMark className="w-24 drop-shadow-[0_6px_16px_rgba(251,203,10,0.25)]" />
            <Wordmark onDark className="w-48" />
          </Link>
          <p className="mt-2 truncate text-center text-xs font-medium uppercase tracking-wider text-zinc-400">{me.tenant.name}</p>
        </div>
        <div className="mx-4 mb-2 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />
        <nav className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cx("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active(n.href) ? "bg-brand-400 font-semibold text-zinc-900 shadow-sm" : "hover:bg-zinc-800 hover:text-white")}
            >
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
              {n.href === "/alertas" && alertCount > 0 && <span className="ml-auto rounded-full bg-red-600 px-2 text-xs text-white">{alertCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-zinc-800 p-4 text-xs">
          {canInstall && (
            <button onClick={() => void install()} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand-400 px-3 font-semibold text-zinc-900 hover:bg-brand-300">
              ⤓ Instalar aplicativo
            </button>
          )}
          {iosHint && <p className="text-zinc-400">No iPhone: Compartilhar → “Adicionar à Tela de Início”.</p>}
          <p className="truncate text-zinc-300">{me.name}</p>
          <p className="truncate text-zinc-500">{me.roles.map((r) => r.role.name).join(", ")}</p>
          <div className="flex gap-4">
            <Link href="/conta" className="py-1 text-brand-300 hover:underline">
              Minha conta
            </Link>
            <button onClick={openPasskeys} className="py-1 text-brand-300 hover:underline">
              Login biometria
            </button>
            <button onClick={() => void logout()} className="py-1 text-zinc-400 hover:text-white">
              Sair
            </button>
          </div>
        </div>
      </aside>
      <div
        className={cx("fixed inset-0 z-30 bg-zinc-900/40 transition-opacity duration-200 lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b-2 border-brand-400 bg-white/90 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur sm:px-4">
          <button className="touch-target rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}>
            ☰
          </button>
          <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="PreventBase — painel">
            <BrandTile className="h-10 w-10" />
            <Wordmark className="hidden w-32 sm:block" />
          </Link>
          <SearchBox />
          <Link href="/alertas" className="touch-target relative flex items-center justify-center rounded-lg p-2 text-zinc-600 hover:bg-zinc-100" aria-label={`Alertas (${alertCount})`}>
            🔔
            {alertCount > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 text-white">{alertCount > 99 ? "99+" : alertCount}</span>}
          </Link>
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
        <main key={pathname} className="page-enter mx-auto max-w-7xl px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 lg:pb-10">
          {children}
        </main>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
        aria-label="Navegação rápida"
      >
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined} className={cx("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]", active(t.href) ? "font-semibold text-zinc-900" : "text-zinc-500")}>
            {active(t.href) && <span className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-brand-400" />}
            <span className="text-lg leading-none">{t.icon}</span>
            {t.href === "/entregas/nova" ? "Entregar" : t.label}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-zinc-500">
          <span className="text-lg leading-none">☰</span>
          Menu
        </button>
      </nav>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
      <PasskeyManager api={passkeyApi} />
    </AuthProvider>
  );
}
