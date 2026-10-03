"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Maximize, Minimize, Music2, Pause, Play, RotateCcw, SkipBack, SkipForward, Smartphone, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useRealtimeFallback } from "@/lib/useRealtimeFallback";
import { useWorkerOnline } from "@/lib/useWorkerOnline";
import { applyAlignedStarts, currentLineIndex, parseLrc, type AlignedLine, type LrcLine } from "@/lib/lrc";
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
const AUTO_NEXT_SECONDS = 5;

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
  const [lyricsWords, setLyricsWords] = useState<AlignedLine[]>([]);
  const [currentLyricIdx, setCurrentLyricIdx] = useState(-1);
  const [singingCountdown, setSingingCountdown] = useState<number | null>(null);
  const [background, setBackground] = useState<Background | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [clearingQueue, setClearingQueue] = useState(false);
  const [loadingSong, setLoadingSong] = useState(false);
  const [togglingPlay, setTogglingPlay] = useState(false);
  // Set by the footer's next/previous so the song they switch to starts on
  // its own once its audio is loaded, keeping the stage in lyrics mode.
  const [autoPlayPending, setAutoPlayPending] = useState(false);
  // "Próxima música em N…" between songs: the queue item that will start
  // when the countdown reaches zero.
  const [autoNext, setAutoNext] = useState<{
    itemId: string;
    title: string;
    artist: string | null;
    secondsLeft: number;
  } | null>(null);
  const workerOnline = useWorkerOnline();

  const audioRefs = useRef<Partial<Record<StemType, HTMLAudioElement>>>({});
  const mixerRef = useRef<MixerGraph | null>(null);
  const currentSongIdRef = useRef<string | null>(null);
  // Set when the next song is a continuation of the session, so loading it
  // keeps the current track volumes instead of its saved defaults.
  const keepMixRef = useRef(false);
  // Read by the song-loading effect, which mustn't re-run when mute changes.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

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

  // Puts a queued song on stage and plays it as soon as its audio loads,
  // keeping the current Faixas settings — the session just carries on.
  const startQueuedSong = useCallback(
    async (itemId: string) => {
      setAutoNext(null);
      keepMixRef.current = true;
      await supabase.from("queue_items").update({ status: "now_playing" }).eq("id", itemId);
      setAutoPlayPending(true);
      await loadQueue();
    },
    [supabase, loadQueue]
  );

  // Ticks the between-songs countdown; at zero the next song starts. Paused
  // while a song is on stage (e.g. one started from someone's phone).
  useEffect(() => {
    if (!autoNext || nowPlaying) return;
    const timer = setTimeout(() => {
      if (autoNext.secondsLeft > 1) setAutoNext({ ...autoNext, secondsLeft: autoNext.secondsLeft - 1 });
      else startQueuedSong(autoNext.itemId);
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoNext, nowPlaying, startQueuedSong]);

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
    const ownUrl = `${window.location.origin}/room/${roomId}`;
    // Opened as localhost on the host PC, the QR code would point phones at
    // themselves — use the host's LAN address instead, and don't show a QR
    // at all until it's known (a localhost one is useless to scan).
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- window.location isn't available during SSR
      setRoomUrl(ownUrl);
      return;
    }
    fetch("/api/host-info")
      .then((res) => res.json())
      .then((info: { lanUrl: string | null }) => setRoomUrl(info.lanUrl ? `${info.lanUrl}/room/${roomId}` : ownUrl))
      .catch(() => setRoomUrl(ownUrl));
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
    setLyricsWords([]);
    setCurrentLyricIdx(-1);
    setSingingCountdown(null);
    setBackground(null);
    setLoadingSong(true);

    fetch(`/api/songs/${nowPlaying.song_id}`)
      .then((res) => res.json())
      .then((data) => {
        setStemUrls(data.stems ?? {});

        if (data.lyrics?.raw_lrc) {
          // Word timings are null until the worker has aligned these lyrics;
          // LyricsView falls back to filling whole lines meanwhile. With
          // them, repeated lines ("(x8)") start exactly when each one is sung.
          const words: AlignedLine[] = data.lyrics.word_timings ?? [];
          setLyricsLines(applyAlignedStarts(parseLrc(data.lyrics.raw_lrc), words));
          setLyricsOffsetMs(data.lyrics.offset_ms ?? 0);
          setLyricsWords(words);
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

        // A song's saved default mix applies when it's started from the
        // setup screen; when the session just carries on (auto-advance,
        // footer next/previous) the current Faixas settings stay instead.
        const keepMix = keepMixRef.current;
        keepMixRef.current = false;
        if (data.displaySettings && !keepMix) {
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
          // Muted stems stay silent: karaoke mode (lead vocal muted) carries
          // over from song to song.
          for (const type of Object.keys(defaultVolumes) as StemType[]) {
            const gain = mixerRef.current?.gains[type];
            if (gain) gain.gain.value = mutedRef.current[type] ? 0 : defaultVolumes[type] / 100;
          }
        }
      })
      .finally(() => setLoadingSong(false));
  }, [nowPlaying]);

  // The instrumental's `canplay` fires once the newly loaded song has enough
  // audio to start — the moment to honor a pending footer next/previous.
  // Starts the elements directly instead of via play(): a song was already
  // playing, so the Web Audio mixer exists and needs no setup (and keeping
  // play()'s mixer creation out of this handler lets the React Compiler
  // keep optimizing the page).
  function onInstrumentalReady() {
    if (!autoPlayPending) return;
    setAutoPlayPending(false);
    for (const { type } of TRACKS) audioRefs.current[type]?.play();
    setIsPlaying(true);
  }

  // Earliest line that actually has words — an LRC's first tag is often an
  // instrumental-intro marker with empty text, which shouldn't anchor the
  // countdown.
  const firstSingingLineMs = useMemo(
    () => lyricsLines.find((line) => line.text.trim() !== "")?.timeMs ?? null,
    [lyricsLines]
  );

  // Read by LyricsView every animation frame for the progressive line fill;
  // `timeupdate` alone only fires a few times a second, too coarse to look
  // smooth.
  const getLyricsPositionMs = useCallback(() => {
    const el = audioRefs.current.instrumental;
    return el ? el.currentTime * 1000 - lyricsOffsetMs : null;
  }, [lyricsOffsetMs]);

  function onInstrumentalTimeUpdate() {
    const el = audioRefs.current.instrumental;
    if (!el || lyricsLines.length === 0) return;
    const positionMs = el.currentTime * 1000 - lyricsOffsetMs;
    setCurrentLyricIdx(currentLineIndex(lyricsLines, positionMs));

    // 3-2-1 lead-in so singers can anticipate exactly when the first line
    // starts, instead of guessing during a silent/instrumental intro.
    if (firstSingingLineMs != null) {
      const msUntilSinging = firstSingingLineMs - positionMs;
      setSingingCountdown(
        msUntilSinging > 0 && msUntilSinging <= 3000 ? Math.ceil(msUntilSinging / 1000) : null
      );
    }
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
    setTogglingPlay(true);
    try {
      const mixer = ensureMixer();
      await mixer.context.resume();
      for (const { type } of TRACKS) {
        audioRefs.current[type]?.play();
      }
      setIsPlaying(true);
    } finally {
      setTogglingPlay(false);
    }
  }

  function pause() {
    for (const { type } of TRACKS) {
      audioRefs.current[type]?.pause();
    }
    setIsPlaying(false);
  }

  // Rewinds every stem together (they're separate <audio> elements that have
  // to stay in sync) and plays from the top. Lyrics and the 3-2-1 lead-in
  // follow on their own, since both are derived from the playback position.
  async function restart() {
    for (const { type } of TRACKS) {
      const el = audioRefs.current[type];
      if (el) el.currentTime = 0;
    }
    if (!isPlaying) await play();
  }

  // Stays true through the DB write *and* the follow-up refetch, not just
  // the write — a plain `loading` flag around the write alone found the
  // whole "now playing" block (button included) unmounting via the
  // realtime update before a spinner ever got painted, since the write
  // itself resolves in well under a frame.
  function unloadCurrentSong() {
    pause();
    setStemUrls({});
    setBackground(null);
    setLyricsLines([]);
    setSingingCountdown(null);
    setLoadingSong(false);
    currentSongIdRef.current = null;
  }

  async function markPlayed(itemId: string) {
    await supabase.from("queue_items").update({ status: "played", played_at: new Date().toISOString() }).eq("id", itemId);
  }

  async function markPlayedAndAdvance() {
    setAutoNext(null);
    setTransitioning(true);
    try {
      if (nowPlaying) await markPlayed(nowPlaying.id);
      unloadCurrentSong();
      await loadQueue();
    } finally {
      setTransitioning(false);
    }
  }

  // Footer "next": finish this song and go straight into the next one that's
  // ready (songs still processing stay queued for later), still in lyrics
  // mode. With nothing ready it falls back to the setup screen.
  async function goToNextSong() {
    const next = upNext.find((item) => item.songs?.status === "ready");
    setAutoNext(null);
    setTransitioning(true);
    try {
      if (nowPlaying) await markPlayed(nowPlaying.id);
      unloadCurrentSong();
      if (next) await startQueuedSong(next.id);
      else await loadQueue();
    } finally {
      setTransitioning(false);
    }
  }

  // When a song ends: mark it played and, if a ready song is waiting, count
  // down 5 seconds on screen (with "Tocar agora" / "Cancelar") and start it,
  // keeping the current Faixas settings. Nothing ready -> setup screen.
  async function onSongEnded() {
    const next = upNext.find((item) => item.songs?.status === "ready");
    setTransitioning(true);
    try {
      if (nowPlaying) await markPlayed(nowPlaying.id);
      unloadCurrentSong();
      if (next) {
        setAutoNext({
          itemId: next.id,
          title: next.songs?.title ?? "",
          artist: next.songs?.artist_guess ?? null,
          secondsLeft: AUTO_NEXT_SECONDS,
        });
      }
      await loadQueue();
    } finally {
      setTransitioning(false);
    }
  }

  // Footer "previous": bring back the song played most recently and put this
  // one back in the queue (it was the earliest request, so it's next again).
  // With no song played yet, restarts the current one instead.
  async function goToPreviousSong() {
    const { data: previous } = await supabase
      .from("queue_items")
      .select("id")
      .eq("room_id", roomId)
      .eq("status", "played")
      .order("played_at", { ascending: false, nullsFirst: false })
      .order("added_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!previous) {
      await restart();
      return;
    }
    setAutoNext(null);
    keepMixRef.current = true;
    setTransitioning(true);
    try {
      unloadCurrentSong();
      if (nowPlaying) await supabase.from("queue_items").update({ status: "queued" }).eq("id", nowPlaying.id);
      await supabase.from("queue_items").update({ status: "now_playing", played_at: null }).eq("id", previous.id);
      setAutoPlayPending(true);
      await loadQueue();
    } finally {
      setTransitioning(false);
    }
  }

  async function startNext() {
    const next = upNext[0];
    if (!next) return;
    setAutoNext(null);
    setTransitioning(true);
    try {
      await supabase.from("queue_items").update({ status: "now_playing" }).eq("id", next.id);
      await loadQueue();
    } finally {
      setTransitioning(false);
    }
  }

  async function clearQueue() {
    if (!window.confirm("Limpar toda a fila da sala? Isso remove os pedidos de todo mundo.")) return;
    setAutoNext(null);
    setClearingQueue(true);
    setTransitioning(true);
    try {
      pause();
      setStemUrls({});
      setBackground(null);
      setLyricsLines([]);
      setSingingCountdown(null);
      setLoadingSong(false);
      currentSongIdRef.current = null;
      await supabase
        .from("queue_items")
        .update({ status: "removed" })
        .eq("room_id", roomId)
        .in("status", ["queued", "now_playing"]);
      await loadQueue();
    } finally {
      setClearingQueue(false);
      setTransitioning(false);
    }
  }

  const mixerTracks = TRACKS.map(({ type, label }) => ({
    type,
    label,
    value: volumes[type],
    muted: muted[type],
  }));

  // While a song plays the stage is just the lyrics: the setup HUD (QR, status,
  // track mixer, title, big controls) fades out and only a small footer with
  // play/pause and seek stays. Pausing brings the full setup screen back.
  const performing = isPlaying && !!nowPlaying && !transitioning;
  const hud = `transition-opacity duration-500 ${performing ? "pointer-events-none opacity-0" : "opacity-100"}`;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden px-8 py-12">
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

      <div className={`fixed right-4 top-4 z-20 flex items-center gap-2 ${hud}`}>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
            workerOnline ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          }`}
        >
          {workerOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          Worker {workerOnline ? "online" : "offline"}
        </span>
        <Link
          href={`/room/${roomId}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-surface-hover"
          aria-label="Ir para o controle"
          title="Ir para o controle"
        >
          <Smartphone className="h-4 w-4" />
        </Link>
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
        <div className={`fixed left-4 top-4 z-20 flex flex-col items-center gap-1 rounded-2xl bg-surface/90 p-3 shadow-lg backdrop-blur ${hud}`}>
          <QRCodeSVG value={roomUrl} size={88} bgColor="transparent" fgColor="currentColor" className="text-foreground" />
          <p className="text-[10px] text-muted">Escaneie para entrar</p>
          {/* The address the QR holds, for typing it in by hand. */}
          <p className="text-[10px] font-medium tabular-nums text-foreground">{new URL(roomUrl).host}</p>
        </div>
      )}

      {TRACKS.map(({ type }) => (
        <audio
          key={type}
          ref={(el) => {
            if (el) audioRefs.current[type] = el;
          }}
          src={stemUrls[type]}
          onEnded={type === "instrumental" ? onSongEnded : undefined}
          onTimeUpdate={type === "instrumental" ? onInstrumentalTimeUpdate : undefined}
          onCanPlay={type === "instrumental" ? onInstrumentalReady : undefined}
          crossOrigin="anonymous"
        />
      ))}

      {transitioning ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted" />
          <p className="text-muted">Trocando de música…</p>
        </div>
      ) : (
        <>
          {!nowPlaying && autoNext && (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-sm font-medium uppercase tracking-wide text-muted">Próxima música em</p>
              <span key={autoNext.secondsLeft} className="animate-countdown-pop text-8xl font-bold text-accent">
                {autoNext.secondsLeft}
              </span>
              <h1 className="text-3xl font-semibold">{autoNext.title}</h1>
              {autoNext.artist && <p className="text-muted">{autoNext.artist}</p>}
              <div className="mt-2 flex gap-2">
                <Button icon={<Play className="h-4 w-4" />} onClick={() => startQueuedSong(autoNext.itemId)}>
                  Tocar agora
                </Button>
                <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setAutoNext(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {!nowPlaying && !autoNext && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
                <Music2 className="h-7 w-7 text-muted" />
              </div>
              <h1 className="text-2xl font-semibold">Nada tocando</h1>
              {upNext.length === 0 && (
                <p className="text-muted">Fila vazia — peça uma música pelo celular.</p>
              )}
              {upNext.length > 0 && upNext[0].songs?.status === "ready" && (
                <Button icon={<Play className="h-4 w-4" />} onClick={startNext} className="mt-2">
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
            <div className="flex w-full max-w-6xl flex-col items-center gap-6">
              {!performing && (
              <div className="text-center">
                <p className="text-sm font-medium uppercase tracking-wide text-muted">Tocando agora</p>
                <h1 className="text-3xl font-semibold">{nowPlaying.songs?.title}</h1>
                {nowPlaying.songs?.artist_guess && <p className="text-muted">{nowPlaying.songs.artist_guess}</p>}
              </div>
              )}

              <LyricsView
                lines={lyricsLines}
                currentIndex={currentLyricIdx}
                countdown={singingCountdown}
                getPositionMs={getLyricsPositionMs}
                wordTimings={lyricsWords}
              />

              {loadingSong && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando música…
                </p>
              )}

              {!performing && (
              <>
              <div className="flex items-center gap-4">
                <IconButton
                  icon={<RotateCcw className="h-5 w-5" />}
                  aria-label="Recomeçar a música"
                  title="Recomeçar a música"
                  onClick={restart}
                  disabled={!stemUrls.instrumental || togglingPlay}
                />
                <button
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-accent to-accent-2 text-accent-foreground shadow-lg shadow-accent/30 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={isPlaying ? pause : play}
                  disabled={!stemUrls.instrumental || togglingPlay}
                  aria-label={isPlaying ? "Pausar" : "Tocar"}
                >
                  {togglingPlay ? (
                    <Loader2 className="h-7 w-7 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="h-7 w-7" />
                  ) : (
                    <Play className="ml-0.5 h-7 w-7" />
                  )}
                </button>
                {upNext.length > 0 && (
                  <IconButton
                    icon={<SkipForward className="h-5 w-5" />}
                    aria-label="Pular para a próxima música"
                    onClick={markPlayedAndAdvance}
                  />
                )}
              </div>

              {upNext.length > 0 && (
                <p className="text-sm text-muted">Próxima: {upNext[0].songs?.title}</p>
              )}
              </>
              )}
            </div>
          )}
        </>
      )}

      <div className={hud}>
        <MixerPanel
          tracks={mixerTracks}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          karaoke={muted.lead_vocal}
          onToggleKaraoke={() => toggleMute("lead_vocal")}
        />
      </div>

      {performing && (
        <div className="fixed bottom-6 right-6 z-30 flex items-center gap-1 rounded-full bg-surface/70 p-1.5 opacity-50 shadow-lg backdrop-blur transition-opacity hover:opacity-100">
          <IconButton
            variant="ghost"
            icon={<SkipBack className="h-5 w-5" />}
            aria-label="Música anterior"
            title="Música anterior"
            onClick={goToPreviousSong}
          />
          <IconButton
            variant="primary"
            icon={<Pause className="h-5 w-5" />}
            aria-label="Pausar"
            title="Pausar"
            onClick={pause}
          />
          <IconButton
            variant="ghost"
            icon={<SkipForward className="h-5 w-5" />}
            aria-label="Próxima música"
            title="Próxima música"
            onClick={goToNextSong}
          />
        </div>
      )}
    </main>
  );
}
