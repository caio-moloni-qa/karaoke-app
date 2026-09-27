import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";

export interface VideoInfo {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnailUrl: string;
}

// Shared by the manual request-song route (guest picked a YouTube result)
// and the auto-provision route (server picked the top result itself):
// dedupes by youtube_video_id, creates the song + a processing job for new
// or previously-failed songs. songs/processing_jobs have no anon write
// policy, so this always runs with the service-role client.
export async function findOrCreateSong(video: VideoInfo, roomId: string, requestedBy: string | null) {
  const supabase = createServiceRoleClient();

  const song = await supabase
    .from("songs")
    .select("id, status")
    .eq("youtube_video_id", video.videoId)
    .maybeSingle()
    .then((res) => res.data);

  if (!song) {
    const { data: inserted, error } = await supabase
      .from("songs")
      .insert({
        youtube_video_id: video.videoId,
        title: video.title,
        artist_guess: video.channelTitle,
        duration_seconds: video.durationSeconds,
        thumbnail_url: video.thumbnailUrl,
        status: "queued",
      })
      .select("id, status")
      .single();

    if (error || !inserted) throw new Error("Failed to create song");

    await supabase.from("processing_jobs").insert({
      song_id: inserted.id,
      room_id: roomId,
      requested_by: requestedBy,
      status: "queued",
    });

    return inserted;
  }

  if (song.status === "failed") {
    await supabase.from("songs").update({ status: "queued" }).eq("id", song.id);
    await supabase.from("processing_jobs").insert({
      song_id: song.id,
      room_id: roomId,
      requested_by: requestedBy,
      status: "queued",
    });
  }

  return song;
}
