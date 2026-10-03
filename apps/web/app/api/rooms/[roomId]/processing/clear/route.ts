import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearProcessingQueue } from "@/lib/processingQueue";

interface ClearBody {
  guestId: string;
  clientToken: string;
}

// The processing queue is global (one GPU worker), but clearing it still
// requires being a verified guest of some room, like every other write.
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { guestId, clientToken } = (await request.json()) as ClearBody;

  const supabase = createServiceRoleClient();
  const { data: guest } = await supabase
    .from("guests")
    .select("id")
    .eq("id", guestId)
    .eq("room_id", roomId)
    .eq("client_token", clientToken)
    .maybeSingle();
  if (!guest) return NextResponse.json({ error: "Not a guest of this room" }, { status: 403 });

  try {
    return NextResponse.json(await clearProcessingQueue());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to clear" }, { status: 500 });
  }
}
