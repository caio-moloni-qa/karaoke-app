"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { currentLineIndex, parseLrc } from "@/lib/lrc";
import type { StemType } from "@/lib/types";

interface SongData {
  song: { id: string; title: string; artist_guess: string | null };
  stems: Partial<Record<StemType, string>>;
  lyrics: { raw_lrc: string | null; offset_ms: number } | null;
  displaySettings: {
    art_url: string | null;
    blur: number;
    opacity: number;
    contrast: number;
    mix_instrumental_vol: number;
    mix_lead_vol: number;
    mix_backing_vol: number;
  } | null;
}

interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

interface ItunesResult {
  trackName: string;
  artistName: string;
  artworkUrl: string;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SongEditorPage() {
  const { roomId, songId } = useParams<{ roomId: string; songId: string }>();

  const [data, setData] = useState<SongData | null>(null);

  const [lyricsQuery, setLyricsQuery] = useState("");
  const [lyricsResults, setLyricsResults] = useState<LrclibResult[]>([]);
  const [selectedLrc, setSelectedLrc] = useState<string | null>(null);
  const [selectedLrclibId, setSelectedLrclibId] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [lyricsSaving, setLyricsSaving] = useState(false);

  const [artQuery, setArtQuery] = useState("");
  const [artResults, setArtResults] = useState<ItunesResult[]>([]);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [blur, setBlur] = useState(0);
  const [opacity, setOpacity] = useState(60);
  const [contrast, setContrast] = useState(100);
  const [mixVols, setMixVols] = useState({ instrumental: 100, lead_vocal: 100, backing_vocal: 100 });
  const [displaySaving, setDisplaySaving] = useState(false);

  const previewRef = useRef<HTMLAudioElement>(null);
  const [previewLineIdx, setPreviewLineIdx] = useState(-1);

  useEffect(() => {
    fetch(`/api/songs/${songId}`)
      .then((res) => res.json())
      .then((d: SongData) => {
        setData(d);
        setLyricsQuery(d.song.title + (d.song.artist_guess ? ` ${d.song.artist_guess}` : ""));
        setArtQuery(d.song.title + (d.song.artist_guess ? ` ${d.song.artist_guess}` : ""));
        if (d.lyrics?.raw_lrc) {
          setSelectedLrc(d.lyrics.raw_lrc);
          setOffsetMs(d.lyrics.offset_ms);
        }
        if (d.displaySettings) {
          setArtUrl(d.displaySettings.art_url);
          setBlur(d.displaySettings.blur);
          setOpacity(Math.round(d.displaySettings.opacity * 100));
          setContrast(Math.round(d.displaySettings.contrast * 100));
          setMixVols({
            instrumental: Math.round(d.displaySettings.mix_instrumental_vol * 100),
            lead_vocal: Math.round(d.displaySettings.mix_lead_vol * 100),
            backing_vocal: Math.round(d.displaySettings.mix_backing_vol * 100),
          });
        }
      });
  }, [songId]);

  async function searchLyrics() {
    const [title, ...artistParts] = lyricsQuery.split(" - ");
    const artist = artistParts.join(" - ") || data?.song.artist_guess || undefined;
    const res = await fetch(
      `/api/lrclib/search?title=${encodeURIComponent(title.trim())}${artist ? `&artist=${encodeURIComponent(artist)}` : ""}`
    );
    const json = await res.json();
    setLyricsResults(json.results ?? []);
  }

  function pickLyrics(result: LrclibResult) {
    const lrc = result.syncedLyrics ?? result.plainLyrics;
    if (!lrc) return;
    setSelectedLrc(lrc);
    setSelectedLrclibId(String(result.id));
    setOffsetMs(0);
  }

  function tapToSync() {
    if (!previewRef.current || !selectedLrc) return;
    const lines = parseLrc(selectedLrc);
    if (lines.length === 0) return;
    const nowMs = previewRef.current.currentTime * 1000;
    setOffsetMs(Math.round(nowMs - lines[0].timeMs));
  }

  const onPreviewTimeUpdate = useCallback(() => {
    if (!previewRef.current || !selectedLrc) return;
    const lines = parseLrc(selectedLrc);
    const positionMs = previewRef.current.currentTime * 1000 - offsetMs;
    setPreviewLineIdx(currentLineIndex(lines, positionMs));
  }, [selectedLrc, offsetMs]);

  async function saveLyrics() {
    if (!selectedLrc) return;
    setLyricsSaving(true);
    try {
      await fetch(`/api/songs/${songId}/lyrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lrclibId: selectedLrclibId, rawLrc: selectedLrc, offsetMs }),
      });
    } finally {
      setLyricsSaving(false);
    }
  }

  async function searchArt() {
    const res = await fetch(`/api/itunes/search?q=${encodeURIComponent(artQuery)}`);
    const json = await res.json();
    setArtResults(json.results ?? []);
  }

  async function saveDisplaySettings() {
    setDisplaySaving(true);
    try {
      await fetch(`/api/songs/${songId}/display-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artUrl,
          blur,
          opacity: opacity / 100,
          contrast: contrast / 100,
          mixInstrumentalVol: mixVols.instrumental / 100,
          mixLeadVol: mixVols.lead_vocal / 100,
          mixBackingVol: mixVols.backing_vocal / 100,
        }),
      });
    } finally {
      setDisplaySaving(false);
    }
  }

  if (!data) {
    return <main className="min-h-screen" />;
  }

  const previewLines = selectedLrc ? parseLrc(selectedLrc) : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-8">
      <header>
        <a href={`/room/${roomId}`} className="text-sm text-zinc-500 underline">
          ← voltar para a sala
        </a>
        <h1 className="text-xl font-semibold">{data.song.title}</h1>
        {data.song.artist_guess && <p className="text-zinc-500">{data.song.artist_guess}</p>}
      </header>

      {data.stems.instrumental && (
        <audio
          ref={previewRef}
          src={data.stems.instrumental}
          controls
          onTimeUpdate={onPreviewTimeUpdate}
          className="w-full"
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Letra (LRCLIB)</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-black/20 px-3 py-2 dark:border-white/20"
            value={lyricsQuery}
            onChange={(e) => setLyricsQuery(e.target.value)}
            placeholder="Título - Artista"
          />
          <button className="rounded bg-foreground px-4 py-2 text-sm text-background" onClick={searchLyrics}>
            Buscar
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {lyricsResults.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            >
              <span>
                {r.trackName} — {r.artistName} ({formatDuration(r.duration)})
                {!r.syncedLyrics && <span className="text-zinc-500"> · sem timestamps</span>}
              </span>
              <button
                className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20"
                onClick={() => pickLyrics(r)}
              >
                usar
              </button>
            </li>
          ))}
        </ul>

        {selectedLrc && (
          <div className="flex flex-col gap-3 rounded border border-black/10 p-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <label className="text-sm text-zinc-500">Offset (ms)</label>
              <input
                type="number"
                className="w-24 rounded border border-black/20 px-2 py-1 dark:border-white/20"
                value={offsetMs}
                onChange={(e) => setOffsetMs(Number(e.target.value))}
              />
              <button
                className="rounded border border-black/20 px-3 py-1 text-xs dark:border-white/20"
                onClick={tapToSync}
                disabled={!data.stems.instrumental}
              >
                Tap to sync (toque no play e clique aqui na 1ª palavra)
              </button>
            </div>

            <div className="max-h-40 overflow-y-auto text-sm">
              {previewLines.map((line, i) => (
                <p key={i} className={i === previewLineIdx ? "font-semibold text-foreground" : "text-zinc-500"}>
                  {line.text || "…"}
                </p>
              ))}
            </div>

            <button
              className="self-start rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
              onClick={saveLyrics}
              disabled={lyricsSaving}
            >
              {lyricsSaving ? "Salvando…" : "Salvar letra"}
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Arte de fundo (iTunes)</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-black/20 px-3 py-2 dark:border-white/20"
            value={artQuery}
            onChange={(e) => setArtQuery(e.target.value)}
          />
          <button className="rounded bg-foreground px-4 py-2 text-sm text-background" onClick={searchArt}>
            Buscar
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {artResults.map((r, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- external, unsized artwork thumbnails
            <img
              key={i}
              src={r.artworkUrl}
              alt={r.trackName}
              className={`aspect-square cursor-pointer rounded object-cover ${artUrl === r.artworkUrl ? "ring-2 ring-foreground" : ""}`}
              onClick={() => setArtUrl(r.artworkUrl)}
            />
          ))}
        </div>

        {artUrl && (
          <div className="relative h-40 w-full overflow-hidden rounded">
            {/* eslint-disable-next-line @next/next/no-img-element -- external, unsized artwork preview */}
            <img
              src={artUrl}
              alt=""
              className="h-full w-full object-cover"
              style={{ filter: `blur(${blur}px) contrast(${contrast}%)` }}
            />
            <div className="absolute inset-0 bg-black" style={{ opacity: opacity / 100 }} />
            <p className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-white">
              Prévia da letra
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-4 text-sm">
            <span className="w-32 text-zinc-500">Blur</span>
            <input type="range" min={0} max={20} value={blur} onChange={(e) => setBlur(Number(e.target.value))} className="flex-1" />
          </label>
          <label className="flex items-center gap-4 text-sm">
            <span className="w-32 text-zinc-500">Escurecer</span>
            <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1" />
          </label>
          <label className="flex items-center gap-4 text-sm">
            <span className="w-32 text-zinc-500">Contraste</span>
            <input type="range" min={50} max={150} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="flex-1" />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Mixagem padrão</h2>
        {(["instrumental", "lead_vocal", "backing_vocal"] as const).map((type) => (
          <label key={type} className="flex items-center gap-4 text-sm">
            <span className="w-32 text-zinc-500">
              {type === "instrumental" ? "Instrumental" : type === "lead_vocal" ? "Vocal principal" : "Backing vocal"}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={mixVols[type]}
              onChange={(e) => setMixVols((prev) => ({ ...prev, [type]: Number(e.target.value) }))}
              className="flex-1"
            />
          </label>
        ))}

        <button
          className="self-start rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
          onClick={saveDisplaySettings}
          disabled={displaySaving}
        >
          {displaySaving ? "Salvando…" : "Salvar exibição"}
        </button>
      </section>
    </main>
  );
}
