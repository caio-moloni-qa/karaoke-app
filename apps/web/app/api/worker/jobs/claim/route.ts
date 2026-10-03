import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";

// Two-step claim (select oldest queued, then conditional update) instead of
// a single atomic query — fine for a single local worker; if a second
// worker raced it, the WHERE status='queued' guard on the update just makes
// the loser's claim no-op and it polls again next cycle.
export async function POST(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workerId } = (await request.json().catch(() => ({}))) as { workerId?: string };
  const supabase = createServiceRoleClient();

  // Doubles as the heartbeat for the online/offline indicator — the worker
  // calls this endpoint every poll cycle regardless of job availability.
  await supabase
    .from("workers")
    .upsert({ id: workerId ?? "unknown", last_seen_at: new Date().toISOString() });

  const { data: candidates } = await supabase
    .from("processing_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ job: null });
  }

  const { data: claimed } = await supabase
    .from("processing_jobs")
    .update({ status: "claimed", claimed_by_worker: workerId ?? "unknown" })
    .eq("id", candidates[0].id)
    .eq("status", "queued")
    .select("*, songs(id, title, youtube_video_id)")
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json({ job: null });
  }

  await supabase.from("songs").update({ status: "processing" }).eq("id", claimed.song_id);

  // Separate from the claim update on purpose: started_at comes from
  // migration 0007, and until that's applied this write fails on its own
  // instead of breaking claims (the panel just shows no elapsed time).
  await supabase.from("processing_jobs").update({ started_at: new Date().toISOString() }).eq("id", claimed.id);

  return NextResponse.json({ job: claimed });
}
