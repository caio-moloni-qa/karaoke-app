"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { QueueItemWithSong, StemType } from "@/lib/types";

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

  const audioRefs = useRef<Partial<Record<StemType, HTMLAudioElement>>>({});
  const mixerRef = useRef<MixerGraph | null>(null);
  const currentSongIdRef = useRef<string | null>(null);

  const nowPlaying = queue.find((q) => q.status === "now_playing") ?? null;
  const upNext = queue.filter((q) => q.status === "queued");

  const loadQueue = useCallback(async () => {
    const { data } = await supabase
      .from("queue_items")
      .select("*, songs(id, title, artist_guess), guests(id, display_name)")
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, supabase, loadQueue]);

  // Fetch signed stem URLs whenever the now-playing song changes.
  useEffect(() => {
    if (!nowPlaying || nowPlaying.song_id === currentSongIdRef.current) return;
    currentSongIdRef.current = nowPlaying.song_id;
    setIsPlaying(false);
    fetch(`/api/songs/${nowPlaying.song_id}`)
      .then((res) => res.json())
      .then((data) => setStemUrls(data.stems ?? {}));
  }, [nowPlaying]);

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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-8 py-12">
      {TRACKS.map(({ type }) => (
        <audio
          key={type}
          ref={(el) => {
            if (el) audioRefs.current[type] = el;
          }}
          src={stemUrls[type]}
          onEnded={type === "instrumental" ? markPlayedAndAdvance : undefined}
          crossOrigin="anonymous"
        />
      ))}

      {!nowPlaying && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">Nada tocando</h1>
          {upNext.length > 0 ? (
            <button
              className="rounded bg-foreground px-6 py-3 text-background"
              onClick={startNext}
            >
              Tocar próxima: {upNext[0].songs?.title}
            </button>
          ) : (
            <p className="text-zinc-500">Fila vazia — peça uma música pelo celular.</p>
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
