import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const { message } = (await request.json()) as { message?: string };

  const supabase = createServiceRoleClient();

  const { data: job } = await supabase
    .from("processing_jobs")
    .select("song_id")
    .eq("id", jobId)
    .single();

  await supabase
    .from("processing_jobs")
    .update({ status: "error", error_message: message ?? "Unknown error", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (job) {
    await supabase.from("songs").update({ status: "failed" }).eq("id", job.song_id);
  }

  return NextResponse.json({ ok: true });
}
