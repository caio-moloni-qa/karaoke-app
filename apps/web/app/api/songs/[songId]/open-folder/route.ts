import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { songFolder } from "@/lib/stemsStorage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The address the browser used, from the Host header — request.url can't be
// used here: Next.js rewrites it to localhost even when a phone sent it.
function requestedHostname(request: Request): string {
  const host = request.headers.get("host") ?? "";
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

// Opens a song's audio folder in the host's file explorer. Only from the
// host itself: a request from a phone would pop a window open on the host
// PC, which is never what the person on the phone wants.
export async function POST(request: Request, { params }: { params: Promise<{ songId: string }> }) {
  if (!LOOPBACK.has(requestedHostname(request))) {
    return NextResponse.json({ error: "Only available on the host machine" }, { status: 403 });
  }

  const { songId } = await params;
  if (!UUID.test(songId)) return NextResponse.json({ error: "Invalid song id" }, { status: 400 });

  const folder = songFolder(songId);
  if (!existsSync(folder)) {
    return NextResponse.json({ error: "Pasta da música não encontrada (HD desconectado?)" }, { status: 404 });
  }

  // Arguments passed as an array (no shell), so the path can't be
  // interpreted as a command.
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [folder], { detached: true, stdio: "ignore" }).unref();

  return NextResponse.json({ ok: true });
}
