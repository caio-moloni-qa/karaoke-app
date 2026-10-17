#!/usr/bin/env node
// Lists the lyrics-sync check of every song in the library: the verdict the
// worker stores after aligning each song's lyrics (apps/worker/pipeline/
// sync_check.py). Works like a test run: exits with code 1 when any song
// needs a look.
//
//   node scripts/sync-report.mjs          problems only
//   node scripts/sync-report.mjs --all    every song
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, "apps", "web", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()])
);
const showAll = process.argv.includes("--all");

const key = env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/songs?status=eq.ready&select=title,artist_guess,lyrics(raw_lrc,sync_check)&order=title`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }
);
if (!res.ok) {
  console.error(`Couldn't read the library (${res.status}). Is the app running?`);
  // exitCode rather than process.exit(): exiting while fetch's sockets are
  // still closing trips a libuv assertion on Windows.
  process.exitCode = 2;
}

const counts = { ok: 0, warn: 0, fail: 0, pending: 0, none: 0 };
for (const song of res.ok ? await res.json() : []) {
  const lyrics = Array.isArray(song.lyrics) ? song.lyrics[0] : song.lyrics;
  const name = `${song.artist_guess ?? "?"} - ${song.title}`;
  if (!lyrics?.raw_lrc || !/\[\d+:\d+/.test(lyrics.raw_lrc)) {
    counts.none++;
    if (showAll) console.log(`  --    ${name} (no synced lyrics)`);
    continue;
  }
  const check = lyrics.sync_check;
  if (!check) {
    counts.pending++;
    if (showAll) console.log(`  ..    ${name} (not checked yet)`);
    continue;
  }
  counts[check.status]++;
  if (check.status === "ok") {
    if (showAll) console.log(`  OK    ${name}`);
    continue;
  }
  console.log(`  ${check.status.toUpperCase().padEnd(5)} ${name}`);
  for (const issue of check.issues) {
    console.log(`          - ${issue.message}`);
    for (const line of issue.lines ?? []) console.log(`              ${line}`);
  }
}

if (res.ok) {
  console.log(
    `\n${counts.ok} ok, ${counts.warn} warn, ${counts.fail} fail` +
      (counts.pending ? `, ${counts.pending} not checked yet (the worker checks them while idle)` : "") +
      (counts.none ? `, ${counts.none} without synced lyrics` : "")
  );
  process.exitCode = counts.warn || counts.fail ? 1 : 0;
}
