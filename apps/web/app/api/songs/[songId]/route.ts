import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Stem, StemType } from "@/lib/types";
import { lyricsHash, type AlignedLine } from "@/lib/lyricsAlignment";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ songId: string }> }
) {
  const { songId } = await params;
  const supabase = createServiceRoleClient();

  const { data: song, error: songError } = await supabase
    .from("songs")
    .select("id, title, artist_guess, duration_seconds, thumbnail_url")
    .eq("id", songId)
    .single();

  if (songError || !song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const { data: stems, error: stemsError } = await supabase
    .from("stems")
    .select("type, storage_path")
    .eq("song_id", songId);

  if (stemsError || !stems) {
    return NextResponse.json({ error: "Failed to load stems" }, { status: 500 });
  }

  // Served from local disk (see lib/stemsStorage.ts) rather than signed
  // Supabase Storage URLs — audio is uncompressed WAV and blew through the
  // project's Storage quota well before the database itself came close to
  // any limit.
  const stemUrls: Partial<Record<StemType, string>> = {};
  for (const stem of stems as Pick<Stem, "type" | "storage_path">[]) {
    stemUrls[stem.type] = `/api/stems/${stem.storage_path}`;
  }

  const { data: lyricsRow } = await supabase
    .from("lyrics")
    .select("raw_lrc, offset_ms, word_timings, aligned_hash")
    .eq("song_id", songId)
    .maybeSingle();

  // Word timings only count for the exact lyrics + offset they were aligned
  // to; after an edit they're stale until the worker re-aligns the song.
  const lyrics = lyricsRow && {
    raw_lrc: lyricsRow.raw_lrc,
    offset_ms: lyricsRow.offset_ms,
    word_timings:
      lyricsRow.raw_lrc && lyricsRow.aligned_hash === lyricsHash(lyricsRow.raw_lrc, lyricsRow.offset_ms)
        ? (lyricsRow.word_timings as AlignedLine[] | null)
        : null,
  };

  const { data: displaySettings } = await supabase
    .from("song_display_settings")
    .select("art_url, blur, opacity, contrast, mix_instrumental_vol, mix_lead_vol, mix_backing_vol")
    .eq("song_id", songId)
    .maybeSingle();

  return NextResponse.json({ song, stems: stemUrls, lyrics, displaySettings });
}
