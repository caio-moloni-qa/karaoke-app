import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { processAutoSongRequest } from "@/lib/autoSongRequest";

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

  let requestedBy: string | null = null;
  if (guestId && clientToken) {
    const supabase = createServiceRoleClient();
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

  try {
    const result = await processAutoSongRequest(roomId, query.trim(), requestedBy);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add song";
    const status = message.startsWith("No YouTube results") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
