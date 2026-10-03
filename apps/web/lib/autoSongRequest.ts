import "server-only";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { searchYoutubeForAutoImport } from "@/lib/youtube";
import { findOrCreateSong } from "@/lib/songs";
import { autoSaveLyrics } from "@/lib/autoLyrics";

export interface AutoSongRequestResult {
  songId: string;
  songStatus: string;
  matchedTitle: string;
  matchedChannel: string;
  queueItemId: string | null;
}

// Shared by the single "Automatic" request (control panel search box) and
// the CSV batch import: search YouTube, take the top result, create/dedupe
// the song, best-effort attach synced lyrics, and optionally add it to the
// room's live queue when requestedBy is a real guest (omitted for batch
// imports, which should only populate the library).
//
// Throws on failure — callers decide how to surface that (HTTP status for
// the single route, a per-row error for the batch route). The message is
// used to detect specific cases (e.g. "no results" vs a YouTube quota
// error), so keep it stable rather than rewording freely.
//
// `known` is the real artist/title when the source already had them
// (Spotify, CSV). It's used to name a new song and to look up its lyrics:
// the YouTube match is usually a fan lyric-video upload whose title and
// channel ("... | Lyrics", "TRVPE [Music Lyrics]") are poor for both. Its
// `coverUrl` (Spotify album art) replaces the video's thumbnail — both in the
// lists and as the stage background.
export interface KnownSong {
  artist: string;
  title: string;
  coverUrl?: string | null;
}

export async function processAutoSongRequest(
  roomId: string,
  query: string,
  requestedBy: string | null,
  known?: KnownSong
): Promise<AutoSongRequestResult> {
  const results = await searchYoutubeForAutoImport(query);
  const top = results[0];
  if (!top) throw new Error(`No YouTube results for "${query}"`);

  const song = await findOrCreateSong(
    {
      videoId: top.videoId,
      title: known?.title ?? top.title,
      channelTitle: known?.artist ?? top.channelTitle,
      durationSeconds: top.durationSeconds,
      thumbnailUrl: known?.coverUrl ?? top.thumbnailUrl,
    },
    roomId,
    requestedBy
  );

  // A song that already existed keeps its row, so give it the cover too if
  // it still has a YouTube image (never overrides one already set from
  // Spotify or elsewhere).
  if (known?.coverUrl) {
    await createServiceRoleClient()
      .from("songs")
      .update({ thumbnail_url: known.coverUrl })
      .eq("id", song.id)
      .like("thumbnail_url", "%ytimg.com%");
  }

  after(() =>
    autoSaveLyrics(
      song.id,
      top.title,
      top.channelTitle,
      top.durationSeconds,
      known ? { artist: known.artist, track: known.title } : undefined
    ).catch(() => {})
  );

  let queueItemId: string | null = null;
  if (requestedBy) {
    const supabase = createServiceRoleClient();
    const { data: queueItem } = await supabase
      .from("queue_items")
      .insert({ room_id: roomId, song_id: song.id, requested_by: requestedBy, status: "queued" })
      .select("id")
      .single();
    queueItemId = queueItem?.id ?? null;
  }

  return {
    songId: song.id,
    songStatus: song.status,
    matchedTitle: top.title,
    matchedChannel: top.channelTitle,
    queueItemId,
  };
}
