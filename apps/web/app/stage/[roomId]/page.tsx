"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeFallback } from "@/lib/useRealtimeFallback";
import { useWorkerOnline } from "@/lib/useWorkerOnline";
import { currentLineIndex, parseLrc, type LrcLine } from "@/lib/lrc";
import { SONG_STATUS_LABEL, type QueueItemWithSong, type StemType } from "@/lib/types";

interface ArtSettings {
  url: string;
  blur: number;
  opacity: number;
  contrast: number;
}

const TRACKS: { type: StemType; label: string }[] = [
  { type: "instrumental", label: "Instrumental" },
  { type: "lead_vocal", label: "Vocal principal" },
  { type: "backing_vocal", label: "Backing vocal" },
];

interface MixerGraph {
  context: AudioContext;
  gains: Partial<Record<StemType, GainNode>>;
}

export default function StagePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const supabase = useMemo(() => createBrowserClient(), []);

  const [queue, setQueue] = useState<QueueItemWithSong[]>([]);
  const [stemUrls, setStemUrls] = useState<Partial<Record<StemType, string>>>({});
  const [volumes, setVolumes] = useState<Record<StemType, number>>({
    original: 0,
    instrumental: 100,
    lead_vocal: 100,
    backing_vocal: 100,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [lyricsLines, setLyricsLines] = useState<LrcLine[]>([]);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);
  const [currentLyricIdx, setCurrentLyricIdx] = useState(-1);
  const [artSettings, setArtSettings] = useState<ArtSettings | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const workerOnline = useWorkerOnline();

  const audioRefs = useRef<Partial<Record<StemType, HTMLAudioElement>>>({});
  const mixerRef = useRef<MixerGraph | null>(null);
  const currentSongIdRef = useRef<string | null>(null);

  const nowPlaying = queue.find((q) => q.status === "now_playing") ?? null;
  const upNext = queue.filter((q) => q.status === "queued");

  const loadQueue = useCallback(async () => {
    const { data } = await supabase
      .from("queue_items")
      .select("*, songs(id, title, artist_guess, status), guests(id, display_name)")
      .eq("room_id", roomId)
      .in("status", ["queued", "now_playing"])
      .order("added_at", { ascending: true });
    setQueue((data as QueueItemWithSong[]) ?? []);
  }, [roomId, supabase]);

  useEffect(() => {
    // Initial load + realtime subscription is the sanctioned pattern for
    // syncing with an external store; the fetch itself is async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQueue();
    const channel = supabase
      .channel(`room:${roomId}:stage`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` },
        () => loadQueue()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "songs" }, () => loadQueue())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, supabase, loadQueue]);

  useRealtimeFallback(loadQueue);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.location isn't available during SSR
    setRoomUrl(`${window.location.origin}/room/${roomId}`);
  }, [roomId]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  // Fetch signed stem URLs (+ lyrics, art, default mix) whenever the
  // now-playing song changes.
  useEffect(() => {
    if (!nowPlaying || nowPlaying.song_id === currentSongIdRef.current) return;
    currentSongIdRef.current = nowPlaying.song_id;
    setIsPlaying(false);
    setLyricsLines([]);
    setCurrentLyricIdx(-1);
    setArtSettings(null);

    fetch(`/api/songs/${nowPlaying.song_id}`)
      .then((res) => res.json())
      .then((data) => {
        setStemUrls(data.stems ?? {});

        if (data.lyrics?.raw_lrc) {
          setLyricsLines(parseLrc(data.lyrics.raw_lrc));
          setLyricsOffsetMs(data.lyrics.offset_ms ?? 0);
        }

        if (data.displaySettings) {
          const ds = data.displaySettings;
          if (ds.art_url) {
            setArtSettings({ url: ds.art_url, blur: ds.blur, opacity: ds.opacity, contrast: ds.contrast });
          }
          const defaultVolumes: Record<StemType, number> = {
            original: 0,
            instrumental: Math.round(ds.mix_instrumental_vol * 100),
            lead_vocal: Math.round(ds.mix_lead_vol * 100),
            backing_vocal: Math.round(ds.mix_backing_vol * 100),
          };
          setVolumes(defaultVolumes);
          // The mixer's gain nodes (if already created, from a previous
          // song reusing the same <audio> elements) hold their own value
          // outside React state — push the new defaults into them too.
          for (const type of Object.keys(defaultVolumes) as StemType[]) {
            const gain = mixerRef.current?.gains[type];
            if (gain) gain.gain.value = defaultVolumes[type] / 100;
          }
        }
      });
  }, [nowPlaying]);

  function onInstrumentalTimeUpdate() {
    const el = audioRefs.current.instrumental;
    if (!el || lyricsLines.length === 0) return;
    setCurrentLyricIdx(currentLineIndex(lyricsLines, el.currentTime * 1000 - lyricsOffsetMs));
  }

  function ensureMixer(): MixerGraph {
    if (mixerRef.current) return mixerRef.current;
    const context = new AudioContext();
    const gains: Partial<Record<StemType, GainNode>> = {};
    for (const { type } of TRACKS) {
      const el = audioRefs.current[type];
      if (!el) continue;
      const source = context.createMediaElementSource(el);
      const gain = context.createGain();
      gain.gain.value = volumes[type] / 100;
      source.connect(gain).connect(context.destination);
      gains[type] = gain;
    }
    mixerRef.current = { context, gains };
    return mixerRef.current;
  }

  function setVolume(type: StemType, value: number) {
    setVolumes((prev) => ({ ...prev, [type]: value }));
    const gain = mixerRef.current?.gains[type];
    // Web Audio's GainNode is imperative, non-React state living behind a
    // ref by design — mutating it directly is the sanctioned escape hatch,
    // not a render-purity violation.
    // eslint-disable-next-line react-hooks/immutability
    if (gain) gain.gain.value = value / 100;
  }

  async function play() {
    const mixer = ensureMixer();
    await mixer.context.resume();
    for (const { type } of TRACKS) {
      audioRefs.current[type]?.play();
    }
    setIsPlaying(true);
  }

  function pause() {
    for (const { type } of TRACKS) {
      audioRefs.current[type]?.pause();
    }
    setIsPlaying(false);
  }

  async function markPlayedAndAdvance() {
    if (nowPlaying) {
      await supabase.from("queue_items").update({ status: "played" }).eq("id", nowPlaying.id);
    }
    pause();
    setStemUrls({});
    currentSongIdRef.current = null;
  }

  async function startNext() {
    const next = upNext[0];
    if (!next) return;
    await supabase.from("queue_items").update({ status: "now_playing" }).eq("id", next.id);
  }

  async function clearQueue() {
    if (!window.confirm("Limpar toda a fila da sala? Isso remove os pedidos de todo mundo.")) return;
    pause();
    setStemUrls({});
    currentSongIdRef.current = null;
    await supabase
      .from("queue_items")
      .update({ status: "removed" })
      .eq("room_id", roomId)
      .in("status", ["queued", "now_playing"]);
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-10 px-8 py-12">
      {artSettings && (
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- external, unsized artwork used as a full-bleed backdrop */}
          <img
            src={artSettings.url}
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: `blur(${artSettings.blur}px) contrast(${artSettings.contrast * 100}%)` }}
          />
          <div className="absolute inset-0 bg-black" style={{ opacity: artSettings.opacity }} />
        </div>
      )}

      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span
          className={`rounded px-2 py-1 text-xs ${workerOnline ? "bg-green-600/20 text-green-600" : "bg-red-600/20 text-red-600"}`}
        >
          Worker {workerOnline ? "online" : "offline"}
        </span>
        <button
          className="rounded border border-black/20 px-3 py-1 text-xs text-zinc-500 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        </button>
        {queue.length > 0 && (
          <button
            className="rounded border border-black/20 px-3 py-1 text-xs text-zinc-500 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            onClick={clearQueue}
          >
            Limpar fila
          </button>
        )}
      </div>

      {roomUrl && (
        <div className="absolute left-4 top-4 flex flex-col items-center gap-1 rounded bg-white/90 p-2 dark:bg-black/70">
          <QRCodeSVG value={roomUrl} size={96} />
          <p className="text-[10px] text-zinc-600 dark:text-zinc-300">Escaneie para entrar</p>
        </div>
      )}

      {TRACKS.map(({ type }) => (
        <audio
          key={type}
          ref={(el) => {
            if (el) audioRefs.current[type] = el;
          }}
          src={stemUrls[type]}
          onEnded={type === "instrumental" ? markPlayedAndAdvance : undefined}
          onTimeUpdate={type === "instrumental" ? onInstrumentalTimeUpdate : undefined}
          crossOrigin="anonymous"
        />
      ))}

      {!nowPlaying && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">Nada tocando</h1>
          {upNext.length === 0 && (
            <p className="text-zinc-500">Fila vazia — peça uma música pelo celular.</p>
          )}
          {upNext.length > 0 && upNext[0].songs?.status === "ready" && (
            <button
              className="rounded bg-foreground px-6 py-3 text-background"
              onClick={startNext}
            >
              Tocar próxima: {upNext[0].songs?.title}
            </button>
          )}
          {upNext.length > 0 && upNext[0].songs && upNext[0].songs.status !== "ready" && (
            <p className="text-zinc-500">
              Próxima música ({upNext[0].songs.title}):{" "}
              {upNext[0].songs.status === "failed"
                ? SONG_STATUS_LABEL.failed
                : SONG_STATUS_LABEL[upNext[0].songs.status]}
            </p>
          )}
        </div>
      )}

      {nowPlaying && (
        <div className="flex w-full max-w-xl flex-col items-center gap-8">
          <div className="text-center">
            <p className="text-sm text-zinc-500">Tocando agora</p>
            <h1 className="text-3xl font-semibold">{nowPlaying.songs?.title}</h1>
            {nowPlaying.songs?.artist_guess && (
              <p className="text-zinc-500">{nowPlaying.songs.artist_guess}</p>
            )}
          </div>

          {lyricsLines.length > 0 && (
            <p className="min-h-8 text-center text-xl font-medium">
              {currentLyricIdx >= 0 ? lyricsLines[currentLyricIdx].text : ""}
            </p>
          )}

          <button
            className="rounded-full bg-foreground px-8 py-3 text-lg text-background"
            onClick={isPlaying ? pause : play}
            disabled={!stemUrls.instrumental}
          >
            {isPlaying ? "Pausar" : "Tocar"}
          </button>

          <div className="flex w-full flex-col gap-4">
            {TRACKS.map(({ type, label }) => (
              <label key={type} className="flex items-center gap-4">
                <span className="w-40 text-sm text-zinc-500">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volumes[type]}
                  onChange={(e) => setVolume(type, Number(e.target.value))}
                  className="flex-1"
                />
              </label>
            ))}
          </div>

          {upNext.length > 0 && (
            <p className="text-sm text-zinc-500">Próxima: {upNext[0].songs?.title}</p>
          )}
        </div>
      )}
    </main>
  );
}
