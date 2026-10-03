import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ACTIVE_JOB_STATUSES, STALE_JOB_AFTER_MS } from "@/lib/processing";

const WORKER_ONLINE_WITHIN_MS = 15_000;

export interface ClearProcessingResult {
  cancelled: number;
  // Title of the job left running, if the worker was mid-song.
  stillRunning: string | null;
}

// Cancels every waiting job, plus in-progress ones that are stuck. A job the
// online worker is actively on is left to finish: there's no way to signal
// the worker to stop mid-separation, so cancelling it would only discard
// finished work and orphan its audio files.
//
// Cancelled jobs are deleted and their songs marked failed, which keeps them
// out of the library list while still letting them be requested again
// (findOrCreateSong requeues failed songs).
export async function clearProcessingQueue(): Promise<ClearProcessingResult> {
  const supabase = createServiceRoleClient();

  const [{ data: worker }, { data: jobs, error }] = await Promise.all([
    supabase.from("workers").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("processing_jobs")
      .select("id, song_id, status, updated_at, songs(title)")
      .in("status", [...ACTIVE_JOB_STATUSES]),
  ]);
  if (error) throw new Error(error.message);

  const now = Date.now();
  const workerOnline = !!worker && now - new Date(worker.last_seen_at).getTime() < WORKER_ONLINE_WITHIN_MS;
  const all = (jobs ?? []) as unknown as {
    id: string;
    song_id: string;
    status: string;
    updated_at: string;
    songs: { title: string } | null;
  }[];

  const running = workerOnline
    ? all.filter((job) => job.status !== "queued" && now - new Date(job.updated_at).getTime() < STALE_JOB_AFTER_MS)
    : [];
  const queuedIds = all.filter((job) => job.status === "queued").map((job) => job.id);
  const stuckIds = all.filter((job) => job.status !== "queued" && !running.includes(job)).map((job) => job.id);

  const deletedSongIds: string[] = [];
  if (queuedIds.length > 0) {
    // Re-checking status = queued guards against the worker claiming one of
    // these between the read above and this delete.
    const { data } = await supabase.from("processing_jobs").delete().in("id", queuedIds).eq("status", "queued").select("song_id");
    deletedSongIds.push(...(data ?? []).map((row) => row.song_id));
  }
  if (stuckIds.length > 0) {
    const { data } = await supabase.from("processing_jobs").delete().in("id", stuckIds).select("song_id");
    deletedSongIds.push(...(data ?? []).map((row) => row.song_id));
  }

  if (deletedSongIds.length > 0) {
    await supabase.from("songs").update({ status: "failed" }).in("id", deletedSongIds).neq("status", "ready");
  }

  return { cancelled: deletedSongIds.length, stillRunning: running[0]?.songs?.title ?? null };
}
