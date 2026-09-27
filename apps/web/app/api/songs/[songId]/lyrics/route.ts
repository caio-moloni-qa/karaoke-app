import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

interface LyricsBody {
  lrclibId?: string;
  rawLrc: string;
  offsetMs?: number;
}

// `lyrics` has no anon insert/update policy (same reasoning as
// songs/processing_jobs), so saving a pick goes through here.
export async function POST(request: Request, { params }: { params: Promise<{ songId: string }> }) {
  const { songId } = await params;
  const { lrclibId, rawLrc, offsetMs } = (await request.json()) as LyricsBody;

  if (!rawLrc) {
    return NextResponse.json({ error: "Missing rawLrc" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("lyrics").upsert(
    {
      song_id: songId,
      source: "lrclib",
      lrclib_id: lrclibId ?? null,
      raw_lrc: rawLrc,
      offset_ms: offsetMs ?? 0,
    },
    { onConflict: "song_id" }
  );

  if (error) return NextResponse.json({ error: "Failed to save lyrics" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
