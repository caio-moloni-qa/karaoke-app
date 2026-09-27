import { NextResponse } from "next/server";
import { searchLrclib } from "@/lib/lrclib";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim();
  const artist = searchParams.get("artist")?.trim() || undefined;
  if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });

  try {
    const results = await searchLrclib(title, artist);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "LRCLIB search failed" }, { status: 502 });
  }
}
