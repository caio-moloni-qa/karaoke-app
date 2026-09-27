import { NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { searchYoutube } from "@/lib/youtube";
import { findOrCreateSong } from "@/lib/songs";
import { autoSaveLyrics } from "@/lib/autoLyrics";

interface AutoBody {
  query: string;
  // Optional: when present, the song is also added to this room's live
  // queue (requires a real guest). Omitted entirely for background/batch
  // imports that should only populate the library, not today's queue.
  guestId?: string;
  clientToken?: string;
}

// "Automatic" mode: caller gives a free-text song name instead of picking
// from a YouTube results list — this does the search itself, takes the top
// result, and best-effort attaches synced lyrics, same as picking manually
// in the editor but without the extra step.
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { query, guestId, clientToken } = (await request.json()) as AutoBody;

  if (!query?.trim()) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  let results;
  try {
    results = await searchYoutube(query.trim());
  } catch {
    return NextResponse.json({ error: "YouTube search failed" }, { status: 502 });
  }
  const top = results[0];
  if (!top) {
    return NextResponse.json({ error: "No YouTube results for that query" }, { status: 404 });
  }

  const supabase = createServiceRoleClient();

  let requestedBy: string | null = null;
  if (guestId && clientToken) {
    const { data: guest } = await supabase
      .from("guests")
      .select("id")
      .eq("id", guestId)
      .eq("room_id", roomId)
      .eq("client_token", clientToken)
      .maybeSingle();

    if (!guest) return NextResponse.json({ error: "Not a guest of this room" }, { status: 403 });
    requestedBy = guestId;
  }

  let song;
  try {
    song = await findOrCreateSong(
      {
        videoId: top.videoId,
        title: top.title,
        channelTitle: top.channelTitle,
        durationSeconds: top.durationSeconds,
        thumbnailUrl: top.thumbnailUrl,
      },
      roomId,
      requestedBy
    );
  } catch {
    return NextResponse.json({ error: "Failed to create song" }, { status: 500 });
  }

  after(() => autoSaveLyrics(song.id, top.title, top.channelTitle, top.durationSeconds).catch(() => {}));

  let queueItemId: string | null = null;
  if (requestedBy) {
    const { data: queueItem } = await supabase
      .from("queue_items")
      .insert({ room_id: roomId, song_id: song.id, requested_by: requestedBy, status: "queued" })
      .select("id")
      .single();
    queueItemId = queueItem?.id ?? null;
  }

  return NextResponse.json({
    songId: song.id,
    songStatus: song.status,
    queueItemId,
    matchedTitle: top.title,
    matchedChannel: top.channelTitle,
  });
}
