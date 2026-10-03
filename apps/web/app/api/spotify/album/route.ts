import { NextResponse } from "next/server";
import { lookupSpotifyAlbum } from "@/lib/spotify";

interface AlbumBody {
  input: string;
}

// Spotify album link or name -> its real tracklist, for staging in the
// control panel's import list. This never touches the database; only the
// batch import route (on explicit confirmation) does.
export async function POST(request: Request) {
  const { input } = (await request.json()) as AlbumBody;

  if (!input?.trim()) {
    return NextResponse.json({ error: "Missing input" }, { status: 400 });
  }

  try {
    const album = await lookupSpotifyAlbum(input.trim());
    if (!album) {
      return NextResponse.json({ error: "Nenhum álbum encontrado no Spotify." }, { status: 404 });
    }
    return NextResponse.json(album);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spotify lookup failed";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
