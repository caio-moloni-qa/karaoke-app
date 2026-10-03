"use client";

import { useState } from "react";
import { ChevronDown, Guitar, Mic, MicOff, Minus, Plus, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import type { StemType } from "@/lib/types";

interface Track {
  type: StemType;
  label: string;
  value: number; // 0-MAX_VOLUME, retained even while muted
  muted: boolean;
}

interface MixerPanelProps {
  tracks: Track[];
  onVolumeChange: (type: StemType, value: number) => void;
  onToggleMute: (type: StemType) => void;
  // Karaoke mode = the lead vocal muted, so the singer replaces it.
  karaoke: boolean;
  onToggleKaraoke: () => void;
}

const STEP = 10;
// Above 100% boosts a stem past its original level (e.g. a quiet lead
// vocal); capped there because larger boosts start to distort.
const MAX_VOLUME = 150;

function TrackIcon({ type, className = "h-4 w-4" }: { type: StemType; className?: string }) {
  if (type === "instrumental") return <Guitar className={className} />;
  if (type === "backing_vocal") {
    // A second microphone: the mic with a small "2".
    return (
      <span className="relative inline-flex">
        <Mic className={className} />
        <span className="absolute -bottom-1 -right-1.5 text-[9px] font-bold leading-none">2</span>
      </span>
    );
  }
  return <Mic className={className} />;
}

// Per-stem mixer docked on the stage's left edge, below the QR code.
// Collapsed by default into a small "Faixas" button (its icons turn red for
// muted stems, so the mix state is visible without opening it); open, each
// stem gets mute, step down and step up.
export function MixerPanel({ tracks, onVolumeChange, onToggleMute, karaoke, onToggleKaraoke }: MixerPanelProps) {
  const [open, setOpen] = useState(false);
  const step = (track: Track, delta: number) =>
    onVolumeChange(track.type, Math.min(MAX_VOLUME, Math.max(0, track.value + delta)));

  return (
    <div className="fixed left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-3 rounded-2xl bg-surface/90 p-2 shadow-lg backdrop-blur">
      <button
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-white/5 hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Fechar configuração das faixas" : "Abrir configuração das faixas"}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Faixas
        {!open && (
          <span className="flex items-center gap-1.5">
            {tracks.map((track) => (
              <span key={track.type} className={track.muted ? "text-danger" : "text-foreground"} title={track.label}>
                <TrackIcon type={track.type} className="h-3.5 w-3.5" />
              </span>
            ))}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <button
          role="switch"
          aria-checked={karaoke}
          onClick={onToggleKaraoke}
          className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-white/5"
        >
          <span className="flex items-center gap-1.5">
            <MicOff className={`h-4 w-4 ${karaoke ? "text-accent" : "text-muted"}`} />
            Modo karaokê
          </span>
          <span
            className={`relative h-5 w-9 rounded-full transition-colors ${
              karaoke ? "bg-gradient-to-r from-accent to-accent-2" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${karaoke ? "left-[1.125rem]" : "left-0.5"}`}
            />
          </span>
        </button>
      )}

      {open &&
        tracks.map((track) => (
          <div key={track.type} className="flex flex-col gap-1.5 px-1">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <TrackIcon type={track.type} className="h-3.5 w-3.5" />
              {track.label}
            </span>
            <div className="flex items-center gap-1">
              <button
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  track.muted ? "bg-danger/20 text-danger" : "bg-white/5 text-foreground hover:bg-white/10"
                }`}
                onClick={() => onToggleMute(track.type)}
                aria-label={track.muted ? `Ativar ${track.label}` : `Silenciar ${track.label}`}
                aria-pressed={track.muted}
              >
                {track.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-foreground transition-colors hover:bg-white/10 disabled:opacity-30"
                onClick={() => step(track, -STEP)}
                disabled={track.value <= 0}
                aria-label={`Diminuir ${track.label}`}
              >
                <Minus className="h-4 w-4" />
              </button>
              <span
                className={`w-11 text-center text-xs font-semibold tabular-nums ${
                  track.muted ? "text-muted line-through" : track.value > 100 ? "text-accent" : "text-foreground"
                }`}
              >
                {track.value}%
              </span>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-foreground transition-colors hover:bg-white/10 disabled:opacity-30"
                onClick={() => step(track, STEP)}
                disabled={track.value >= MAX_VOLUME}
                aria-label={`Aumentar ${track.label}`}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
