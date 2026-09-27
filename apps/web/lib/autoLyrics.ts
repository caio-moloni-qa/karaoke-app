import "server-only";
import { searchLrclib } from "@/lib/lrclib";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Best-effort automatic lyrics pick for "Automatic" mode / batch imports —
// prefers a synced (timestamped) result, and among those, whichever has a
// duration closest to the actual video (LRCLIB has many mislabeled/wrong
// entries sharing a title). Never overwrites a lyrics row that already
// exists (e.g. someone already hand-picked one in the editor).
export async function autoSaveLyrics(
  songId: string,
  title: string,
  artist: string | undefined,
  durationSeconds: number | undefined
): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("lyrics").select("song_id").eq("song_id", songId).maybeSingle();
  if (existing) return false;

  let results;
  try {
    results = await searchLrclib(title, artist);
  } catch {
    return false;
  }

  const synced = results.filter((r) => r.syncedLyrics);
  const candidates = synced.length > 0 ? synced : results.filter((r) => r.plainLyrics);
  if (candidates.length === 0) return false;

  let best = candidates[0];
  if (durationSeconds) {
    best = candidates.reduce((a, b) =>
      Math.abs(a.duration - durationSeconds) <= Math.abs(b.duration - durationSeconds) ? a : b
    );
  }

  const { error } = await supabase.from("lyrics").upsert(
    {
      song_id: songId,
      source: "lrclib",
      lrclib_id: String(best.id),
      raw_lrc: best.syncedLyrics ?? best.plainLyrics,
      offset_ms: 0,
    },
    { onConflict: "song_id" }
  );

  return !error;
}
