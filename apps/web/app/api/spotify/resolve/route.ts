import { NextResponse } from "next/server";
import { resolveSpotifyTrack, type SpotifyTrackResult } from "@/lib/spotify";

interface ResolveBody {
  songs: { artist?: string; title: string }[];
}

const MAX_ROWS = 300;
const CONCURRENCY = 4;

// CSV rows -> their exact Spotify tracks (null where there's no confident
// match), in the same order. Used by the control panel before staging an
// uploaded CSV. Never touches the database.
export async function POST(request: Request) {
  const { songs } = (await request.json()) as ResolveBody;
  if (!Array.isArray(songs)) return NextResponse.json({ error: "Missing songs" }, { status: 400 });

  const rows = songs.slice(0, MAX_ROWS);
  const matches: (SpotifyTrackResult | null)[] = new Array(rows.length).fill(null);

  try {
    // A few lookups at a time: fast enough for a few hundred rows without
    // tripping Spotify's rate limit.
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < rows.length) {
          const i = next++;
          matches[i] = await resolveSpotifyTrack(rows[i].artist ?? "", rows[i].title ?? "");
        }
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spotify lookup failed";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ matches });
}
