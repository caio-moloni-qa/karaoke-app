"use client";

import { useEffect, useRef } from "react";
import type { LrcLine } from "@/lib/lrc";

interface LyricsViewProps {
  lines: LrcLine[];
  currentIndex: number;
  // 3, 2, or 1 for the 3 seconds leading up to the first sung line, null
  // otherwise — a lead-in cue so singers know exactly when to come in
  // instead of guessing during a silent/instrumental intro.
  countdown?: number | null;
}

// Spotify-style synced lyrics: a scrolling column with the current line
// highlighted and auto-centered, others dimmed. Uses native scrollIntoView
// (rather than measuring line heights for a transform) so it handles
// variable-height wrapped lines for free.
export function LyricsView({ lines, currentIndex, countdown }: LyricsViewProps) {
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    if (currentIndex < 0) return;
    lineRefs.current[currentIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentIndex]);

  if (lines.length === 0) return null;

  return (
    <div
      className="relative h-72 w-full max-w-xl overflow-y-scroll [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: "linear-gradient(to bottom, transparent, black 25%, black 75%, transparent)" }}
    >
      {countdown != null && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <span key={countdown} className="animate-countdown-pop text-7xl font-bold text-accent">
            {countdown}
          </span>
        </div>
      )}
      <div className="flex flex-col items-center gap-5 py-32">
        {lines.map((line, i) => (
          <p
            key={i}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className={
              i === currentIndex
                ? "text-center text-2xl font-bold text-foreground transition-all duration-300"
                : "text-center text-lg font-semibold text-foreground/40 transition-all duration-300"
            }
          >
            {line.text || "…"}
          </p>
        ))}
      </div>
    </div>
  );
}
