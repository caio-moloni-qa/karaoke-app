#!/usr/bin/env node
// Moves the processed-audio library to another folder (e.g. an external HD)
// and points the app at it.
//
//   node scripts/move-library.mjs "E:\Karaoke"            copy, verify, switch
//   node scripts/move-library.mjs "E:\Karaoke" --dry-run  just report
//
// Copies rather than moves: the old folder is left in place and its path is
// printed at the end, to delete by hand once the new location checks out.
// Run it with the app stopped, so the worker can't save a song into the old
// folder mid-copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, "apps", "web", ".env.local");
const DEFAULT_DIR = path.join(ROOT, "apps", "worker", "storage");

const [targetArg, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!targetArg) {
  console.error('Usage: node scripts/move-library.mjs "<new folder>" [--dry-run]');
  process.exit(1);
}

function readEnv() {
  return fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
}

function currentDir(envText) {
  const line = envText.split(/\r?\n/).find((l) => l.startsWith("STEMS_STORAGE_DIR="));
  const value = line?.slice("STEMS_STORAGE_DIR=".length).trim();
  return value ? path.resolve(value) : DEFAULT_DIR;
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

const envText = readEnv();
const source = currentDir(envText);
const target = path.resolve(targetArg);

if (!fs.existsSync(source)) {
  console.error(`Current library folder not found: ${source}`);
  process.exit(1);
}
if (target === source) {
  console.error("That's already the library folder.");
  process.exit(1);
}
if (target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) {
  console.error("The new folder can't be inside the current one (or the other way around).");
  process.exit(1);
}

const files = listFiles(source);
const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(source, f)).size, 0);
console.log(`From: ${source}`);
console.log(`To:   ${target}`);
console.log(`${files.length} files, ${(bytes / 1024 ** 3).toFixed(2)} GB`);
if (dryRun) {
  console.log("Dry run — nothing copied.");
  process.exit(0);
}

let copied = 0;
for (const rel of files) {
  const from = path.join(source, rel);
  const to = path.join(target, rel);
  // Resumable: a file already there with the same size was copied by an
  // earlier, interrupted run.
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
  if (copied % 20 === 0) console.log(`  copied ${copied} files…`);
}

const mismatched = files.filter((rel) => {
  const to = path.join(target, rel);
  return !fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(path.join(source, rel)).size;
});
if (mismatched.length > 0) {
  console.error(`Verification failed for ${mismatched.length} file(s), e.g. ${mismatched[0]}. Settings not changed.`);
  process.exit(1);
}
console.log(`Verified all ${files.length} files.`);

const line = `STEMS_STORAGE_DIR=${target}`;
const updated = /^STEMS_STORAGE_DIR=.*$/m.test(envText)
  ? envText.replace(/^STEMS_STORAGE_DIR=.*$/m, line)
  : `${envText.replace(/\s*$/, "")}\n\n# Processed-audio library (see scripts/move-library.mjs)\n${line}\n`;
fs.writeFileSync(ENV_FILE, updated);

console.log(`\nApp now points at ${target} (apps/web/.env.local).`);
console.log("Restart the web app and the worker to pick it up.");
console.log(`The old copy is still at ${source} — delete it once everything plays fine.`);
