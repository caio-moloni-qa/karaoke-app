"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { QueueItemWithSong, Song } from "@/lib/types";

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

  const [guest, setGuest] = useState<GuestSession | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(guestStorageKey(roomId));
    return raw ? (JSON.parse(raw) as GuestSession) : null;
  });
  const [nameInput, setNameInput] = useState("");
  const [library, setLibrary] = useState<Song[]>([]);
  const [queue, setQueue] = useState<QueueItemWithSong[]>([]);

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
    supabase
      .from("songs")
      .select("*")
      .eq("status", "ready")
      .order("title", { ascending: true })
      .then(({ data }) => setLibrary((data as Song[]) ?? []));

    // Initial load + realtime subscription is the sanctioned pattern for
    // syncing with an external store; the fetch itself is async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQueue();

    const channel = supabase
      .channel(`room:${roomId}:queue`)
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
      <header>
        <p className="text-sm text-zinc-500">Sala</p>
        <h1 className="text-lg font-semibold">Olá, {guest.displayName}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Fila</h2>
        {queue.length === 0 && <p className="text-sm text-zinc-500">Fila vazia.</p>}
        <ul className="flex flex-col gap-2">
          {queue.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded border border-black/10 px-3 py-2 dark:border-white/10"
            >
              <div>
                <p className="font-medium">{item.songs?.title}</p>
                <p className="text-xs text-zinc-500">
                  {item.status === "now_playing" ? "Tocando agora" : "Na fila"} · pedido por{" "}
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
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Músicas disponíveis</h2>
        {library.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nenhuma música pronta ainda (o worker de download/separação chega na MVP2).
          </p>
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
              <button
                className="rounded bg-foreground px-3 py-1 text-xs text-background"
                onClick={() => addToQueue(song.id)}
              >
                + fila
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
