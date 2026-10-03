import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clearFailedProcessing } from "@/lib/processingQueue";

interface ClearFailedBody {
  guestId: string;
  clientToken: string;
}

// Backs the processing panel's "Limpar" button on the failed list. Like
// clearing the queue, it requires being a verified guest of the room.
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { guestId, clientToken } = (await request.json()) as ClearFailedBody;

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
    return NextResponse.json(await clearFailedProcessing());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to clear" }, { status: 500 });
  }
}
