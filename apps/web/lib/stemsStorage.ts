import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

// Where processed audio lives on the host: one folder per song
// (`<songId>/<stem>.wav`). Database rows store paths relative to it, so the
// whole library can move (e.g. to an external HD) by copying the folder and
// changing STEMS_STORAGE_DIR — see scripts/move-library.mjs.
//
// This is the single source of truth: the worker asks for it at startup via
// /api/worker/config instead of having its own setting that could disagree.
const DEFAULT_DIR = path.resolve(process.cwd(), "..", "worker", "storage");

export const STEMS_STORAGE_DIR = process.env.STEMS_STORAGE_DIR
  ? path.resolve(process.env.STEMS_STORAGE_DIR)
  : DEFAULT_DIR;

// False when the folder is gone, typically an external HD that's unplugged.
export function isStorageAvailable(): boolean {
  return existsSync(STEMS_STORAGE_DIR);
}

export function resolveStemPath(storagePath: string): string {
  // storage_path values are trusted (written by our own worker/API code,
  // never user input), but normalize defensively anyway so a malformed
  // value can't resolve outside the storage directory.
  const normalized = path.normalize(storagePath).replace(/^(\.\.[/\\])+/, "");
  return path.join(STEMS_STORAGE_DIR, normalized);
}

export function songFolder(songId: string): string {
  return path.join(STEMS_STORAGE_DIR, songId);
}
