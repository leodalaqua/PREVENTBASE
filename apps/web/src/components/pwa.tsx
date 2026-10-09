"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  canInstall: boolean;
  installed: boolean;
  iosHint: boolean;
  install: () => Promise<void>;
}

const PwaContext = createContext<PwaState>({ canInstall: false, installed: false, iosHint: false, install: async () => undefined });

export const usePwa = () => useContext(PwaContext);

export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIosHint(!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent));
    setOnline(navigator.onLine);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("appinstalled", onInstalled);
    addEventListener("online", onOnline);
    addEventListener("offline", onOffline);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const sw = reg.installing;
            sw?.addEventListener("statechange", () => {
              if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
            });
          });
          const check = () => document.visibilityState === "visible" && reg.update().catch(() => undefined);
          document.addEventListener("visibilitychange", check);
        })
        .catch(() => undefined);
    }
    return () => {
      removeEventListener("beforeinstallprompt", onPrompt);
      removeEventListener("appinstalled", onInstalled);
      removeEventListener("online", onOnline);
      removeEventListener("offline", onOffline);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
    setPrompt(null);
  }, [prompt]);

  return (
    <PwaContext.Provider value={{ canInstall: !!prompt && !installed, installed, iosHint, install }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-3 lg:bottom-4">
        {!online && (
          <div className="pointer-events-auto rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">Sem conexão — entregas e biometria ficam indisponíveis até voltar.</div>
        )}
        {waiting && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-zinc-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-lg ring-1 ring-brand-400/50">
            Nova versão disponível
            <button className="min-h-9 rounded-full bg-brand-400 px-3 font-semibold text-zinc-900" onClick={() => waiting.postMessage("SKIP_WAITING")}>
              Atualizar
            </button>
          </div>
        )}
      </div>
    </PwaContext.Provider>
  );
}
