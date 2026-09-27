import { NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { findOrCreateSong } from "@/lib/songs";
import { autoSaveLyrics } from "@/lib/autoLyrics";

interface RequestSongBody {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnailUrl: string;
  guestId: string;
  clientToken: string;
}

// Guests can't insert into songs/processing_jobs directly (no RLS policy
// allows it — only worker/server code can, via the service-role key), so
// requesting a song for the queue goes through this route instead of a
// direct client-side insert like queue_items itself.
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const body = (await request.json()) as RequestSongBody;
  const { videoId, title, channelTitle, durationSeconds, thumbnailUrl, guestId, clientToken } = body;

  if (!videoId || !title || !guestId || !clientToken) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: guest, error: guestError } = await supabase
    .from("guests")
    .select("id")
    .eq("id", guestId)
    .eq("room_id", roomId)
    .eq("client_token", clientToken)
    .maybeSingle();

  if (guestError || !guest) {
    return NextResponse.json({ error: "Not a guest of this room" }, { status: 403 });
  }

  let song;
  try {
    song = await findOrCreateSong({ videoId, title, channelTitle, durationSeconds, thumbnailUrl }, roomId, guestId);
  } catch {
    return NextResponse.json({ error: "Failed to create song" }, { status: 500 });
  }

  after(() => autoSaveLyrics(song.id, title, channelTitle, durationSeconds).catch(() => {}));

  const { data: queueItem, error: queueError } = await supabase
    .from("queue_items")
    .insert({ room_id: roomId, song_id: song.id, requested_by: guestId, status: "queued" })
    .select("id")
    .single();

  if (queueError || !queueItem) {
    return NextResponse.json({ error: "Failed to queue song" }, { status: 500 });
  }

  return NextResponse.json({ songId: song.id, queueItemId: queueItem.id, songStatus: song.status });
}
