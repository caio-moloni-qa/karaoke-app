import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { autoSaveLyrics } from "@/lib/autoLyrics";

// Retries the automatic lyrics match for a song that already exists (no
// new YouTube search, no quota cost) — used for "Automatic" mode requests
// where the first attempt failed, e.g. a transient LRCLIB error or a messy
// title that's since been fixed.
export async function POST(_request: Request, { params }: { params: Promise<{ songId: string }> }) {
  const { songId } = await params;
  const supabase = createServiceRoleClient();

  const { data: song, error } = await supabase
    .from("songs")
    .select("title, artist_guess, duration_seconds")
    .eq("id", songId)
    .single();

  if (error || !song) {
    return NextResponse.json({ error: "Song not found" }, { status: 404 });
  }

  const saved = await autoSaveLyrics(songId, song.title, song.artist_guess ?? undefined, song.duration_seconds ?? undefined);
  return NextResponse.json({ saved });
}
