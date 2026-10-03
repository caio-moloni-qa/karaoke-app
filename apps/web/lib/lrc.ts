export interface LrcLine {
  timeMs: number;
  text: string;
  // Identifies the line for word-timing lookup. Equal to the parsed time;
  // kept separately because a repeated line's timeMs is later replaced by
  // its aligned start (see applyAlignedStarts).
  key: number;
  // Set on lines expanded from a repeat marker ("Go away (x8)" -> 8 lines).
  repeat?: { index: number; count: number };
}

// Per-word timing for a line, from the worker's forced alignment against the
// vocal stems (apps/worker/pipeline/align.py). `t` matches the line's key;
// word times are on the same LRC timeline as line times.
export interface AlignedWord {
  w: string;
  s: number;
  e: number;
}

export interface AlignedLine {
  t: number;
  words: AlignedWord[];
}

// Lyrics sites shorten repeated lines: "Go away (x8)", "(×8)", "(8x)",
// "[x8]", or a bare trailing "x8". The count is capped so a stray number
// can't explode one line into hundreds.
const REPEAT_MARKER = /\s*[(\[]\s*(?:[x×]\s*(\d{1,2})|(\d{1,2})\s*[x×])\s*[)\]]\s*$|\s+[x×](\d{1,2})\s*$/i;
const MAX_REPEAT = 16;
// Time assumed per repetition when a repeated line is the last one.
const MS_PER_CHAR = 110;
const MIN_LINE_MS = 1500;

function repeatCount(text: string): { text: string; count: number } | null {
  const match = REPEAT_MARKER.exec(text);
  const count = match ? Number(match[1] ?? match[2] ?? match[3]) : 0;
  if (!match || count < 2 || count > MAX_REPEAT) return null;
  return { text: text.slice(0, match.index).trim(), count };
}

// Parses standard LRC ([mm:ss.xx]text per line; a line may carry multiple
// timestamp tags for repeated sections). Shared between the editor
// (server-fetched search results) and the stage page (client playback).
//
// A line with a repeat marker becomes one line per repetition, evenly spaced
// until the next line as a first guess (the worker's alignment then finds
// each repetition's real start). apps/worker/pipeline/align.py mirrors this
// exactly — same times — since those times are what word timings are keyed by.
export function parseLrc(lrc: string): LrcLine[] {
  const parsed: { timeMs: number; text: string }[] = [];
  const tagRe = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const rawLine of lrc.split("\n")) {
    const tags = [...rawLine.matchAll(tagRe)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(tagRe, "").trim();
    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      parsed.push({ timeMs: Math.round((minutes * 60 + seconds) * 1000), text });
    }
  }
  parsed.sort((a, b) => a.timeMs - b.timeMs);

  const lines: LrcLine[] = [];
  parsed.forEach((line, i) => {
    const repeat = repeatCount(line.text);
    if (!repeat) {
      lines.push({ timeMs: line.timeMs, text: line.text, key: line.timeMs });
      return;
    }
    const next = parsed.slice(i + 1).find((l) => l.timeMs > line.timeMs);
    const perRepeat = Math.max(MIN_LINE_MS, repeat.text.length * MS_PER_CHAR);
    const span = (next ? next.timeMs : line.timeMs + perRepeat * repeat.count) - line.timeMs;
    for (let k = 0; k < repeat.count; k++) {
      const timeMs = line.timeMs + Math.floor((k * span) / repeat.count);
      lines.push({ timeMs, text: repeat.text, key: timeMs, repeat: { index: k, count: repeat.count } });
    }
  });
  return lines;
}

// How early a line lights up before its first sung word.
const LEAD_MS = 300;

// Repeated lines get evenly spaced guesses from parseLrc; with word timings,
// each one starts just before its first sung word instead, so every
// repetition highlights when it's actually sung. Other lines keep their LRC
// time. Never moves a line before the one above it.
export function applyAlignedStarts(lines: LrcLine[], aligned: AlignedLine[]): LrcLine[] {
  const wordsByKey = new Map(aligned.map((line) => [line.t, line.words]));
  let previous = -Infinity;
  return lines.map((line) => {
    const words = line.repeat ? wordsByKey.get(line.key) : undefined;
    const timeMs = words?.length ? Math.max(previous, words[0].s - LEAD_MS) : line.timeMs;
    previous = timeMs;
    return { ...line, timeMs };
  });
}

export function currentLineIndex(lines: LrcLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) index = i;
    else break;
  }
  return index;
}
