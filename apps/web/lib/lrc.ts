export interface LrcLine {
  timeMs: number;
  text: string;
}

// Parses standard LRC ([mm:ss.xx]text per line; a line may carry multiple
// timestamp tags for repeated sections). Shared between the editor
// (server-fetched search results) and the stage page (client playback).
export function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const tagRe = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const rawLine of lrc.split("\n")) {
    const tags = [...rawLine.matchAll(tagRe)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(tagRe, "").trim();
    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      lines.push({ timeMs: Math.round((minutes * 60 + seconds) * 1000), text });
    }
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export function currentLineIndex(lines: LrcLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) index = i;
    else break;
  }
  return index;
}
