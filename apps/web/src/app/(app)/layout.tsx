"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentType, type ReactNode, type SVGProps, useEffect, useState } from "react";
import { BrandMark, BrandSplash, BrandTile, Wordmark } from "@/components/brand";
import {
  IconBell,
  IconBox,
  IconChart,
  IconClipboardCheck,
  IconClose,
  IconDashboard,
  IconDelivery,
  IconDownload,
  IconHardHat,
  IconHash,
  IconMenu,
  IconPlus,
  IconReturn,
  IconScale,
  IconSliders,
  IconUser,
} from "@/components/icons";
import type { ChaveAcesso } from "@preventbase/permissions";
import { usePwa } from "@/components/pwa";
import { cx } from "@/components/ui";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** Telas = submódulos do catálogo da central (C:\ROBBY\config\acessos-catalogo\preventbase.json). */
const NAV: Array<{ href: string; label: string; perm?: ChaveAcesso[]; icon: NavIcon }> = [
  { href: "/", label: "Painel", icon: IconDashboard },
  { href: "/entregas/nova", label: "Nova entrega", perm: ["entregas.entregas.inserir"], icon: IconPlus },
  { href: "/colaboradores", label: "Colaboradores", perm: ["colaboradores.cadastro.visualizar"], icon: IconUser },
  { href: "/entregas", label: "Entregas", perm: ["entregas.entregas.visualizar"], icon: IconDelivery },
  { href: "/devolucoes", label: "Devoluções", perm: ["entregas.devolucoes.visualizar"], icon: IconReturn },
  { href: "/epis", label: "EPIs", perm: ["epi.catalogo.visualizar"], icon: IconHardHat },
  { href: "/ca", label: "Consulta CA", perm: ["epi.ca.visualizar", "epi.integracao_caepi.visualizar"], icon: IconHash },
  { href: "/estoque", label: "Estoque", perm: ["estoque.saldos.visualizar"], icon: IconBox },
  { href: "/estoque/inventarios", label: "Inventários", perm: ["estoque.inventarios.visualizar"], icon: IconClipboardCheck },
  { href: "/relatorios", label: "Relatórios", perm: ["relatorios.relatorios.visualizar"], icon: IconChart },
  { href: "/alertas", label: "Alertas", perm: ["inicio.painel.visualizar"], icon: IconBell },
  { href: "/auditoria", label: "Auditoria", perm: ["relatorios.auditoria.visualizar"], icon: IconScale },
  {
    href: "/admin",
    label: "Administração",
    perm: [
      "administracao.organizacao.visualizar",
      "administracao.funcoes_epi.visualizar",
      "administracao.almoxarifados.visualizar",
      "administracao.dispositivos.visualizar",
      "administracao.parametros.visualizar",
      "administracao.lgpd.visualizar",
    ],
    icon: IconSliders,
  },
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
        aria-label="Buscar"
        className="min-h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-zinc-500 focus:border-brand-700 focus:bg-white focus:ring-3 focus:ring-brand-400/40"
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
  const alertsOn = !!me && can("inicio.painel.visualizar");
  const { data: alerts } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<unknown[]>("/notifications"), enabled: alertsOn, refetchInterval: 120_000 });

  if (loading || !me) return <BrandSplash />;
  const items = NAV.filter((n) => !n.perm || can(...n.perm));
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || (pathname.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && pathname.startsWith(i.href))));
  const tabs = items.filter((i) => TABS.includes(i.href));
  const alertCount = alerts?.length ?? 0;

  return (
    <div className="has-bottom-nav min-h-dvh lg:flex">
      <aside
        className={cx(
          "on-dark fixed inset-y-0 left-0 z-40 flex w-[min(18rem,85vw)] flex-col bg-zinc-900 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] text-zinc-200 shadow-xl transition-[translate,visibility] duration-(--motion-drawer) ease-drawer motion-reduce:transition-none lg:visible lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:translate-x-0 lg:shadow-none",
          open ? "visible translate-x-0" : "invisible -translate-x-full",
        )}
        aria-label="Menu principal"
      >
        <div className="relative bg-[radial-gradient(ellipse_at_top,rgba(251,203,10,0.16),transparent_70%)] px-4 pb-4 pt-5">
          <button className="touch-target absolute right-2 top-2 inline-flex items-center justify-center rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <IconClose />
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
              className={cx(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                active(n.href) ? "bg-brand-400 font-semibold text-zinc-900 shadow-sm" : "text-zinc-300 hover:bg-zinc-800 hover:text-white active:bg-zinc-700",
              )}
            >
              <n.icon size={18} className={active(n.href) ? "text-zinc-900" : "text-zinc-400"} />
              {n.label}
              {n.href === "/alertas" && alertCount > 0 && <span className="tabular ml-auto rounded-full bg-red-600 px-2 text-xs font-medium text-white">{alertCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-zinc-800 p-4 text-xs">
          {canInstall && (
            <button onClick={() => void install()} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand-400 px-3 font-semibold text-zinc-900 transition-colors hover:bg-brand-300">
              <IconDownload size={16} />
              Instalar aplicativo
            </button>
          )}
          {iosHint && <p className="text-zinc-400">No iPhone: Compartilhar → “Adicionar à Tela de Início”.</p>}
          <p className="truncate text-sm font-medium text-zinc-200">{me.name}</p>
          <p className="truncate text-zinc-400">{me.isAdmin ? "Administrador · login único Veritech" : me.email}</p>
          <div className="flex flex-wrap gap-x-4">
            <Link href="/conta" className="touch-target inline-flex items-center py-1 text-brand-300 underline-offset-2 hover:underline">
              Minha conta
            </Link>
            <button onClick={() => void logout()} className="py-1 text-zinc-400 transition-colors hover:text-white">
              Sair
            </button>
          </div>
        </div>
      </aside>
      <div
        className={cx("fixed inset-0 z-30 bg-zinc-900/40 transition-opacity duration-(--motion-drawer) lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b-2 border-brand-400 bg-white/90 pb-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))]">
          <button className="touch-target inline-flex items-center justify-center rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}>
            <IconMenu size={22} />
          </button>
          <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="PreventBase — painel">
            <BrandTile className="h-10 w-10" />
            <Wordmark className="hidden w-32 sm:block" />
          </Link>
          {can("inicio.busca.visualizar") ? <SearchBox /> : <div className="flex-1" />}
          {alertsOn && <Link href="/alertas" className="touch-target relative flex shrink-0 items-center justify-center rounded-lg p-2 text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200" aria-label={`Alertas (${alertCount})`}>
            <IconBell size={22} />
            {alertCount > 0 && <span className="tabular absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white ring-2 ring-white">{alertCount > 99 ? "99+" : alertCount}</span>}
          </Link>}
        </header>
        {me.device?.status !== "TRUSTED" && (
          <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
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
        <main key={pathname} className="page-enter mx-auto max-w-7xl pb-[calc(6rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-4 sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))] lg:px-6 lg:pb-10 lg:pt-6">
          {children}
        </main>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
        aria-label="Navegação rápida"
      >
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active(t.href) ? "page" : undefined}
            className={cx("relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-none transition-colors active:bg-zinc-100", active(t.href) ? "font-semibold text-zinc-900" : "text-zinc-600")}
          >
            {active(t.href) && <span className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-brand-400" />}
            <t.icon size={22} className={active(t.href) ? "text-zinc-900" : "text-zinc-500"} />
            <span className="max-w-full truncate tracking-tight">{t.href === "/entregas/nova" ? "Entregar" : t.label}</span>
          </Link>
        ))}
        <button onClick={() => setOpen(true)} aria-expanded={open} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[11px] leading-none text-zinc-600 transition-colors active:bg-zinc-100">
          <IconMenu size={22} className="text-zinc-500" />
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
    </AuthProvider>
  );
}
