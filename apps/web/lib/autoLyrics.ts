import "server-only";
import { parseSearchableTrack, searchLrclib, type LrclibResult, type SearchableTrack } from "@/lib/lrclib";
import { createServiceRoleClient } from "@/lib/supabase/server";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickBest(results: LrclibResult[], durationSeconds: number | undefined, artist: string | undefined): LrclibResult | null {
  const synced = results.filter((r) => r.syncedLyrics);
  let candidates = synced.length > 0 ? synced : results.filter((r) => r.plainLyrics);
  if (candidates.length === 0) return null;

  // When we searched without an artist filter (fallback path), narrow to
  // results whose artist actually resembles ours first, if any do —
  // otherwise a same-titled track by a different artist can win on
  // duration alone.
  if (artist) {
    const artistKey = normalize(artist);
    const artistMatches = candidates.filter((c) => {
      const key = normalize(c.artistName);
      return key.includes(artistKey) || artistKey.includes(key);
    });
    if (artistMatches.length > 0) candidates = artistMatches;
  }

  if (!durationSeconds) return candidates[0];
  return candidates.reduce((a, b) => (Math.abs(a.duration - durationSeconds) <= Math.abs(b.duration - durationSeconds) ? a : b));
}

async function findBest(
  { track, artist }: SearchableTrack,
  durationSeconds: number | undefined
): Promise<LrclibResult | null> {
  let results: LrclibResult[] = [];
  try {
    if (artist) results = await searchLrclib(track, artist);
    if (results.length === 0) results = await searchLrclib(track);
  } catch {
    return null;
  }
  return pickBest(results, durationSeconds, artist);
}

// Best-effort automatic lyrics pick for "Automatic" mode / batch imports.
// Never overwrites a lyrics row that already exists (e.g. someone already
// hand-picked one in the editor).
//
// `known` is the real artist/title when the import source already had them
// (Spotify, the AI list, a CSV row) — tried first, since it's far more
// reliable than reverse-engineering them from a YouTube video title. The
// parsed video title is still the fallback.
export async function autoSaveLyrics(
  songId: string,
  title: string,
  channelHint: string | undefined,
  durationSeconds: number | undefined,
  known?: SearchableTrack
): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("lyrics").select("song_id").eq("song_id", songId).maybeSingle();
  if (existing) return false;

  const attempts = [...(known ? [known] : []), parseSearchableTrack(title, channelHint)];
  let best: LrclibResult | null = null;
  for (const attempt of attempts) {
    best = await findBest(attempt, durationSeconds);
    if (best) break;
  }
  if (!best) return false;

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
