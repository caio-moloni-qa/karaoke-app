import { NextResponse } from "next/server";
import { searchSpotify } from "@/lib/spotify";

interface SearchBody {
  input: string;
}

// Song, album and artist search (or a track link) for the control panel's
// Spotify box. Album tracklists come from /api/spotify/album. Never touches
// the database.
export async function POST(request: Request) {
  const { input } = (await request.json()) as SearchBody;

  if (!input?.trim()) {
    return NextResponse.json({ error: "Missing input" }, { status: 400 });
  }

  try {
    return NextResponse.json(await searchSpotify(input.trim()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spotify lookup failed";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
