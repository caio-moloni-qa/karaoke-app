import "server-only";

export interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

export async function searchLrclib(trackName: string, artistName?: string): Promise<LrclibResult[]> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("track_name", trackName);
  if (artistName) url.searchParams.set("artist_name", artistName);

  const res = await fetch(url, {
    // LRCLIB asks API consumers to identify themselves.
    headers: { "User-Agent": "karaoke-app (personal project)" },
  });
  if (!res.ok) throw new Error(`LRCLIB search failed: ${res.status}`);
  return res.json();
}
