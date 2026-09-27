import { NextResponse } from "next/server";
import { searchYoutube } from "@/lib/youtube";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

  try {
    const results = await searchYoutube(q);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "YouTube search failed" }, { status: 502 });
  }
}
