import { NextResponse } from "next/server";
import { STEMS_STORAGE_DIR, isStorageAvailable } from "@/lib/stemsStorage";

// Lets the control panel warn when the audio library isn't reachable
// (usually an external HD that's unplugged) instead of songs just failing
// to play. `dir` is shown so you can tell which drive it expects.
export async function GET() {
  return NextResponse.json({ available: isStorageAvailable(), dir: STEMS_STORAGE_DIR });
}
