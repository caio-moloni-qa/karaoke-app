"use client";

import { useEffect, useRef, useState } from "react";

interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          height: string;
          width: string;
          events?: { onReady?: () => void; onError?: (e: { data: number }) => void };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;

function loadYoutubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(script);
  });
  return apiLoadPromise;
}

const PREVIEW_ELEMENT_ID = "youtube-preview-player";
const PREVIEW_DURATION_MS = 5000;

// Plays 5s from the middle of a video — the same "confirm this is the right
// song" preview from the original inspiration. Uses a small but genuinely
// visible player rather than a 0x0 hidden one: mobile browsers are far more
// aggressive about blocking autoplay-with-sound on invisible/zero-size
// iframes (a common ad-fraud pattern), even from a direct tap.
export function useYoutubePreview() {
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewingVideoId, setPreviewingVideoId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYoutubeIframeApi().then(() => {
      // The target div only exists once past the guest-join screen; if the
      // API finishes loading before that (or the request never got past
      // this screen at all), there's nothing to attach to yet.
      if (cancelled || !window.YT || !document.getElementById(PREVIEW_ELEMENT_ID)) return;
      playerRef.current = new window.YT.Player(PREVIEW_ELEMENT_ID, {
        height: "90",
        width: "160",
        events: {
          onReady: () => (readyRef.current = true),
          // Error codes: 2 invalid param, 5 HTML5 player error, 100 not
          // found/private, 101/150 embedding disallowed by the video owner.
          onError: (e) => console.warn("[yt-preview] error code=" + e.data),
        },
      });
    });
    return () => {
      cancelled = true;
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      playerRef.current?.destroy();
    };
  }, []);

  function preview(videoId: string, durationSeconds: number) {
    if (!playerRef.current || !readyRef.current) return;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const startSeconds = Math.max(0, Math.floor(durationSeconds / 2));
    playerRef.current.loadVideoById({ videoId, startSeconds });
    playerRef.current.playVideo();
    setPreviewingVideoId(videoId);
    stopTimerRef.current = setTimeout(() => {
      playerRef.current?.pauseVideo();
      setPreviewingVideoId(null);
    }, PREVIEW_DURATION_MS);
  }

  return { preview, playerElementId: PREVIEW_ELEMENT_ID, previewingVideoId };
}
