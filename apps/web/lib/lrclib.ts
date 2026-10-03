import "server-only";

export interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// YouTube channel names are frequently VEVO handles or upload-account
// branding ("systemofadownVEVO", "Warner Records Vault"), not the actual
// artist name LRCLIB expects — strip the obvious noise from it so it's at
// least closer, for use as a fallback when the title has no usable split.
function cleanChannelName(channel?: string): string | undefined {
  if (!channel) return undefined;
  const cleaned = channel
    .replace(/VEVO$/i, "")
    .replace(/\s*-?\s*(official|music|records?|videos?|channel|vault)\s*$/i, "")
    .trim();
  return cleaned || undefined;
}

export interface SearchableTrack {
  track: string;
  artist?: string;
}

// YouTube titles carry a lot of noise LRCLIB's matching chokes on — long
// bracketed annotations, channel branding after a "|", "feat./ft." credits
// — and, critically, official-upload titles almost always encode the real
// artist name as an "Artist - Track" (or "Artist: Track") prefix, which is
// far more reliable than the channel name (a VEVO handle won't fuzzy-match
// anything in LRCLIB's artist index). A few channels title it backwards
// ("Track - Artist"), so when a channel hint is available, whichever half
// resembles it decides which side is the artist.
export function parseSearchableTrack(rawTitle: string, channelHint?: string): SearchableTrack {
  let title = rawTitle;

  const junkPattern =
    /[([][^\])]*\b(official|video|audio|lyric|lyrics|hd|4k|8k|remaster(ed)?|upgrade|hq|mv|visualizer|explicit|clean|full album|album version)\b[^\])]*[)\]]/gi;
  title = title.replace(junkPattern, "");
  title = title.split("|")[0];
  title = title.replace(/\s+(feat\.?|ft\.?)\s+.+$/i, "");
  // New-single uploads often append promo text that isn't bracketed, so the
  // strip above misses it: a quoted upcoming-release name ("... "An Ending
  // In Itself" OUT 6/12/26"), or an "out <date>"/"available now" announcement.
  title = title.replace(/\s*["“].*$/, "");
  title = title.replace(/\s+out\s+\d.*$/i, "");
  title = title.replace(/\s+\b(available now|pre-?order|pre-?save)\b.*$/i, "");
  title = title.replace(/\s{2,}/g, " ").trim();

  const cleanedChannel = cleanChannelName(channelHint);
  const channelKey = cleanedChannel ? normalizeForCompare(cleanedChannel) : null;

  // Requires whitespace around the separator so compound names like
  // "Static-X" or "P.O.D." don't get split on their own internal hyphen.
  const dashMatch = title.match(/^(.+?)\s+[-:]\s+(.+)$/);
  if (dashMatch) {
    const [, partA, partB] = dashMatch;
    if (channelKey) {
      const aKey = normalizeForCompare(partA);
      const bKey = normalizeForCompare(partB);
      const aMatches = aKey.length > 0 && (aKey.includes(channelKey) || channelKey.includes(aKey));
      const bMatches = bKey.length > 0 && (bKey.includes(channelKey) || channelKey.includes(bKey));
      if (bMatches && !aMatches) {
        return { track: partA.trim(), artist: partB.trim() };
      }
    }
    return { track: partB.trim(), artist: partA.trim() };
  }

  return { track: title, artist: cleanedChannel };
}

async function fetchLrclib(trackName: string, artistName?: string): Promise<Response> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("track_name", trackName);
  if (artistName) url.searchParams.set("artist_name", artistName);

  return fetch(url, {
    // LRCLIB asks API consumers to identify themselves.
    headers: { "User-Agent": "karaoke-app (personal project)" },
  });
}

// LRCLIB fails intermittently even on well-formed queries (observed 502s
// unrelated to input), so this retries once after a short delay before
// giving up.
export async function searchLrclib(trackName: string, artistName?: string): Promise<LrclibResult[]> {
  let res = await fetchLrclib(trackName, artistName);
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 800));
    res = await fetchLrclib(trackName, artistName);
  }
  if (!res.ok) throw new Error(`LRCLIB search failed: ${res.status}`);
  return res.json();
}
