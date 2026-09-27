import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";
import type { StemType } from "@/lib/types";

interface CompleteBody {
  detectedKey?: string;
  detectedScale?: string;
  durationSeconds?: number;
  stems: { type: StemType; storagePath: string; durationSeconds?: number }[];
}

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const { detectedKey, detectedScale, durationSeconds, stems } = (await request.json()) as CompleteBody;

  const supabase = createServiceRoleClient();

  const { data: job, error: jobError } = await supabase
    .from("processing_jobs")
    .select("song_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { error: stemsError } = await supabase.from("stems").upsert(
    stems.map((stem) => ({
      song_id: job.song_id,
      type: stem.type,
      storage_path: stem.storagePath,
      duration_seconds: stem.durationSeconds ?? null,
    })),
    { onConflict: "song_id,type" }
  );

  if (stemsError) {
    return NextResponse.json({ error: "Failed to save stems" }, { status: 500 });
  }

  await supabase
    .from("songs")
    .update({
      status: "ready",
      duration_seconds: durationSeconds ?? null,
      detected_key: detectedKey ?? null,
      detected_scale: detectedScale ?? null,
    })
    .eq("id", job.song_id);

  await supabase
    .from("processing_jobs")
    .update({ status: "done", progress_pct: 100, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  return NextResponse.json({ ok: true });
}
