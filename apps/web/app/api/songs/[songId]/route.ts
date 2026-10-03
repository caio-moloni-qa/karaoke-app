import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Stem, StemType } from "@/lib/types";

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

  const { data: lyrics } = await supabase
    .from("lyrics")
    .select("raw_lrc, offset_ms")
    .eq("song_id", songId)
    .maybeSingle();

  const { data: displaySettings } = await supabase
    .from("song_display_settings")
    .select("art_url, blur, opacity, contrast, mix_instrumental_vol, mix_lead_vol, mix_backing_vol")
    .eq("song_id", songId)
    .maybeSingle();

  return NextResponse.json({ song, stems: stemUrls, lyrics, displaySettings });
}
