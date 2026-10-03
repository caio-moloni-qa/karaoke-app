import "server-only";

// App-only (client credentials) access — enough for public catalog lookups
// like albums. Playlists are deliberately not supported: since Spotify's
// Feb 2026 API changes, playlist items are only readable with the owning
// user's own OAuth login, which this app doesn't have.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not configured");
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so a token never expires mid-lookup.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function spotifyGet<T>(url: string): Promise<T> {
  const token = await getAppToken();
  const res = await fetch(url.startsWith("http") ? url : `https://api.spotify.com/v1${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// open.spotify.com/album/<id>, open.spotify.com/intl-pt/album/<id>?si=...,
// or spotify:album:<id>
function parseAlbumId(input: string): string | null {
  const match = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/|spotify:album:)([A-Za-z0-9]+)/.exec(input);
  return match?.[1] ?? null;
}

async function searchAlbumId(query: string): Promise<string | null> {
  const params = new URLSearchParams({ q: query, type: "album", limit: "1" });
  const data = await spotifyGet<{ albums: { items: { id: string }[] } }>(`/search?${params}`);
  return data.albums.items[0]?.id ?? null;
}

interface SpotifyArtist {
  name: string;
}

interface SpotifyTrack {
  name: string;
  artists: SpotifyArtist[];
}

interface SpotifyFullTrack extends SpotifyTrack {
  id: string;
  album: { name: string; images: { url: string; width: number | null }[] };
}

function parseTrackId(input: string): string | null {
  const match = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]+)/.exec(input);
  return match?.[1] ?? null;
}

export interface SpotifyTrackResult {
  id: string;
  artist: string;
  title: string;
  albumName: string;
  // Small, for result lists.
  imageUrl: string | null;
  // Full-size album cover: becomes the song's thumbnail and stage background.
  coverUrl: string | null;
}

function toTrackResult(track: SpotifyFullTrack): SpotifyTrackResult {
  return {
    id: track.id,
    artist: track.artists[0]?.name ?? "",
    title: cleanTrackTitle(track.name),
    albumName: track.album.name,
    imageUrl: thumbnail(track.album.images),
    coverUrl: largest(track.album.images),
  };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// A CSV row (artist + title, typed by hand) -> the exact Spotify track, so
// imports get the catalog's spelling instead of whatever was typed. Tries a
// field-filtered search first; a looser fallback is only accepted when its
// artist matches the row's, so a typo can't silently swap in another song.
export async function resolveSpotifyTrack(artist: string, title: string): Promise<SpotifyTrackResult | null> {
  const clean = (s: string) => s.replace(/"/g, "").trim();
  const a = clean(artist);
  const t = clean(title);
  if (!t) return null;

  // Popularity can rank a live take, a remix or a karaoke cover above the
  // studio recording (e.g. "Enter Sandman" by Metallica -> an instrumental
  // karaoke track). Skip those variants unless the row itself asked for one.
  const VARIANT = /\b(live|ao vivo|remix|mix|acoustic|ac[uú]stico|instrumental|karaoke|cover|version|demo|edit|sped up|slowed)\b/i;
  const wantsVariant = VARIANT.test(t);
  const pick = (items: SpotifyFullTrack[]) =>
    (wantsVariant ? items[0] : items.find((item) => !VARIANT.test(`${item.name} ${item.album.name} ${item.artists.map((x) => x.name).join(" ")}`))) ?? null;

  const search = async (q: string) => {
    const params = new URLSearchParams({ q, type: "track", limit: "5" });
    const data = await spotifyGet<{ tracks: { items: SpotifyFullTrack[] } }>(`/search?${params}`);
    return pick(data.tracks.items);
  };

  const exact = await search(a ? `track:"${t}" artist:"${a}"` : `track:"${t}"`);
  if (exact) return toTrackResult(exact);
  if (!a) return null;

  const loose = await search(`${a} ${t}`);
  if (!loose) return null;
  const want = normalize(a);
  const got = loose.artists.map((x) => normalize(x.name));
  return got.some((name) => name.includes(want) || want.includes(name)) ? toTrackResult(loose) : null;
}

interface SpotifyImage {
  url: string;
  width: number | null;
}

// Smallest image that's still crisp at thumbnail size (Spotify lists images
// largest-first, typically 640/300/64px).
function thumbnail(images: SpotifyImage[]): string | null {
  return ([...images].reverse().find((img) => (img.width ?? 0) >= 64) ?? images[0])?.url ?? null;
}

// Typically 640px — sharp enough for the stage's full-screen background.
function largest(images: SpotifyImage[]): string | null {
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

export interface SpotifyAlbumResult {
  id: string;
  name: string;
  artist: string;
  year: string;
  totalTracks: number;
  imageUrl: string | null;
}

export interface SpotifyArtistResult {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface SpotifySearchResults {
  tracks: SpotifyTrackResult[];
  albums: SpotifyAlbumResult[];
  artists: SpotifyArtistResult[];
}

// One search across song, album and artist names. A track link resolves to
// just that track. Spotify's field filters pass straight through, so
// `artist:"Linkin Park"` narrows results to one artist — that's how the
// control panel drills into an artist. Capped at 10 per type since Spotify's
// Feb 2026 changes.
export async function searchSpotify(input: string): Promise<SpotifySearchResults> {
  const trackId = parseTrackId(input);
  if (trackId) {
    const track = await spotifyGet<SpotifyFullTrack>(`/tracks/${trackId}`);
    return { tracks: [toTrackResult(track)], albums: [], artists: [] };
  }

  const params = new URLSearchParams({ q: input, type: "track,album,artist", limit: "8" });
  const data = await spotifyGet<{
    tracks: { items: SpotifyFullTrack[] };
    albums: {
      items: { id: string; name: string; artists: SpotifyArtist[]; images: SpotifyImage[]; release_date: string; total_tracks: number }[];
    };
    artists: { items: { id: string; name: string; images: SpotifyImage[] }[] };
  }>(`/search?${params}`);

  return {
    tracks: data.tracks.items.map(toTrackResult),
    albums: data.albums.items.map((album) => ({
      id: album.id,
      name: album.name,
      artist: album.artists[0]?.name ?? "",
      year: album.release_date.slice(0, 4),
      totalTracks: album.total_tracks,
      imageUrl: thumbnail(album.images),
    })),
    artists: data.artists.items.map((artist) => ({ id: artist.id, name: artist.name, imageUrl: thumbnail(artist.images) })),
  };
}

interface Paged<T> {
  items: T[];
  next: string | null;
}

export interface SpotifyAlbumLookup {
  albumName: string;
  albumArtist: string;
  songs: { artist: string; title: string; coverUrl: string | null }[];
}

// " - 2007 Remaster" / " - Remastered 2011" suffixes are catalog metadata,
// not part of the song name, and they skew the YouTube search for it.
function cleanTrackTitle(title: string): string {
  return title.replace(/\s+-\s+[^-]*remaster[^-]*$/i, "").trim();
}

// Album link or free-text album name -> its real tracklist, in order.
// Returns null when nothing matches. Uses each track's own first artist
// rather than the album artist, so compilations and soundtracks credit the
// right performer per song.
export async function lookupSpotifyAlbum(input: string): Promise<SpotifyAlbumLookup | null> {
  const albumId = parseAlbumId(input) ?? (await searchAlbumId(input));
  if (!albumId) return null;

  const album = await spotifyGet<{ name: string; artists: SpotifyArtist[]; images: SpotifyImage[] }>(`/albums/${albumId}`);
  const albumArtist = album.artists[0]?.name ?? "";
  const coverUrl = largest(album.images);

  const tracks: SpotifyTrack[] = [];
  let next: string | null = `/albums/${albumId}/tracks?limit=50`;
  while (next) {
    const page: Paged<SpotifyTrack> = await spotifyGet<Paged<SpotifyTrack>>(next);
    tracks.push(...page.items);
    next = page.next;
  }

  return {
    albumName: album.name,
    albumArtist,
    songs: tracks.map((track) => ({
      artist: track.artists[0]?.name ?? albumArtist,
      title: cleanTrackTitle(track.name),
      coverUrl,
    })),
  };
}
