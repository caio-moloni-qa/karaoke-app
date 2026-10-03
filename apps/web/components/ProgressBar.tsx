export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-xs text-zinc-500">{label}</p>}
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${clamped}%` }} />
        </div>
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted">{clamped}%</span>
      </div>
    </div>
  );
}
