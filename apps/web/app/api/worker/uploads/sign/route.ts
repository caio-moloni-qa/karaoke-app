import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";

// Returns a signed upload URL for the private `stems` bucket. The worker
// then PUTs the file bytes straight to Supabase Storage — audio never
// passes through this serverless function (avoids body-size/time limits).
export async function POST(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { songId, filename } = (await request.json()) as { songId?: string; filename?: string };
  if (!songId || !filename) {
    return NextResponse.json({ error: "Missing songId or filename" }, { status: 400 });
  }

  const path = `${songId}/${filename}`;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage.from("stems").createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create signed upload URL" }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
}
