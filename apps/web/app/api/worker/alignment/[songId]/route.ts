import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";
import { lyricsHash, type AlignedLine } from "@/lib/lyricsAlignment";

interface AlignmentBody {
  hash: string;
  lines?: AlignedLine[];
  error?: string;
}

// Stores the worker's word timings (or why aligning failed — recorded too,
// so a song that can't be aligned isn't retried forever). Ignored when the
// lyrics changed while the worker was aligning: the hash won't match, and the
// new lyrics get their own turn.
export async function POST(request: Request, { params }: { params: Promise<{ songId: string }> }) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { songId } = await params;
  const { hash, lines, error } = (await request.json()) as AlignmentBody;

  const supabase = createServiceRoleClient();
  const { data: lyrics } = await supabase.from("lyrics").select("raw_lrc, offset_ms").eq("song_id", songId).maybeSingle();
  if (!lyrics?.raw_lrc || lyricsHash(lyrics.raw_lrc, lyrics.offset_ms) !== hash) {
    return NextResponse.json({ stored: false, reason: "Lyrics changed since alignment started" }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("lyrics")
    .update({ word_timings: error ? null : (lines ?? []), aligned_hash: hash, alignment_error: error ?? null })
    .eq("song_id", songId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ stored: true });
}
