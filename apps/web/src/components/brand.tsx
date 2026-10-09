/* eslint-disable @next/next/no-img-element */
const cx = (...c: Array<string | undefined>) => c.filter(Boolean).join(" ");

// O símbolo foi recortado de um fundo preto: os contornos internos são transparentes, então ele só
// deve ser exibido sobre superfície escura (use BrandTile sobre fundo claro).
export function BrandMark({ className }: { className?: string }) {
  return <img src="/brand/mark.png" alt="" width={249} height={211} className={cx("h-auto select-none", className)} draggable={false} />;
}

export function BrandTile({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-xl bg-zinc-900 p-1 shadow-sm ring-1 ring-brand-400/40", className)}>
      <BrandMark className="w-full" />
    </span>
  );
}

export function BrandSplash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-900 bg-[radial-gradient(ellipse_at_center,rgba(251,203,10,0.14),transparent_60%)]" role="status" aria-label="Carregando">
      <BrandMark className="w-28 animate-pulse" />
      <Wordmark onDark className="w-48" />
    </div>
  );
}

export function Wordmark({ onDark, className }: { onDark?: boolean; className?: string }) {
  return <img src={onDark ? "/brand/wordmark.png" : "/brand/wordmark-dark.png"} alt="PreventBase" width={443} height={70} className={cx("h-auto select-none", className)} draggable={false} />;
}
