"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

// The worker upserts its heartbeat on every poll cycle (see
// /api/worker/jobs/claim); "online" just means that heartbeat is recent.
// Needs its own tick timer (not just a refetch) since staleness must be
// recomputed even when the underlying row hasn't changed.
export function useWorkerOnline(staleAfterMs = 15000) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    async function check() {
      const { data } = await supabase
        .from("workers")
        .select("last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastSeenAt(data ? new Date(data.last_seen_at).getTime() : null);
    }
    check();
    const dataInterval = setInterval(check, 5000);
    const tickInterval = setInterval(() => setNow(Date.now()), 2000);
    return () => {
      clearInterval(dataInterval);
      clearInterval(tickInterval);
    };
  }, [supabase]);

  return lastSeenAt !== null && now - lastSeenAt < staleAfterMs;
}
