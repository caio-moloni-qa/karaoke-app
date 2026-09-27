"use client";

import { useEffect } from "react";

// Realtime (WebSocket) subscriptions can silently stop delivering — laptop
// sleep, tab backgrounding, a network blip — without an obvious signal to
// reconnect on. This backstops them so the UI eventually catches up without
// the user manually refreshing: a light poll, plus an immediate refetch
// whenever the tab regains focus/visibility (the most common recovery point).
export function useRealtimeFallback(refetch: () => void, intervalMs = 8000) {
  useEffect(() => {
    const interval = setInterval(refetch, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch, intervalMs]);
}
