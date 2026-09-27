"use client";

import { useEffect, useRef } from "react";

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
        options: { height: string; width: string; events?: { onReady?: () => void } }
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
// song" preview from the original inspiration — via a 0x0 IFrame player.
export function useYoutubePreview() {
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYoutubeIframeApi().then(() => {
      if (cancelled || !window.YT) return;
      playerRef.current = new window.YT.Player(PREVIEW_ELEMENT_ID, {
        height: "0",
        width: "0",
        events: { onReady: () => (readyRef.current = true) },
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
    stopTimerRef.current = setTimeout(() => playerRef.current?.pauseVideo(), PREVIEW_DURATION_MS);
  }

  return { preview, playerElementId: PREVIEW_ELEMENT_ID };
}
