import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";

interface ProgressBody {
  status: "downloading" | "separating" | "uploading";
  stageLabel?: string;
  progressPct?: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const { status, stageLabel, progressPct } = (await request.json()) as ProgressBody;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("processing_jobs")
    .update({
      status,
      stage_label: stageLabel ?? null,
      progress_pct: progressPct ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) return NextResponse.json({ error: "Failed to update progress" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
