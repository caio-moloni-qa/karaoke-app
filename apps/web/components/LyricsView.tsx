"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { reliableWords, type AlignedLine, type AlignedWord, type LrcLine } from "@/lib/lrc";

interface LyricsViewProps {
  lines: LrcLine[];
  currentIndex: number;
  // 3, 2, or 1 for the 3 seconds leading up to the first sung line, null
  // otherwise — a lead-in cue so singers know exactly when to come in
  // instead of guessing during a silent/instrumental intro.
  countdown?: number | null;
  // Current playback position on the lyrics' timeline (offset applied), read
  // every animation frame to fill the current line progressively. Should be
  // a stable callback. Without it the current line just shows unfilled.
  getPositionMs?: () => number | null;
  // Per-word timing from the worker's alignment, matched to lines by start
  // time. Lines with it fill word by word (and hold during pauses); lines
  // without it fall back to filling the whole line at an estimated pace.
  wordTimings?: AlignedLine[];
}

// Line-level fallback: synced lyrics only carry each line's *start* time, so
// a line fills from its start toward the next line's start, capped by an
// estimate from its length (~9 characters a second, a typical singing pace)
// so an instrumental break after it doesn't make it crawl.
const MS_PER_CHAR = 110;
const MIN_LINE_MS = 1500;

function progress(position: number | null, start: number, end: number): number {
  if (position == null) return 0;
  if (end <= start) return position >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (position - start) / (end - start)));
}

// Sizes are ~80% above the original text-2xl / text-lg (current / other
// lines: +35%, then +15% twice), with the box scaled to match so as many lines
// stay visible.
// Spotify-style synced lyrics: a scrolling column with the current line
// highlighted and auto-centered, others dimmed. Uses native scrollIntoView
// (rather than measuring line heights for a transform) so it handles
// variable-height wrapped lines for free.
export function LyricsView({ lines, currentIndex, countdown, getPositionMs, wordTimings }: LyricsViewProps) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const companionRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const lineFillRef = useRef<HTMLSpanElement | null>(null);
  const wordFillRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const companionFillRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const wordsByLineTime = useMemo(
    () => new Map((wordTimings ?? []).filter((l) => l.words.length > 0).map((l) => [l.t, l.words])),
    [wordTimings]
  );
  const currentLine = lines[currentIndex];
  const currentWords = reliableWords(currentLine ? wordsByLineTime.get(currentLine.key) : undefined);
  // Backing line sung at the same time (groupConcurrentLines guarantees it
  // has word timings).
  const companionWords = reliableWords(
    currentLine?.companion ? wordsByLineTime.get(currentLine.companion.key) : undefined
  );

  useEffect(() => {
    if (currentIndex < 0) return;
    rowRefs.current[currentIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentIndex]);

  // The line being sung never wraps (a break mid-line throws the singer
  // off): it's kept on one line and, if it's still wider than the lyrics
  // area, its font shrinks just enough to fit. Re-fitted on resize.
  useLayoutEffect(() => {
    const elements = [lineRefs.current[currentIndex], companionRefs.current[currentIndex]].filter(
      (el): el is HTMLParagraphElement => !!el
    );
    if (elements.length === 0) return;
    const fit = () => {
      for (const el of elements) {
        el.style.fontSize = "";
        if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) {
          const base = parseFloat(getComputedStyle(el).fontSize);
          el.style.fontSize = `${Math.floor((base * el.clientWidth) / el.scrollWidth) - 1}px`;
        }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      for (const el of elements) el.style.fontSize = "";
    };
  }, [currentIndex, currentWords, companionWords]);

  // Updates fills through a CSS variable on each element every frame, rather
  // than through React state, so a 60fps animation doesn't re-render the
  // whole lyrics list.
  useEffect(() => {
    if (!getPositionMs || !currentLine) return;
    const setFill = (el: HTMLSpanElement | null, p: number) => el?.style.setProperty("--fill", `${(p * 100).toFixed(2)}%`);

    let tick: () => void;
    if (currentWords) {
      tick = () => {
        const position = getPositionMs();
        currentWords.forEach((word, i) => setFill(wordFillRefs.current[i], progress(position, word.s, word.e)));
        companionWords?.forEach((word, i) => setFill(companionFillRefs.current[i], progress(position, word.s, word.e)));
      };
    } else {
      const next = lines.slice(currentIndex + 1).find((l) => l.timeMs > currentLine.timeMs);
      const gap = next ? next.timeMs - currentLine.timeMs : Infinity;
      const duration = Math.min(gap, Math.max(MIN_LINE_MS, currentLine.text.length * MS_PER_CHAR));
      tick = () => setFill(lineFillRef.current, progress(getPositionMs(), currentLine.timeMs, currentLine.timeMs + duration));
    }

    let frame = 0;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [lines, currentIndex, currentLine, currentWords, companionWords, getPositionMs]);

  if (lines.length === 0) return null;

  return (
    <div
      className="relative h-[31.75rem] w-full max-w-7xl overflow-y-scroll [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: "linear-gradient(to bottom, transparent, black 25%, black 75%, transparent)" }}
    >
      {countdown != null && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span key={countdown} className="animate-countdown-pop text-7xl font-bold text-accent drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            {countdown}
          </span>
        </div>
      )}
      <div className="flex flex-col items-center gap-9 py-[14.75rem]">
        {lines.map((line, i) => {
          const current = i === currentIndex;
          return (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="flex w-full flex-col items-center gap-1"
            >
              <p
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className={
                  current
                    ? "w-full whitespace-nowrap text-center text-[2.68rem] leading-tight font-bold text-foreground transition-colors duration-300"
                    : "text-center text-[2.01rem] leading-snug font-semibold text-foreground/40 transition-colors duration-300"
                }
              >
                {!current || !line.text ? (
                  line.text || "…"
                ) : currentWords ? (
                  <FilledWords words={currentWords} refs={wordFillRefs} className="lyric-fill" />
                ) : (
                  <span ref={lineFillRef} className="lyric-fill">
                    {line.text}
                  </span>
                )}
              </p>
              {/* A backing vocal sung over this line: shown right under it,
                  a little smaller and in a lighter pink, filling on its own
                  timing. */}
              {line.companion && (
                <p
                  ref={(el) => {
                    companionRefs.current[i] = el;
                  }}
                  className={
                    current
                      ? "w-full whitespace-nowrap text-center text-[2.12rem] leading-tight font-semibold italic text-foreground transition-colors duration-300"
                      : "text-center text-[1.66rem] leading-snug font-semibold italic text-foreground/30 transition-colors duration-300"
                  }
                >
                  {current && companionWords ? (
                    <FilledWords words={companionWords} refs={companionFillRefs} className="lyric-fill lyric-fill-backing" />
                  ) : (
                    line.companion.text
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilledWords({
  words,
  refs,
  className,
}: {
  words: AlignedWord[];
  refs: React.RefObject<(HTMLSpanElement | null)[]>;
  className: string;
}) {
  return words.map((word, w) => (
    <span key={w}>
      {w > 0 && " "}
      <span
        ref={(el) => {
          refs.current[w] = el;
        }}
        className={className}
      >
        {word.w}
      </span>
    </span>
  ));
}