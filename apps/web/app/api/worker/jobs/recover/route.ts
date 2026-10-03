import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";

const IN_PROGRESS = ["claimed", "downloading", "separating", "uploading"];

// Called once by the worker at startup. A worker that's just starting can't
// be working on anything, so any job still marked in progress under its id
// was orphaned by the previous run being stopped mid-song — put those back
// at the front of the queue instead of leaving them stuck forever.
export async function POST(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workerId } = (await request.json().catch(() => ({}))) as { workerId?: string };
  if (!workerId) return NextResponse.json({ error: "Missing workerId" }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: recovered, error } = await supabase
    .from("processing_jobs")
    .update({
      status: "queued",
      stage_label: null,
      progress_pct: 0,
      claimed_by_worker: null,
      updated_at: new Date().toISOString(),
    })
    .eq("claimed_by_worker", workerId)
    .in("status", IN_PROGRESS)
    .select("song_id");

  if (error) return NextResponse.json({ error: "Failed to recover jobs" }, { status: 500 });

  const songIds = (recovered ?? []).map((job) => job.song_id);
  if (songIds.length > 0) {
    await supabase.from("songs").update({ status: "queued" }).in("id", songIds);
  }

  return NextResponse.json({ recovered: songIds.length });
}
