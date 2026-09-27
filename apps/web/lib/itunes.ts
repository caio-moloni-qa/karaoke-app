import "server-only";

export interface ItunesArtResult {
  trackName: string;
  artistName: string;
  artworkUrl: string;
}

interface ItunesApiResult {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

export async function searchItunesArt(query: string): Promise<ItunesArtResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "6");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
  const data = (await res.json()) as { results?: ItunesApiResult[] };

  return (data.results ?? [])
    .filter((r) => r.artworkUrl100)
    .map((r) => ({
      trackName: r.trackName ?? "",
      artistName: r.artistName ?? "",
      // iTunes serves a small default thumbnail; swapping the size in the
      // URL is the documented way to get a larger version.
      artworkUrl: r.artworkUrl100!.replace("100x100", "600x600"),
    }));
}
