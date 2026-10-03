"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Cpu, Music2, Trash2 } from "lucide-react";
import type { ProcessingJob, Song } from "@/lib/types";
import { STALE_JOB_AFTER_MS } from "@/lib/processing";
import { ProgressBar } from "@/components/ProgressBar";
import { Button } from "@/components/Button";

export type ProcessingJobRow = Pick<
  ProcessingJob,
  "id" | "status" | "stage_label" | "progress_pct" | "error_message" | "created_at" | "updated_at" | "started_at"
> & {
  songs: Pick<Song, "title" | "artist_guess" | "thumbnail_url"> | null;
};

interface ProcessingQueuePanelProps {
  active: ProcessingJobRow[];
  failed: ProcessingJobRow[];
  workerOnline: boolean;
  // Resolves to a short status message to show under the header.
  onClear: () => Promise<string>;
  // Removes the still-failed songs and clears the failed list; resolves to a
  // short status message.
  onClearFailed: () => Promise<string>;
}

// 75s -> "1:15", 3725s -> "1:02:05"
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function SongThumb({ url }: { url: string | null | undefined }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- external, unsized YouTube thumbnail
    <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
  ) : (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-hover">
      <Music2 className="h-4 w-4 text-muted" />
    </div>
  );
}

// The worker's own queue (every song waiting on or going through stem
// separation, across all rooms — there's one GPU worker), as opposed to the
// room's singing queue in the middle column.
export function ProcessingQueuePanel({ active, failed, workerOnline, onClear, onClearFailed }: ProcessingQueuePanelProps) {
  const [clearingFailed, setClearingFailed] = useState(false);

  async function clearFailed() {
    const message =
      `Remover ${failed.length} música(s) com falha? Elas não têm áudio, então nada que já toca é perdido. ` +
      "Dá para adicionar de novo depois pelo Spotify ou CSV.";
    if (!window.confirm(message)) return;
    setClearingFailed(true);
    setClearMsg(null);
    try {
      setClearMsg(await onClearFailed());
    } finally {
      setClearingFailed(false);
    }
  }

  const [now, setNow] = useState(() => Date.now());
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  // Every second, so the elapsed-time counters on in-progress songs tick.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isStale = (job: ProcessingJobRow) => now - new Date(job.updated_at).getTime() > STALE_JOB_AFTER_MS;
  const inProgress = active.filter((job) => job.status !== "queued");
  const waiting = active.filter((job) => job.status === "queued");
  // Mirrors clearProcessingQueue: a fresh job the online worker is on stays.
  const runningCount = workerOnline ? inProgress.filter((job) => !isStale(job)).length : 0;
  const clearableCount = active.length - runningCount;

  async function clear() {
    const running = runningCount > 0 ? " A música em processamento agora vai terminar normalmente." : "";
    if (!window.confirm(`Cancelar ${clearableCount} música(s) da fila de processamento?${running}`)) return;
    setClearing(true);
    setClearMsg(null);
    try {
      setClearMsg(await onClear());
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-hidden rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
            <Cpu className="h-4 w-4" /> Processamento
          </h2>
          <span className={`flex items-center gap-1.5 text-xs ${workerOnline ? "text-emerald-400" : "text-muted"}`}>
            <span className={`h-2 w-2 rounded-full ${workerOnline ? "bg-emerald-400" : "bg-muted"}`} />
            {workerOnline ? "Worker online" : "Worker offline"}
          </span>
        </div>
        {clearableCount > 0 && (
          <Button
            variant="danger"
            loading={clearing}
            onClick={clear}
            icon={<Trash2 className="h-4 w-4" />}
            className="self-start px-3 py-1.5 text-xs"
          >
            Limpar fila de processamento
          </Button>
        )}
        {clearMsg && <p className="text-xs text-muted">{clearMsg}</p>}
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {active.length === 0 && failed.length === 0 && (
          <p className="text-sm text-muted">Nada sendo processado.</p>
        )}

        {inProgress.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">Processando agora</p>
            {inProgress.map((job) => {
              const stale = isStale(job);
              return (
                <div key={job.id} className="flex flex-col gap-2 rounded-xl border border-border px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <SongThumb url={job.songs?.thumbnail_url} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium">{job.songs?.title ?? "?"}</p>
                        {job.started_at && (
                          <span
                            className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted"
                            title="Tempo processando"
                          >
                            <Clock className="h-3 w-3" />
                            {formatElapsed(now - new Date(job.started_at).getTime())}
                          </span>
                        )}
                      </div>
                      <p className={`truncate text-xs ${stale ? "text-amber-400" : "text-muted"}`}>
                        {stale ? "Sem atualização há muito tempo — pode ter travado" : (job.stage_label ?? job.status)}
                      </p>
                    </div>
                  </div>
                  {!stale && <ProgressBar percent={job.progress_pct} />}
                </div>
              );
            })}
          </section>
        )}

        {waiting.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">Na fila de processamento ({waiting.length})</p>
            {waiting.map((job, i) => (
              <div key={job.id} className="flex items-center gap-3 rounded-xl px-1 py-1">
                <span className="w-5 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                <SongThumb url={job.songs?.thumbnail_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{job.songs?.title ?? "?"}</p>
                  {job.songs?.artist_guess && <p className="truncate text-xs text-muted">{job.songs.artist_guess}</p>}
                </div>
              </div>
            ))}
          </section>
        )}

        {failed.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted">Falharam (últimas 24h)</p>
              <Button
                variant="ghost"
                loading={clearingFailed}
                onClick={clearFailed}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                className="px-2 py-1 text-xs"
              >
                Limpar
              </Button>
            </div>
            {failed.map((job) => (
              <div key={job.id} className="flex items-start gap-3 rounded-xl px-1 py-1">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{job.songs?.title ?? "?"}</p>
                  {job.error_message && (
                    <p className="line-clamp-2 break-all text-xs text-muted" title={job.error_message}>
                      {job.error_message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
