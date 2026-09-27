import "server-only";

export interface YoutubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number;
}

// "PT4M13S" -> 253
function parseIso8601Duration(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

export async function searchYoutube(query: string): Promise<YoutubeSearchResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured");

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("maxResults", "5");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`YouTube search failed: ${searchRes.status}`);
  const searchData = await searchRes.json();

  const videoIds: string[] = searchData.items?.map((item: { id: { videoId: string } }) => item.id.videoId) ?? [];
  if (videoIds.length === 0) return [];

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,contentDetails");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);

  const videosRes = await fetch(videosUrl);
  if (!videosRes.ok) throw new Error(`YouTube videos lookup failed: ${videosRes.status}`);
  const videosData = await videosRes.json();

  interface VideoItem {
    id: string;
    snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string }; default?: { url: string } } };
    contentDetails: { duration: string };
  }

  return (videosData.items as VideoItem[]).map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? "",
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
  }));
}
