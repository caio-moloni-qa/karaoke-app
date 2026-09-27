"use client";

import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { StemType } from "@/lib/types";

interface Track {
  type: StemType;
  label: string;
  value: number; // 0-100, retained even while muted
  muted: boolean;
}

interface MixerPanelProps {
  tracks: Track[];
  onVolumeChange: (type: StemType, value: number) => void;
  onToggleMute: (type: StemType) => void;
}

export function MixerPanel({ tracks, onVolumeChange, onToggleMute }: MixerPanelProps) {
  const [openType, setOpenType] = useState<StemType | null>(null);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-xl items-start justify-center gap-10 px-6 py-4">
        {tracks.map((track) => (
          <div key={track.type} className="relative flex flex-col items-center gap-2">
            {openType === track.type && (
              <>
                {/* Click-outside-to-close backdrop */}
                <button
                  className="fixed inset-0 z-10 cursor-default"
                  aria-label="Fechar controle de volume"
                  onClick={() => setOpenType(null)}
                />
                <div className="absolute bottom-full z-20 mb-3 flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
                  <span className="text-sm font-semibold tabular-nums">{track.value}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={track.value}
                    onChange={(e) => onVolumeChange(track.type, Number(e.target.value))}
                    className="h-28 w-2 accent-accent [writing-mode:vertical-lr]"
                    style={{ direction: "rtl" }}
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-1.5">
              <button
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                  track.muted ? "bg-danger/20 text-danger" : "bg-white/5 text-foreground hover:bg-white/10"
                }`}
                onClick={() => onToggleMute(track.type)}
                aria-label={track.muted ? `Ativar ${track.label}` : `Silenciar ${track.label}`}
                aria-pressed={!track.muted}
              >
                {track.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                className="rounded-full bg-white/5 px-2.5 py-1.5 text-xs font-medium tabular-nums text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                onClick={() => setOpenType(openType === track.type ? null : track.type)}
              >
                {track.value}%
              </button>
            </div>
            <span className="text-[11px] text-muted">{track.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
