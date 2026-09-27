import { NextResponse } from "next/server";
import { searchItunesArt } from "@/lib/itunes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

  try {
    const results = await searchItunesArt(q);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "iTunes search failed" }, { status: 502 });
  }
}
