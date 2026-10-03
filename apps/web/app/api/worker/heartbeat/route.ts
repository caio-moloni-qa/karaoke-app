import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";

// Sent by a background thread in the worker every few seconds, including
// mid-song. The claim endpoint's heartbeat alone goes silent for the whole
// several-minute separation of each song, which made a busy worker look
// offline (and let "clear processing queue" treat its running job as stuck).
export async function POST(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workerId } = (await request.json().catch(() => ({}))) as { workerId?: string };
  const supabase = createServiceRoleClient();
  await supabase.from("workers").upsert({ id: workerId ?? "unknown", last_seen_at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
