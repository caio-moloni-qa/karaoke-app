"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Maximize, Minimize, Music2, Pause, Play, Trash2, Wifi, WifiOff } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeFallback } from "@/lib/useRealtimeFallback";
import { useWorkerOnline } from "@/lib/useWorkerOnline";
import { currentLineIndex, parseLrc, type LrcLine } from "@/lib/lrc";
import { latestProcessingJob, SONG_STATUS_LABEL, type QueueItemWithSong, type StemType } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { LyricsView } from "@/components/LyricsView";
import { MixerPanel } from "@/components/MixerPanel";
import { Button, IconButton } from "@/components/Button";

interface Background {
  url: string;
  blur: number;
  opacity: number;
  contrast: number;
}

const DEFAULT_BG = { blur: 16, opacity: 0.55, contrast: 1 };

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
  const [muted, setMuted] = useState<Record<StemType, boolean>>({
    original: false,
    instrumental: false,
    lead_vocal: false,
    backing_vocal: false,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [lyricsLines, setLyricsLines] = useState<LrcLine[]>([]);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);
  const [currentLyricIdx, setCurrentLyricIdx] = useState(-1);
  const [background, setBackground] = useState<Background | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [startingNext, setStartingNext] = useState(false);
  const [clearingQueue, setClearingQueue] = useState(false);
  const workerOnline = useWorkerOnline();

  const audioRefs = useRef<Partial<Record<StemType, HTMLAudioElement>>>({});
  const mixerRef = useRef<MixerGraph | null>(null);
  const currentSongIdRef = useRef<string | null>(null);

  const nowPlaying = queue.find((q) => q.status === "now_playing") ?? null;
  const upNext = queue.filter((q) => q.status === "queued");

  const loadQueue = useCallback(async () => {
    const { data } = await supabase
      .from("queue_items")
      .select(
        "*, songs(id, title, artist_guess, status, thumbnail_url, processing_jobs(status, stage_label, progress_pct, created_at)), guests(id, display_name)"
      )
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
      .on("postgres_changes", { event: "*", schema: "public", table: "processing_jobs" }, () => loadQueue())
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

  // Fetch signed stem URLs (+ lyrics, background, default mix) whenever the
  // now-playing song changes.
  useEffect(() => {
    if (!nowPlaying || nowPlaying.song_id === currentSongIdRef.current) return;
    currentSongIdRef.current = nowPlaying.song_id;
    setIsPlaying(false);
    setLyricsLines([]);
    setCurrentLyricIdx(-1);
    setBackground(null);

    fetch(`/api/songs/${nowPlaying.song_id}`)
      .then((res) => res.json())
      .then((data) => {
        setStemUrls(data.stems ?? {});

        if (data.lyrics?.raw_lrc) {
          setLyricsLines(parseLrc(data.lyrics.raw_lrc));
          setLyricsOffsetMs(data.lyrics.offset_ms ?? 0);
        }

        // Manually picked art wins; otherwise fall back to the YouTube
        // thumbnail already on hand, so there's always a backdrop.
        const bgUrl: string | null = data.displaySettings?.art_url || data.song?.thumbnail_url || null;
        if (bgUrl) {
          setBackground({
            url: bgUrl,
            blur: data.displaySettings?.blur ?? DEFAULT_BG.blur,
            opacity: data.displaySettings?.opacity ?? DEFAULT_BG.opacity,
            contrast: data.displaySettings?.contrast ?? DEFAULT_BG.contrast,
          });
        }

        if (data.displaySettings) {
          const ds = data.displaySettings;
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
      gain.gain.value = muted[type] ? 0 : volumes[type] / 100;
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
    if (gain && !muted[type]) gain.gain.value = value / 100;
  }

  function toggleMute(type: StemType) {
    setMuted((prev) => {
      const next = { ...prev, [type]: !prev[type] };
      const gain = mixerRef.current?.gains[type];
      if (gain) gain.gain.value = next[type] ? 0 : volumes[type] / 100;
      return next;
    });
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
    setBackground(null);
    setLyricsLines([]);
    currentSongIdRef.current = null;
  }

  async function startNext() {
    const next = upNext[0];
    if (!next) return;
    setStartingNext(true);
    try {
      await supabase.from("queue_items").update({ status: "now_playing" }).eq("id", next.id);
    } finally {
      setStartingNext(false);
    }
  }

  async function clearQueue() {
    if (!window.confirm("Limpar toda a fila da sala? Isso remove os pedidos de todo mundo.")) return;
    setClearingQueue(true);
    try {
      pause();
      setStemUrls({});
      setBackground(null);
      setLyricsLines([]);
      currentSongIdRef.current = null;
      await supabase
        .from("queue_items")
        .update({ status: "removed" })
        .eq("room_id", roomId)
        .in("status", ["queued", "now_playing"]);
    } finally {
      setClearingQueue(false);
    }
  }

  const mixerTracks = TRACKS.map(({ type, label }) => ({
    type,
    label,
    value: volumes[type],
    muted: muted[type],
  }));

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden px-8 py-12 pb-40">
      <div className="fixed inset-0 -z-10 bg-background">
        {background && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- external, unsized artwork used as a full-bleed backdrop */}
            <img
              src={background.url}
              alt=""
              className="h-full w-full scale-110 object-cover"
              style={{ filter: `blur(${background.blur}px) contrast(${background.contrast * 100}%)` }}
            />
            <div className="absolute inset-0 bg-black" style={{ opacity: background.opacity }} />
          </>
        )}
      </div>

      <div className="fixed right-4 top-4 z-20 flex items-center gap-2">
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            workerOnline ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          }`}
        >
          {workerOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          Worker {workerOnline ? "online" : "offline"}
        </span>
        <IconButton
          icon={isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          onClick={toggleFullscreen}
        />
        {queue.length > 0 && (
          <IconButton
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            aria-label="Limpar fila"
            loading={clearingQueue}
            onClick={clearQueue}
          />
        )}
      </div>

      {roomUrl && (
        <div className="fixed left-4 top-4 z-20 flex flex-col items-center gap-1 rounded-2xl bg-surface/90 p-3 shadow-lg backdrop-blur">
          <QRCodeSVG value={roomUrl} size={88} bgColor="transparent" fgColor="currentColor" className="text-foreground" />
          <p className="text-[10px] text-muted">Escaneie para entrar</p>
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
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
            <Music2 className="h-7 w-7 text-muted" />
          </div>
          <h1 className="text-2xl font-semibold">Nada tocando</h1>
          {upNext.length === 0 && (
            <p className="text-muted">Fila vazia — peça uma música pelo celular.</p>
          )}
          {upNext.length > 0 && upNext[0].songs?.status === "ready" && (
            <Button icon={<Play className="h-4 w-4" />} loading={startingNext} onClick={startNext} className="mt-2">
              Tocar próxima: {upNext[0].songs?.title}
            </Button>
          )}
          {upNext.length > 0 && upNext[0].songs && upNext[0].songs.status !== "ready" && (
            <div className="flex w-full max-w-sm flex-col items-center gap-2">
              <p className="text-muted">
                Próxima música ({upNext[0].songs.title}):{" "}
                {upNext[0].songs.status === "failed"
                  ? SONG_STATUS_LABEL.failed
                  : (latestProcessingJob(upNext[0].songs.processing_jobs)?.stage_label ??
                    SONG_STATUS_LABEL[upNext[0].songs.status])}
              </p>
              {upNext[0].songs.status !== "failed" && (
                <ProgressBar percent={latestProcessingJob(upNext[0].songs.processing_jobs)?.progress_pct ?? 0} />
              )}
            </div>
          )}
        </div>
      )}

      {nowPlaying && (
        <div className="flex w-full max-w-xl flex-col items-center gap-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-muted">Tocando agora</p>
            <h1 className="text-3xl font-semibold">{nowPlaying.songs?.title}</h1>
            {nowPlaying.songs?.artist_guess && <p className="text-muted">{nowPlaying.songs.artist_guess}</p>}
          </div>

          <LyricsView lines={lyricsLines} currentIndex={currentLyricIdx} />

          <button
            className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-accent to-accent-2 text-accent-foreground shadow-lg shadow-accent/30 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={isPlaying ? pause : play}
            disabled={!stemUrls.instrumental}
            aria-label={isPlaying ? "Pausar" : "Tocar"}
          >
            {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-0.5 h-7 w-7" />}
          </button>

          {upNext.length > 0 && (
            <p className="text-sm text-muted">Próxima: {upNext[0].songs?.title}</p>
          )}
        </div>
      )}

      <MixerPanel tracks={mixerTracks} onVolumeChange={setVolume} onToggleMute={toggleMute} />
    </main>
  );
}
