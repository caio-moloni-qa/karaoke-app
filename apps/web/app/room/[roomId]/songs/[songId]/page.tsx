"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Image as ImageIcon, Mic2, SlidersHorizontal, Video } from "lucide-react";
import { currentLineIndex, parseLrc } from "@/lib/lrc";
import type { StemType } from "@/lib/types";
import { Button } from "@/components/Button";

interface SongData {
  song: { id: string; title: string; artist_guess: string | null; thumbnail_url: string | null };
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
  const [lyricsSearching, setLyricsSearching] = useState(false);
  const [selectedLrc, setSelectedLrc] = useState<string | null>(null);
  const [selectedLrclibId, setSelectedLrclibId] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [lyricsSaving, setLyricsSaving] = useState(false);

  const [artQuery, setArtQuery] = useState("");
  const [artResults, setArtResults] = useState<ItunesResult[]>([]);
  const [artSearching, setArtSearching] = useState(false);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [blur, setBlur] = useState(16);
  const [opacity, setOpacity] = useState(55);
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
    setLyricsSearching(true);
    try {
      const res = await fetch(
        `/api/lrclib/search?title=${encodeURIComponent(title.trim())}${artist ? `&artist=${encodeURIComponent(artist)}` : ""}`
      );
      const json = await res.json();
      setLyricsResults(json.results ?? []);
    } finally {
      setLyricsSearching(false);
    }
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
    setArtSearching(true);
    try {
      const res = await fetch(`/api/itunes/search?q=${encodeURIComponent(artQuery)}`);
      const json = await res.json();
      setArtResults(json.results ?? []);
    } finally {
      setArtSearching(false);
    }
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
    return <main className="min-h-screen bg-background" />;
  }

  const previewLines = selectedLrc ? parseLrc(selectedLrc) : [];
  const artChoices = [
    ...(data.song.thumbnail_url ? [{ trackName: "Miniatura do YouTube", artistName: "", artworkUrl: data.song.thumbnail_url }] : []),
    ...artResults,
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-5 py-8">
      <header className="flex flex-col gap-3">
        <a
          href={`/room/${roomId}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para a sala
        </a>
        <div>
          <h1 className="text-xl font-semibold">{data.song.title}</h1>
          {data.song.artist_guess && <p className="text-muted">{data.song.artist_guess}</p>}
        </div>
        {data.stems.instrumental && (
          <audio ref={previewRef} src={data.stems.instrumental} controls onTimeUpdate={onPreviewTimeUpdate} className="w-full" />
        )}
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Mic2 className="h-4 w-4" /> Letra (LRCLIB)
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent"
            value={lyricsQuery}
            onChange={(e) => setLyricsQuery(e.target.value)}
            placeholder="Título - Artista"
            onKeyDown={(e) => e.key === "Enter" && searchLyrics()}
          />
          <Button variant="secondary" loading={lyricsSearching} onClick={searchLyrics}>
            Buscar
          </Button>
        </div>
        {lyricsResults.length > 0 && (
          <ul className="flex flex-col gap-2">
            {lyricsResults.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {r.trackName} — {r.artistName} ({formatDuration(r.duration)})
                  {!r.syncedLyrics && <span className="text-muted"> · sem timestamps</span>}
                </span>
                <Button variant="secondary" className="shrink-0 px-3 py-1 text-xs" onClick={() => pickLyrics(r)}>
                  usar
                </Button>
              </li>
            ))}
          </ul>
        )}

        {selectedLrc && (
          <div className="flex flex-col gap-3 rounded-xl bg-background p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-muted">Offset (ms)</label>
              <input
                type="number"
                className="w-24 rounded-lg border border-border bg-surface px-2 py-1"
                value={offsetMs}
                onChange={(e) => setOffsetMs(Number(e.target.value))}
              />
              <Button
                variant="secondary"
                className="text-xs"
                onClick={tapToSync}
                disabled={!data.stems.instrumental}
              >
                Tap to sync (toque o play e clique aqui na 1ª palavra)
              </Button>
            </div>

            <div className="max-h-40 overflow-y-auto text-sm">
              {previewLines.map((line, i) => (
                <p key={i} className={i === previewLineIdx ? "font-semibold text-foreground" : "text-muted"}>
                  {line.text || "…"}
                </p>
              ))}
            </div>

            <Button loading={lyricsSaving} onClick={saveLyrics} className="self-start">
              Salvar letra
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <ImageIcon className="h-4 w-4" /> Arte de fundo
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent"
            value={artQuery}
            onChange={(e) => setArtQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchArt()}
          />
          <Button variant="secondary" loading={artSearching} onClick={searchArt}>
            Buscar no iTunes
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {artChoices.map((r, i) => {
            const selected = artUrl === r.artworkUrl;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setArtUrl(r.artworkUrl)}
                className={`group relative aspect-square overflow-hidden rounded-xl transition-all ${
                  selected ? "ring-3 ring-accent" : "ring-1 ring-border hover:ring-2 hover:ring-accent/50"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- external, unsized artwork thumbnails */}
                <img src={r.artworkUrl} alt={r.trackName} className="h-full w-full object-cover" />
                {i === 0 && data.song.thumbnail_url === r.artworkUrl && (
                  <span className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                    <Video className="h-2.5 w-2.5" /> YouTube
                  </span>
                )}
                {selected && (
                  <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          {artUrl ? "Fundo selecionado — ajuste abaixo e clique em salvar." : "Nenhum fundo selecionado ainda: clique numa imagem acima."}
        </p>

        {artUrl && (
          <div className="relative h-40 w-full overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- external, unsized artwork preview */}
            <img
              src={artUrl}
              alt=""
              className="h-full w-full object-cover"
              style={{ filter: `blur(${blur}px) contrast(${contrast}%)` }}
            />
            <div className="absolute inset-0 bg-black" style={{ opacity: opacity / 100 }} />
            <p className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-white">Prévia da letra</p>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-1">
          <label className="flex items-center gap-4 text-sm">
            <span className="w-24 text-muted">Blur</span>
            <input type="range" min={0} max={30} value={blur} onChange={(e) => setBlur(Number(e.target.value))} className="flex-1 accent-accent" />
          </label>
          <label className="flex items-center gap-4 text-sm">
            <span className="w-24 text-muted">Escurecer</span>
            <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-accent" />
          </label>
          <label className="flex items-center gap-4 text-sm">
            <span className="w-24 text-muted">Contraste</span>
            <input type="range" min={50} max={150} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="flex-1 accent-accent" />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <SlidersHorizontal className="h-4 w-4" /> Mixagem padrão
        </h2>
        {(["instrumental", "lead_vocal", "backing_vocal"] as const).map((type) => (
          <label key={type} className="flex items-center gap-4 text-sm">
            <span className="w-32 text-muted">
              {type === "instrumental" ? "Instrumental" : type === "lead_vocal" ? "Vocal principal" : "Backing vocal"}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={mixVols[type]}
              onChange={(e) => setMixVols((prev) => ({ ...prev, [type]: Number(e.target.value) }))}
              className="flex-1 accent-accent"
            />
            <span className="w-9 text-right text-xs tabular-nums text-muted">{mixVols[type]}%</span>
          </label>
        ))}

        <Button loading={displaySaving} onClick={saveDisplaySettings} className="self-start">
          Salvar exibição
        </Button>
      </section>
    </main>
  );
}
