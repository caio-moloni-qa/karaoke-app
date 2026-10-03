import { NextResponse } from "next/server";
import { isAuthorizedWorker } from "@/lib/workerAuth";
import { STEMS_STORAGE_DIR, isStorageAvailable } from "@/lib/stemsStorage";

// The worker fetches this at startup so it saves audio wherever the web app
// serves it from — one setting (STEMS_STORAGE_DIR in apps/web/.env.local)
// instead of two that could drift apart.
export async function GET(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ stemsStorageDir: STEMS_STORAGE_DIR, storageAvailable: isStorageAvailable() });
}
