import "server-only";
import { createHash } from "node:crypto";

export type { AlignedLine, AlignedWord } from "@/lib/lrc";

// Identifies the exact lyrics a set of word timings was computed for. When
// the lyrics are replaced or their offset adjusted (tap-to-sync), the hash
// changes: the stored timings stop being served and the worker re-aligns.
// Bump when apps/worker/pipeline/align.py changes how it aligns: every song's
// stored timings then count as stale and the worker re-aligns the library.
// v2: backing-vocal lines aligned on the backing stem, overlapping the lead.
// v3: lead lines whose singing starts before their LRC time are found there.
const ALIGNMENT_VERSION = "v3";

export function lyricsHash(rawLrc: string, offsetMs: number): string {
  return createHash("sha1").update(`${ALIGNMENT_VERSION}\n${rawLrc}\n${offsetMs}`).digest("hex");
}

// Synced (timestamped) lyrics only — plain lyrics have no line times to align.
export function isSyncedLrc(rawLrc: string | null): rawLrc is string {
  return !!rawLrc && /\[\d+:\d+(?:\.\d+)?\]/.test(rawLrc);
}
