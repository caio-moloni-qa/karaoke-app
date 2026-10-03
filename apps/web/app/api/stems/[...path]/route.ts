import { NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { resolveStemPath } from "@/lib/stemsStorage";

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".wav")) return "audio/wav";
  if (filePath.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

// Serves stem/original audio files from local disk (see lib/stemsStorage.ts
// for why they live here instead of Supabase Storage). Supports Range
// requests since <audio> elements commonly issue them for seeking, even
// though the current UI doesn't expose a seek bar yet.
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: pathSegments } = await params;
  const filePath = resolveStemPath(pathSegments.join("/"));

  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = contentTypeFor(filePath);
  const range = request.headers.get("range");

  if (range) {
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;

    return new NextResponse(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType,
      },
    });
  }

  return new NextResponse(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    headers: {
      "Content-Length": String(size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    },
  });
}
