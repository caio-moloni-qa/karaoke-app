"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useYoutubePreview } from "@/lib/useYoutubePreview";
import { useRealtimeFallback } from "@/lib/useRealtimeFallback";
import { latestProcessingJob, SONG_STATUS_LABEL, type QueueItemWithSong, type Song } from "@/lib/types";
import type { YoutubeSearchResult } from "@/lib/youtube";
import { ProgressBar } from "@/components/ProgressBar";

interface GuestSession {
  guestId: string;
  clientToken: string;
  displayName: string;
}

function guestStorageKey(roomId: string) {
  return `karaoke:${roomId}:guest`;
}

export default function RoomRemotePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const supabase = useMemo(() => createBrowserClient(), []);
  const { preview, playerElementId } = useYoutubePreview();

  // Starts null on both server and the client's first render so hydration
  // matches; the real value (if any) is only known after mount, since
  // localStorage isn't available during SSR.
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [library, setLibrary] = useState<Song[]>([]);
  const [queue, setQueue] = useState<QueueItemWithSong[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YoutubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const loadQueue = useCallback(async () => {
    const { data } = await supabase
      .from("queue_items")
      .select(
        "*, songs(id, title, artist_guess, status, processing_jobs(status, stage_label, progress_pct, created_at)), guests(id, display_name)"
      )
      .eq("room_id", roomId)
      .in("status", ["queued", "now_playing"])
      .order("added_at", { ascending: true });
    setQueue((data as QueueItemWithSong[]) ?? []);
  }, [roomId, supabase]);

  const loadLibrary = useCallback(async () => {
    const { data } = await supabase
      .from("songs")
      .select("*")
      .eq("status", "ready")
      .order("title", { ascending: true });
    setLibrary((data as Song[]) ?? []);
  }, [supabase]);

  const refetchAll = useCallback(() => {
    loadQueue();
    loadLibrary();
  }, [loadQueue, loadLibrary]);

  useRealtimeFallback(refetchAll);

  useEffect(() => {
    const raw = localStorage.getItem(guestStorageKey(roomId));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must run post-mount, localStorage isn't available during SSR
    if (raw) setGuest(JSON.parse(raw) as GuestSession);
    setHydrated(true);
  }, [roomId]);

  useEffect(() => {
    // Initial load + realtime subscription is the sanctioned pattern for
    // syncing with an external store; the fetch itself is async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLibrary();
    loadQueue();

    const channel = supabase
      .channel(`room:${roomId}:queue`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` },
        () => loadQueue()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "songs" }, () => {
        loadQueue();
        loadLibrary();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "processing_jobs" }, () => loadQueue())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, supabase, loadQueue, loadLibrary]);

  async function joinRoom() {
    const name = nameInput.trim();
    if (!name) return;

    const clientToken = crypto.randomUUID();
    const { data, error } = await supabase
      .from("guests")
      .insert({ room_id: roomId, display_name: name, client_token: clientToken })
      .select("id")
      .single();

    if (error || !data) return;

    const session: GuestSession = { guestId: data.id, clientToken, displayName: name };
    localStorage.setItem(guestStorageKey(roomId), JSON.stringify(session));
    setGuest(session);
  }

  async function runSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function requestSong(result: YoutubeSearchResult) {
    if (!guest) return;
    await fetch(`/api/rooms/${roomId}/songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: result.videoId,
        title: result.title,
        channelTitle: result.channelTitle,
        durationSeconds: result.durationSeconds,
        thumbnailUrl: result.thumbnailUrl,
        guestId: guest.guestId,
        clientToken: guest.clientToken,
      }),
    });
  }

  async function addToQueue(songId: string) {
    if (!guest) return;
    await supabase.from("queue_items").insert({
      room_id: roomId,
      song_id: songId,
      requested_by: guest.guestId,
      status: "queued",
    });
  }

  async function removeFromQueue(itemId: string) {
    if (!guest) return;
    await fetch(`/api/queue/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientToken: guest.clientToken }),
    });
  }

  if (!hydrated) {
    return <main className="min-h-screen" />;
  }

  if (!guest) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">Entrar na sala</h1>
        <input
          className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          placeholder="Seu nome"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
        />
        <button
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-40"
          disabled={!nameInput.trim()}
          onClick={joinRoom}
        >
          Entrar
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-8">
      <div id={playerElementId} className="pointer-events-none absolute h-0 w-0 overflow-hidden" />

      <header>
        <p className="text-sm text-zinc-500">Sala</p>
        <h1 className="text-lg font-semibold">Olá, {guest.displayName}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Fila</h2>
        {queue.length === 0 && <p className="text-sm text-zinc-500">Fila vazia.</p>}
        <ul className="flex flex-col gap-2">
          {queue.map((item) => {
            const job = latestProcessingJob(item.songs?.processing_jobs);
            const isProcessing = item.songs && item.songs.status !== "ready" && item.songs.status !== "failed";
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded border border-black/10 px-3 py-2 dark:border-white/10"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{item.songs?.title}</p>
                    <p className="text-xs text-zinc-500">
                      {item.status === "now_playing"
                        ? "Tocando agora"
                        : item.songs && item.songs.status !== "ready"
                          ? (job?.stage_label ?? SONG_STATUS_LABEL[item.songs.status])
                          : "Na fila"}
                      {" · pedido por "}
                      {item.guests?.display_name ?? "?"}
                    </p>
                  </div>
                  {item.requested_by === guest.guestId && item.status === "queued" && (
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => removeFromQueue(item.id)}
                    >
                      remover
                    </button>
                  )}
                </div>
                {isProcessing && job && <ProgressBar percent={job.progress_pct} />}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Buscar no YouTube</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-black/20 px-3 py-2 dark:border-white/20"
            placeholder="Nome da música ou artista"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <button
            className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
            disabled={!searchQuery.trim() || searching}
            onClick={runSearch}
          >
            {searching ? "..." : "Buscar"}
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {searchResults.map((result) => (
            <li
              key={result.videoId}
              className="flex items-center gap-3 rounded border border-black/10 px-3 py-2 dark:border-white/10"
            >
              {result.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- thumbnails are external, unsized YouTube URLs
                <img src={result.thumbnailUrl} alt="" className="h-12 w-16 rounded object-cover" />
              )}
              <div className="flex-1 overflow-hidden">
                <p className="truncate font-medium">{result.title}</p>
                <p className="truncate text-xs text-zinc-500">{result.channelTitle}</p>
              </div>
              <button
                className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20"
                onClick={() => preview(result.videoId, result.durationSeconds)}
              >
                ouvir 5s
              </button>
              <button
                className="rounded bg-foreground px-3 py-1 text-xs text-background"
                onClick={() => requestSong(result)}
              >
                + fila
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Já prontas</h2>
        {library.length === 0 && (
          <p className="text-sm text-zinc-500">Nenhuma música processada ainda.</p>
        )}
        <ul className="flex flex-col gap-2">
          {library.map((song) => (
            <li
              key={song.id}
              className="flex items-center justify-between rounded border border-black/10 px-3 py-2 dark:border-white/10"
            >
              <div>
                <p className="font-medium">{song.title}</p>
                {song.artist_guess && <p className="text-xs text-zinc-500">{song.artist_guess}</p>}
              </div>
              <div className="flex gap-2">
                <a
                  href={`/room/${roomId}/songs/${song.id}`}
                  className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20"
                >
                  editar
                </a>
                <button
                  className="rounded bg-foreground px-3 py-1 text-xs text-background"
                  onClick={() => addToQueue(song.id)}
                >
                  + fila
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
