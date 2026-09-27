"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ListMusic, Pencil, Plus, Search, Sparkles, Volume2, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useYoutubePreview } from "@/lib/useYoutubePreview";
import { useRealtimeFallback } from "@/lib/useRealtimeFallback";
import { latestProcessingJob, SONG_STATUS_LABEL, type QueueItemWithSong, type Song } from "@/lib/types";
import type { YoutubeSearchResult } from "@/lib/youtube";
import { ProgressBar } from "@/components/ProgressBar";
import { Button, IconButton } from "@/components/Button";

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
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const { preview, playerElementId } = useYoutubePreview();

  // Starts null on both server and the client's first render so hydration
  // matches; the real value (if any) is only known after mount, since
  // localStorage isn't available during SSR.
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [library, setLibrary] = useState<Song[]>([]);
  const [queue, setQueue] = useState<QueueItemWithSong[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YoutubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [pendingVideoIds, setPendingVideoIds] = useState<Set<string>>(new Set());
  const [pendingSongIds, setPendingSongIds] = useState<Set<string>>(new Set());
  const [pendingQueueItemIds, setPendingQueueItemIds] = useState<Set<string>>(new Set());

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
    setJoining(true);
    try {
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
    } finally {
      setJoining(false);
    }
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
    setPendingVideoIds((prev) => new Set(prev).add(result.videoId));
    try {
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
      await loadQueue();
    } finally {
      setPendingVideoIds((prev) => {
        const next = new Set(prev);
        next.delete(result.videoId);
        return next;
      });
    }
  }

  async function addToQueue(songId: string) {
    if (!guest) return;
    setPendingSongIds((prev) => new Set(prev).add(songId));
    try {
      await supabase.from("queue_items").insert({
        room_id: roomId,
        song_id: songId,
        requested_by: guest.guestId,
        status: "queued",
      });
      await loadQueue();
    } finally {
      setPendingSongIds((prev) => {
        const next = new Set(prev);
        next.delete(songId);
        return next;
      });
    }
  }

  async function removeFromQueue(itemId: string) {
    if (!guest) return;
    setPendingQueueItemIds((prev) => new Set(prev).add(itemId));
    try {
      await fetch(`/api/queue/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientToken: guest.clientToken }),
      });
      await loadQueue();
    } finally {
      setPendingQueueItemIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  if (!hydrated) {
    return <main className="min-h-screen bg-background" />;
  }

  if (!guest) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-accent to-accent-2">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold">Entrar na sala</h1>
          <p className="text-sm text-muted">Escolha um nome para pedir músicas.</p>
        </div>
        <input
          className="rounded-xl border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Seu nome"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
        />
        <Button disabled={!nameInput.trim()} loading={joining} onClick={joinRoom}>
          Entrar
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-5 py-8">
      <div id={playerElementId} className="pointer-events-none absolute h-0 w-0 overflow-hidden" />

      <header>
        <p className="text-sm text-muted">Sala</p>
        <h1 className="text-lg font-semibold">Olá, {guest.displayName}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <ListMusic className="h-4 w-4" /> Fila
        </h2>
        {queue.length === 0 && <p className="text-sm text-muted">Fila vazia.</p>}
        <ul className="flex flex-col gap-2">
          {queue.map((item) => {
            const job = latestProcessingJob(item.songs?.processing_jobs);
            const isProcessing = item.songs && item.songs.status !== "ready" && item.songs.status !== "failed";
            const removing = pendingQueueItemIds.has(item.id);
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.songs?.title}</p>
                    <p className="truncate text-xs text-muted">
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
                    <IconButton
                      variant="ghost"
                      icon={<X className="h-4 w-4" />}
                      aria-label="Remover da fila"
                      loading={removing}
                      onClick={() => removeFromQueue(item.id)}
                      className="h-7 w-7"
                    />
                  )}
                </div>
                {isProcessing && job && <ProgressBar percent={job.progress_pct} />}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Search className="h-4 w-4" /> Buscar no YouTube
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Nome da música ou artista"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <Button
            variant="secondary"
            disabled={!searchQuery.trim()}
            loading={searching}
            onClick={runSearch}
            icon={<Search className="h-4 w-4" />}
          >
            Buscar
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {searchResults.map((result) => (
            <li key={result.videoId} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
              {result.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- thumbnails are external, unsized YouTube URLs
                <img src={result.thumbnailUrl} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{result.title}</p>
                <p className="truncate text-xs text-muted">{result.channelTitle}</p>
              </div>
              <IconButton
                variant="ghost"
                icon={<Volume2 className="h-4 w-4" />}
                aria-label="Ouvir prévia de 5s"
                onClick={() => preview(result.videoId, result.durationSeconds)}
              />
              <IconButton
                icon={<Plus className="h-4 w-4" />}
                aria-label="Adicionar à fila"
                loading={pendingVideoIds.has(result.videoId)}
                onClick={() => requestSong(result)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Sparkles className="h-4 w-4" /> Já prontas
        </h2>
        {library.length === 0 && <p className="text-sm text-muted">Nenhuma música processada ainda.</p>}
        <ul className="flex flex-col gap-2">
          {library.map((song) => (
            <li key={song.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{song.title}</p>
                {song.artist_guess && <p className="truncate text-xs text-muted">{song.artist_guess}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <IconButton
                  variant="secondary"
                  icon={<Pencil className="h-4 w-4" />}
                  aria-label="Editar letra e arte"
                  onClick={() => {
                    router.push(`/room/${roomId}/songs/${song.id}`);
                  }}
                />
                <IconButton
                  icon={<Plus className="h-4 w-4" />}
                  aria-label="Adicionar à fila"
                  loading={pendingSongIds.has(song.id)}
                  onClick={() => addToQueue(song.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
