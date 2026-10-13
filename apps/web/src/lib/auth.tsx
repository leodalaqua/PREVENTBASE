"use client";

import { type ChaveAcesso, type Permissoes, pode } from "@preventbase/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, clearTokens, hasSession, onSessionLost } from "./api";
import { ssoConfig, ssoLogoutUrl } from "./sso";

export interface Me {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
  tenant: { id: string; name: string; settings: Record<string, unknown> };
  /** Acesso decidido só pela central Veritech (login único). */
  isAdmin: boolean;
  permissoes: Permissoes;
  device: { id: string; status: "PENDING" | "TRUSTED" | "BLOCKED" } | null;
}

interface AuthCtx {
  me: Me | undefined;
  loading: boolean;
  /** Helper único de menus/botões: isAdmin ou qualquer uma das chaves `modulo.submodulo.acao`. */
  can: (...chaves: ChaveAcesso[]) => boolean;
  logout: () => Promise<void>;
  reload: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    if (!hasSession()) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    return onSessionLost(() => {
      clearTokens();
      qc.clear();
      router.replace("/login");
    });
  }, [router, pathname, qc]);

  const { data: me, isLoading, refetch } = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me"), enabled: ready && hasSession(), staleTime: 60_000 });

  const can = useCallback((...chaves: ChaveAcesso[]) => pode(me, ...chaves), [me]);
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    clearTokens();
    qc.clear();
    const sso = await ssoConfig().catch(() => null);
    if (sso) location.assign(ssoLogoutUrl(sso));
    else router.replace("/login");
  }, [qc, router]);

  return <Ctx.Provider value={{ me, loading: !ready || isLoading, can, logout, reload: () => void refetch() }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider ausente");
  return c;
}
