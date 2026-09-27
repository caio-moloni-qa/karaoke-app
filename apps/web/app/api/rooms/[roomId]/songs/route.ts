import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

  let song = await supabase
    .from("songs")
    .select("id, status")
    .eq("youtube_video_id", videoId)
    .maybeSingle()
    .then((res) => res.data);

  if (!song) {
    const { data: inserted, error: insertError } = await supabase
      .from("songs")
      .insert({
        youtube_video_id: videoId,
        title,
        artist_guess: channelTitle,
        duration_seconds: durationSeconds,
        thumbnail_url: thumbnailUrl,
        status: "queued",
      })
      .select("id, status")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json({ error: "Failed to create song" }, { status: 500 });
    }
    song = inserted;

    await supabase.from("processing_jobs").insert({
      song_id: song.id,
      room_id: roomId,
      requested_by: guestId,
      status: "queued",
    });
  } else if (song.status === "failed") {
    // Retry: send it back through the pipeline.
    await supabase.from("songs").update({ status: "queued" }).eq("id", song.id);
    await supabase.from("processing_jobs").insert({
      song_id: song.id,
      room_id: roomId,
      requested_by: guestId,
      status: "queued",
    });
  }

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
