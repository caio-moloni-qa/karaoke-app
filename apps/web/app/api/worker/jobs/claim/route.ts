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

  return NextResponse.json({ job: claimed });
}
