import "server-only";
import { createHash } from "node:crypto";

export type { AlignedLine, AlignedWord } from "@/lib/lrc";

// Identifies the exact lyrics a set of word timings was computed for. When
// the lyrics are replaced or their offset adjusted (tap-to-sync), the hash
// changes: the stored timings stop being served and the worker re-aligns.
export function lyricsHash(rawLrc: string, offsetMs: number): string {
  return createHash("sha1").update(`${rawLrc}\n${offsetMs}`).digest("hex");
}

// Synced (timestamped) lyrics only — plain lyrics have no line times to align.
export function isSyncedLrc(rawLrc: string | null): rawLrc is string {
  return !!rawLrc && /\[\d+:\d+(?:\.\d+)?\]/.test(rawLrc);
}
