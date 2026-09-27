// Hand-written subset of the schema in supabase/migrations/0001_init.sql —
// only the columns MVP1 actually reads/writes. Regenerate with the Supabase
// CLI (`supabase gen types typescript`) once the schema stabilizes.

export type StemType = "original" | "instrumental" | "lead_vocal" | "backing_vocal";
export type SongStatus = "pending" | "queued" | "processing" | "ready" | "failed";
export type QueueItemStatus = "queued" | "now_playing" | "played" | "removed";
export type ProcessingJobStatus =
  | "queued"
  | "claimed"
  | "downloading"
  | "separating"
  | "uploading"
  | "done"
  | "error";

export const SONG_STATUS_LABEL: Record<SongStatus, string> = {
  pending: "Na fila para processar",
  queued: "Na fila para processar",
  processing: "Processando…",
  ready: "Pronta",
  failed: "Falhou ao processar",
};

export interface Room {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Guest {
  id: string;
  room_id: string;
  display_name: string;
  client_token: string;
  created_at: string;
}

export interface Song {
  id: string;
  youtube_video_id: string | null;
  title: string;
  artist_guess: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  status: SongStatus;
  detected_key: string | null;
  detected_scale: string | null;
  created_at: string;
}

export interface Stem {
  id: string;
  song_id: string;
  type: StemType;
  storage_path: string;
  duration_seconds: number | null;
  created_at: string;
}

export interface QueueItem {
  id: string;
  room_id: string;
  song_id: string;
  requested_by: string | null;
  status: QueueItemStatus;
  added_at: string;
}

export interface ProcessingJob {
  id: string;
  song_id: string;
  room_id: string;
  requested_by: string | null;
  status: ProcessingJobStatus;
  stage_label: string | null;
  progress_pct: number;
  claimed_by_worker: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type SongProcessingSummary = Pick<ProcessingJob, "status" | "stage_label" | "progress_pct" | "created_at">;

export interface QueueItemWithSong extends QueueItem {
  songs:
    | (Pick<Song, "id" | "title" | "artist_guess" | "status" | "thumbnail_url"> & {
        processing_jobs: SongProcessingSummary[];
      })
    | null;
  guests: Pick<Guest, "id" | "display_name"> | null;
}

// A song can have more than one processing_jobs row over time (retries
// after a failure), but only ever one active at once — pick the most
// recently created.
export function latestProcessingJob(jobs: SongProcessingSummary[] | undefined): SongProcessingSummary | null {
  if (!jobs || jobs.length === 0) return null;
  return jobs.reduce((latest, job) => (job.created_at > latest.created_at ? job : latest));
}

export interface Lyrics {
  id: string;
  song_id: string;
  source: string;
  lrclib_id: string | null;
  raw_lrc: string | null;
  offset_ms: number;
  created_at: string;
}

export interface SongDisplaySettings {
  song_id: string;
  art_url: string | null;
  blur: number;
  opacity: number;
  contrast: number;
  mix_instrumental_vol: number;
  mix_lead_vol: number;
  mix_backing_vol: number;
  updated_at: string;
}
