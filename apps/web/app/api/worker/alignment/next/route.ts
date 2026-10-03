import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";
import { isSyncedLrc, lyricsHash } from "@/lib/lyricsAlignment";

interface Row {
  song_id: string;
  raw_lrc: string | null;
  offset_ms: number;
  aligned_hash: string | null;
  songs: { title: string; status: string; stems: { type: string; storage_path: string }[] };
}

// Returns one ready song whose synced lyrics have no word timings for their
// current text and offset, or null. The worker asks with ?songId= right
// after processing a song (so it's word-synced as soon as it's ready), and
// without it when idle (the existing library, lyrics edited since).
export async function GET(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const songId = new URL(request.url).searchParams.get("songId");
  const supabase = createServiceRoleClient();
  let query = supabase
    .from("lyrics")
    .select("song_id, raw_lrc, offset_ms, aligned_hash, songs!inner(title, status, stems(type, storage_path))")
    .eq("songs.status", "ready");
  if (songId) query = query.eq("song_id", songId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const row of (data ?? []) as unknown as Row[]) {
    if (!isSyncedLrc(row.raw_lrc)) continue;
    const hash = lyricsHash(row.raw_lrc, row.offset_ms);
    if (row.aligned_hash === hash) continue;
    const vocals = ["lead_vocal", "backing_vocal"]
      .map((type) => row.songs.stems.find((stem) => stem.type === type)?.storage_path)
      .filter((path): path is string => !!path);
    if (vocals.length === 0) continue;

    return NextResponse.json({
      task: {
        songId: row.song_id,
        title: row.songs.title,
        rawLrc: row.raw_lrc,
        offsetMs: row.offset_ms,
        hash,
        vocalPaths: vocals,
      },
    });
  }

  return NextResponse.json({ task: null });
}
