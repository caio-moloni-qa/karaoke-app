export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-xs text-zinc-500">{label}</p>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-foreground transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
