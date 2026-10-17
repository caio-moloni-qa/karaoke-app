export interface LrcLine {
  timeMs: number;
  text: string;
  // Identifies the line for word-timing lookup. Equal to the parsed time;
  // kept separately because a repeated line's timeMs is later replaced by
  // its aligned start (see applyAlignedStarts).
  key: number;
  // Set on lines expanded from a repeat marker ("Go away (x8)" -> 8 lines).
  repeat?: { index: number; count: number };
  // A backing-vocal line sung at the same time as this one: shown together,
  // under it, both filling on their own timing (see groupConcurrentLines).
  companion?: LrcLine;
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

// With long, slurred singing (e.g. Deftones' "Be Quiet and Drive") the
// aligner can't find word boundaries and stretches single words over
// several seconds. A word that long anywhere but the end of a line (where a
// held note is normal) means the line's word timings can't be trusted: it
// keeps its LRC time and fills as a whole line.
const MAX_WORD_MS = 2500;

export function reliableWords(words: AlignedWord[] | undefined): AlignedWord[] | undefined {
  if (!words?.length) return undefined;
  return words.slice(0, -1).some((word) => word.e - word.s > MAX_WORD_MS) ? undefined : words;
}

// How early a line lights up before its first sung word.
const LEAD_MS = 300;

// Lyrics sites' line times are hand-made and often off by a second or more
// (Decode's first line is sung 2 s before its timestamp, which also threw off
// the 3-2-1 countdown). With trustworthy word timings, every line starts just
// before its first sung word instead — repeated lines too, whose parseLrc
// times are only evenly spaced guesses. Other lines keep their LRC time.
// Never moves a line before the one above it.
export function applyAlignedStarts(lines: LrcLine[], aligned: AlignedLine[]): LrcLine[] {
  const wordsByKey = new Map(aligned.map((line) => [line.t, line.words]));
  let previous = -Infinity;
  return lines.map((line) => {
    const words = reliableWords(wordsByKey.get(line.key));
    const timeMs = Math.max(previous, words ? words[0].s - LEAD_MS : line.timeMs);
    previous = timeMs;
    return { ...line, timeMs };
  });
}

// A line written fully in parentheses: the usual way lyrics mark a backing
// vocal. Same rule as apps/worker/pipeline/align.py, which aligns these on
// the backing stem so they can overlap the lead line in time.
export function isBackingLine(text: string): boolean {
  const stripped = text.trim();
  return stripped.length > 2 && stripped.startsWith("(") && stripped.endsWith(")");
}

// Words may start this long after the lead line's last word and still count
// as sung together (the backing usually comes in just before the lead ends).
const CONCURRENT_TOLERANCE_MS = 400;

// Lyrics list a lead line and its backing vocal one after the other, even
// when they're sung over each other. With word timings, a backing line whose
// first word comes before the lead line above it has finished is folded into
// that line as its companion, so the stage shows and fills both at once.
// Backing lines sung on their own stay separate lines.
export function groupConcurrentLines(lines: LrcLine[], aligned: AlignedLine[]): LrcLine[] {
  const wordsByKey = new Map(aligned.map((line) => [line.t, line.words]));
  const rows: LrcLine[] = [];
  for (const line of lines) {
    const previous = rows[rows.length - 1];
    const words = wordsByKey.get(line.key);
    const previousWords = previous ? wordsByKey.get(previous.key) : undefined;
    const sungTogether =
      previous &&
      !previous.companion &&
      isBackingLine(line.text) &&
      !isBackingLine(previous.text) &&
      words?.length &&
      previousWords?.length &&
      words[0].s < previousWords[previousWords.length - 1].e + CONCURRENT_TOLERANCE_MS;
    if (sungTogether) rows[rows.length - 1] = { ...previous, companion: line };
    else rows.push(line);
  }
  return rows;
}

export function currentLineIndex(lines: LrcLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) index = i;
    else break;
  }
  return index;
}
