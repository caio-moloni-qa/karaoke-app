import { NextResponse } from "next/server";
import { processAutoSongRequest } from "@/lib/autoSongRequest";

interface BatchSong {
  artist?: string;
  title: string;
}

interface BatchBody {
  songs: BatchSong[];
}

interface BatchRowResult {
  query: string;
  status: "added" | "error";
  matchedTitle?: string;
  error?: string;
}

// Backs the control panel's import list (see docs/csv-song-import.md):
// rows from Spotify, a CSV or manual entry arrive here as
// artist/title pairs. The raw CSV file never reaches the server.
//
// Caps a single import so one upload can't runaway the YouTube Data API
// quota (10k units/day by default; each search costs 100).
const MAX_BATCH_SIZE = 300;

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { songs } = (await request.json()) as BatchBody;

  if (!Array.isArray(songs) || songs.length === 0) {
    return NextResponse.json({ error: "No songs provided" }, { status: 400 });
  }

  const rows = songs
    .map((song) => ({ artist: song.artist?.trim() ?? "", title: song.title?.trim() ?? "" }))
    .filter((song) => song.title)
    .slice(0, MAX_BATCH_SIZE);
  const results: BatchRowResult[] = [];

  // Sequential, not parallel: each row does a YouTube search + (on a new
  // song) kicks off a processing job, and the quota/rate-limit budget is
  // shared across the whole batch — bursting them in parallel would just
  // make quota exhaustion happen sooner without finishing any faster from
  // YouTube's side.
  for (let i = 0; i < rows.length; i++) {
    const { artist, title } = rows[i];
    const query = [artist, title].filter(Boolean).join(" ");
    try {
      // requestedBy is always null here — batch imports only populate the
      // library (triggers processing), they never join today's live queue.
      // A row with both fields is treated as known metadata, used for the
      // song's name and its lyrics lookup.
      const result = await processAutoSongRequest(roomId, query, null, artist ? { artist, title } : undefined);
      results.push({ query, status: "added", matchedTitle: result.matchedTitle });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ query, status: "error", error: message });

      if (message.includes("403")) {
        // YouTube quota almost certainly exhausted — further searches will
        // just fail the same way, so stop burning them and mark the rest
        // as skipped instead of silently hanging on every remaining row.
        for (const skipped of rows.slice(i + 1)) {
          results.push({
            query: [skipped.artist, skipped.title].filter(Boolean).join(" "),
            status: "error",
            error: "Skipped — YouTube quota exceeded earlier in this batch",
          });
        }
        break;
      }
    }
  }

  return NextResponse.json({ results });
}
