"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, Download, FolderOpen, ListMusic, Mic2, Monitor, Music2, Pencil, Plus, RefreshCw, Search, Sparkles, Upload, Volume2, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useYoutubePreview } from "@/lib/useYoutubePreview";
import { useRealtimeFallback } from "@/lib/useRealtimeFallback";
import { latestProcessingJob, SONG_STATUS_LABEL, type QueueItemWithSong, type Song } from "@/lib/types";
import type { YoutubeSearchResult } from "@/lib/youtube";
import { parseCsv, toCsv } from "@/lib/csv";
import { ProgressBar } from "@/components/ProgressBar";
import { SpotifyIcon, YoutubeIcon } from "@/components/BrandIcons";
import { ProcessingQueuePanel, type ProcessingJobRow } from "@/components/ProcessingQueuePanel";
import { useWorkerOnline } from "@/lib/useWorkerOnline";
import { Button, IconButton } from "@/components/Button";
import { generateUUID } from "@/lib/uuid";

interface GuestSession {
  guestId: string;
  clientToken: string;
  displayName: string;
}

interface LibrarySong extends Song {
  lyrics: { song_id: string }[] | { song_id: string } | null;
}

interface StagedRow {
  id: string;
  artist: string;
  title: string;
  imageUrl?: string | null;
  // A CSV row with no confident Spotify match — imported as typed.
  notOnSpotify?: boolean;
}

type StagedInput = Omit<StagedRow, "id">;

interface SpotifySearchResults {
  tracks: { id: string; artist: string; title: string; albumName: string; imageUrl: string | null }[];
  albums: { id: string; name: string; artist: string; year: string; totalTracks: number; imageUrl: string | null }[];
  artists: { id: string; name: string; imageUrl: string | null }[];
}

function SpotifyThumb({ url, round = false }: { url: string | null; round?: boolean }) {
  const shape = round ? "rounded-full" : "rounded-md";
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- external Spotify cover art
    <img src={url} alt="" className={`h-10 w-10 shrink-0 object-cover ${shape}`} />
  ) : (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center bg-surface-hover ${shape}`}>
      <Music2 className="h-4 w-4 text-muted" />
    </div>
  );
}

function stagedKey(artist: string, title: string) {
  return `${artist.toLowerCase()}|${title.toLowerCase()}`;
}

function hasLyrics(song: LibrarySong): boolean {
  return Array.isArray(song.lyrics) ? song.lyrics.length > 0 : !!song.lyrics;
}

function guestStorageKey(roomId: string) {
  return `karaoke:${roomId}:guest`;
}

export default function RoomRemotePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const { preview, playerElementId, previewingVideoId } = useYoutubePreview();

  // Starts null on both server and the client's first render so hydration
  // matches; the real value (if any) is only known after mount, since
  // localStorage isn't available during SSR.
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [openingFolderId, setOpeningFolderId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [library, setLibrary] = useState<LibrarySong[]>([]);
  const [queue, setQueue] = useState<QueueItemWithSong[]>([]);

  const [autoMode, setAutoMode] = useState(true);
  const [autoQuery, setAutoQuery] = useState("");
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [autoResultMsg, setAutoResultMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YoutubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [pendingVideoIds, setPendingVideoIds] = useState<Set<string>>(new Set());
  const [pendingSongIds, setPendingSongIds] = useState<Set<string>>(new Set());
  const [pendingQueueItemIds, setPendingQueueItemIds] = useState<Set<string>>(new Set());
  const [retryingLyricsIds, setRetryingLyricsIds] = useState<Set<string>>(new Set());

  const [stagedRows, setStagedRows] = useState<StagedRow[]>([]);
  const [spotifyInput, setSpotifyInput] = useState("");
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyMsg, setSpotifyMsg] = useState<string | null>(null);
  const [spotifyResults, setSpotifyResults] = useState<SpotifySearchResults | null>(null);
  const [csvResolving, setCsvResolving] = useState(false);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const [addingAlbumId, setAddingAlbumId] = useState<string | null>(null);
  const stagedKeys = useMemo(
    () => new Set(stagedRows.map((r) => stagedKey(r.artist, r.title))),
    [stagedRows]
  );
  const [manualArtist, setManualArtist] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResultMsg, setImportResultMsg] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Stage order: whatever's playing, then the rest in request order.
  const orderedQueue = useMemo(
    () => [...queue.filter((item) => item.status === "now_playing"), ...queue.filter((item) => item.status !== "now_playing")],
    [queue]
  );

  const [libraryFilter, setLibraryFilter] = useState("");
  const filteredLibrary = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (song) => song.title.toLowerCase().includes(q) || song.artist_guess?.toLowerCase().includes(q)
    );
  }, [library, libraryFilter]);

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

  const [processingActive, setProcessingActive] = useState<ProcessingJobRow[]>([]);
  const [processingFailed, setProcessingFailed] = useState<ProcessingJobRow[]>([]);
  const workerOnline = useWorkerOnline();

  const loadProcessing = useCallback(async () => {
    // `*` rather than a column list so started_at (migration 0007) comes
    // through once it exists, without erroring before it's applied.
    const columns = "*, songs(title, artist_guess, thumbnail_url)";
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: active }, { data: failed }] = await Promise.all([
      supabase
        .from("processing_jobs")
        .select(columns)
        .in("status", ["queued", "claimed", "downloading", "separating", "uploading"])
        .order("created_at", { ascending: true }),
      supabase
        .from("processing_jobs")
        .select(columns)
        .eq("status", "error")
        .gte("updated_at", since)
        .order("updated_at", { ascending: false }),
    ]);
    setProcessingActive((active as unknown as ProcessingJobRow[]) ?? []);
    setProcessingFailed((failed as unknown as ProcessingJobRow[]) ?? []);
  }, [supabase]);

  const loadLibrary = useCallback(async () => {
    const { data } = await supabase
      .from("songs")
      .select("*, lyrics(song_id)")
      .eq("status", "ready")
      .order("title", { ascending: true });
    setLibrary((data as LibrarySong[]) ?? []);
  }, [supabase]);

  const [storage, setStorage] = useState<{ available: boolean; dir: string } | null>(null);
  const loadStorageStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/storage/status");
      setStorage(await res.json());
    } catch {
      // Status is advisory — leave the last known value.
    }
  }, []);

  const refetchAll = useCallback(() => {
    loadQueue();
    loadLibrary();
    loadProcessing();
    loadStorageStatus();
  }, [loadQueue, loadLibrary, loadProcessing, loadStorageStatus]);

  useRealtimeFallback(refetchAll);

  useEffect(() => {
    // localStorage can throw (private browsing, some in-app browsers like a
    // QR-scanner's embedded webview restrict or disable it entirely) — if
    // that happened here, the effect used to blow up before setHydrated
    // ever ran, leaving the page permanently stuck on the blank pre-hydration
    // screen. Guest join just degrades to "not joined yet" instead.
    try {
      const raw = localStorage.getItem(guestStorageKey(roomId));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- must run post-mount, localStorage isn't available during SSR
      if (raw) setGuest(JSON.parse(raw) as GuestSession);
    } catch {
      // ignore — guest just has to enter their name again
    }
    // Opening a song's folder only makes sense on the host PC itself.
    setIsHost(["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));
    setHydrated(true);
  }, [roomId]);

  useEffect(() => {
    // Initial load + realtime subscription is the sanctioned pattern for
    // syncing with an external store; the fetch itself is async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLibrary();
    loadQueue();
    loadProcessing();
    loadStorageStatus();

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
        loadProcessing();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "processing_jobs" }, () => {
        loadQueue();
        loadProcessing();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, supabase, loadQueue, loadLibrary, loadProcessing, loadStorageStatus]);

  async function joinRoom() {
    const name = nameInput.trim();
    if (!name) return;
    setJoining(true);
    try {
      const clientToken = generateUUID();
      const { data, error } = await supabase
        .from("guests")
        .insert({ room_id: roomId, display_name: name, client_token: clientToken })
        .select("id")
        .single();

      if (error || !data) return;

      const session: GuestSession = { guestId: data.id, clientToken, displayName: name };
      try {
        localStorage.setItem(guestStorageKey(roomId), JSON.stringify(session));
      } catch {
        // Storage may be restricted (private browsing, some in-app
        // browsers) — the session still works for this page load, it just
        // won't survive a reload.
      }
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

  async function requestSongAutomatic() {
    const q = autoQuery.trim();
    if (!q || !guest) return;
    setAutoSubmitting(true);
    setAutoResultMsg(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/songs/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, guestId: guest.guestId, clientToken: guest.clientToken }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoResultMsg(`Adicionado: ${data.matchedTitle}`);
        setAutoQuery("");
        await loadQueue();
      } else {
        setAutoResultMsg(data.error ?? "Não foi possível adicionar essa música.");
      }
    } finally {
      setAutoSubmitting(false);
    }
  }

  // Shared staging area for every way to populate an import batch (Spotify,
  // CSV upload, manual entry) — de-duped by artist+title so re-adding a
  // song or re-uploading a CSV doesn't double an entry already staged.
  // Nothing hits the database until confirmImport.
  function addStagedRows(rows: (Omit<StagedInput, "artist"> & { artist?: string })[]) {
    setStagedRows((prev) => {
      const seen = new Set(prev.map((r) => stagedKey(r.artist, r.title)));
      const additions: StagedRow[] = [];
      for (const row of rows) {
        const title = row.title?.trim();
        if (!title) continue;
        const artist = (row.artist ?? "").trim();
        const key = stagedKey(artist, title);
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push({ id: generateUUID(), artist, title, imageUrl: row.imageUrl ?? null, notOnSpotify: row.notOnSpotify });
      }
      return [...prev, ...additions];
    });
  }

  function removeStagedRow(id: string) {
    setStagedRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addManualStagedRow() {
    const title = manualTitle.trim();
    if (!title) return;
    addStagedRows([{ artist: manualArtist.trim(), title }]);
    setManualArtist("");
    setManualTitle("");
  }

  // `input` is an album link, or `spotify:album:<id>` for a search result.
  async function addSpotifyAlbum(input: string): Promise<boolean> {
    setSpotifyMsg(null);
    try {
      const res = await fetch("/api/spotify/album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSpotifyMsg(data.error ?? "Não foi possível buscar o álbum.");
        return false;
      }
      addStagedRows(data.songs ?? []);
      setSpotifyMsg(`${data.albumName} — ${data.albumArtist}: ${data.songs.length} faixa(s) na lista.`);
      return true;
    } catch {
      setSpotifyMsg("Falha ao conectar com o Spotify.");
      return false;
    }
  }

  // One search over song, album and artist names. Links skip the results
  // list: a song link adds that song, an album link adds its tracklist.
  async function searchSpotify(query?: string) {
    const input = (query ?? spotifyInput).trim();
    if (!input) return;
    setSpotifyLoading(true);
    setSpotifyMsg(null);
    setSpotifyResults(null);
    try {
      if (/album[/:]/.test(input)) {
        if (await addSpotifyAlbum(input)) setSpotifyInput("");
        return;
      }

      const res = await fetch("/api/spotify/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSpotifyMsg(data.error ?? "Não foi possível buscar no Spotify.");
        return;
      }

      const results = data as SpotifySearchResults;
      if (/track[/:]/.test(input) && results.tracks[0]) {
        addStagedRows(results.tracks);
        setSpotifyMsg(`${results.tracks[0].title} — ${results.tracks[0].artist} adicionada à lista.`);
        setSpotifyInput("");
      } else if (results.tracks.length + results.albums.length + results.artists.length === 0) {
        setSpotifyMsg("Nada encontrado no Spotify.");
      } else {
        setSpotifyResults(results);
      }
    } catch {
      setSpotifyMsg("Falha ao conectar com o Spotify.");
    } finally {
      setSpotifyLoading(false);
    }
  }

  // Narrows the search to one artist via Spotify's artist: filter, so the
  // results become that artist's songs and albums.
  function showSpotifyArtist(name: string) {
    setSpotifyInput(name);
    searchSpotify(`artist:"${name}"`);
  }

  // Each row is matched to its exact Spotify track first, so the import uses
  // the catalog's artist/title (and gets cover art) instead of whatever was
  // typed. Rows without a confident match are kept as typed and flagged.
  // If Spotify is unreachable, the rows are staged as typed.
  async function handleCsvFile(file: File) {
    const rows = parseCsv(await file.text())
      .map((row) => ({ artist: (row.artist ?? "").trim(), title: (row.title ?? "").trim() }))
      .filter((row) => row.title);
    if (rows.length === 0) {
      setCsvMsg("Nenhuma linha válida no CSV (colunas esperadas: artist, title).");
      return;
    }

    setCsvResolving(true);
    setCsvMsg(`Conferindo ${rows.length} música(s) no Spotify…`);
    try {
      const res = await fetch("/api/spotify/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songs: rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const matches = data.matches as ({ artist: string; title: string; imageUrl: string | null } | null)[];
      addStagedRows(
        rows.map((row, i) => {
          const match = matches[i];
          return match ? { artist: match.artist, title: match.title, imageUrl: match.imageUrl } : { ...row, notOnSpotify: true };
        })
      );
      const missing = matches.filter((m) => !m).length;
      setCsvMsg(
        missing > 0
          ? `${rows.length - missing} de ${rows.length} encontradas no Spotify. ${missing} não encontrada(s) — marcadas na lista, serão buscadas como estão.`
          : `Todas as ${rows.length} encontradas no Spotify.`
      );
    } catch {
      addStagedRows(rows);
      setCsvMsg(`Não foi possível conferir no Spotify — ${rows.length} música(s) adicionadas como estão no arquivo.`);
    } finally {
      setCsvResolving(false);
    }
  }

  function downloadStagedCsv() {
    const blob = new Blob([toCsv(stagedRows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "musicas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function confirmImport() {
    if (stagedRows.length === 0) return;
    setImporting(true);
    setImportResultMsg(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/songs/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songs: stagedRows.map(({ artist, title }) => ({ artist, title })) }),
      });
      const data = await res.json();
      const rowResults = (data.results ?? []) as { status: "added" | "error" }[];
      const added = rowResults.filter((r) => r.status === "added").length;
      const failed = rowResults.length - added;
      setImportResultMsg(
        failed > 0
          ? `${added} de ${rowResults.length} música(s) adicionada(s) — ${failed} com erro.`
          : `${added} música(s) adicionada(s) à biblioteca.`
      );
      setStagedRows([]);
      await loadLibrary();
    } catch {
      setImportResultMsg("Falha ao importar.");
    } finally {
      setImporting(false);
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

  // LRCLIB match failures are usually transient (a 502, or a messy title
  // that's since been cleaned up) rather than "this song has no lyrics
  // anywhere" — surfacing a one-tap retry here means a missed match never
  // needs a trip through the full editor, or someone noticing it by chance.
  async function retryLyrics(songId: string) {
    setRetryingLyricsIds((prev) => new Set(prev).add(songId));
    try {
      await fetch(`/api/songs/${songId}/lyrics/auto`, { method: "POST" });
      await loadLibrary();
    } finally {
      setRetryingLyricsIds((prev) => {
        const next = new Set(prev);
        next.delete(songId);
        return next;
      });
    }
  }

  async function clearProcessing(): Promise<string> {
    if (!guest) return "";
    try {
      const res = await fetch(`/api/rooms/${roomId}/processing/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: guest.guestId, clientToken: guest.clientToken }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? "Não foi possível limpar a fila.";
      await Promise.all([loadProcessing(), loadQueue()]);
      return `${data.cancelled} cancelada(s).${data.stillRunning ? ` "${data.stillRunning}" continua processando.` : ""}`;
    } catch {
      return "Não foi possível limpar a fila.";
    }
  }

  async function openSongFolder(songId: string) {
    setOpeningFolderId(songId);
    try {
      const res = await fetch(`/api/songs/${songId}/open-folder`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error ?? "Não foi possível abrir a pasta.");
      }
    } finally {
      setOpeningFolderId(null);
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

  let upNextPosition = 0;
  const queueList =
    orderedQueue.length === 0 ? (
      <p className="text-sm text-muted">Fila vazia.</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {orderedQueue.map((item) => {
          const job = latestProcessingJob(item.songs?.processing_jobs);
          const isProcessing = item.songs && item.songs.status !== "ready" && item.songs.status !== "failed";
          const nowPlaying = item.status === "now_playing";
          const position = nowPlaying ? null : ++upNextPosition;
          return (
            <li
              key={item.id}
              className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 ${nowPlaying ? "border-accent bg-accent/10" : "border-border bg-surface"}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-center text-xs text-muted">
                  {nowPlaying ? <Volume2 className="h-4 w-4 text-accent" /> : position}
                </span>
                {item.songs?.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external, unsized YouTube thumbnail
                  <img src={item.songs.thumbnail_url} alt="" className="h-9 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md bg-surface-hover">
                    <Music2 className="h-4 w-4 text-muted" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.songs?.title}</p>
                  <p className="truncate text-xs text-muted">
                    {nowPlaying
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
                    loading={pendingQueueItemIds.has(item.id)}
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
    );

  return (
    // Wide screens get the worker's processing queue on the left and the
    // stage queue on the right; below xl the side columns would be too
    // narrow to be useful, so it stays the single phone-shaped column.
    <div className="min-h-screen xl:grid xl:grid-cols-[minmax(0,1fr)_28rem_minmax(0,1fr)] xl:gap-8 xl:px-8">
    <aside className="hidden xl:block">
      <div className="sticky top-0 flex h-screen justify-end py-8">
        <div className="w-full max-w-md">
          <ProcessingQueuePanel
            active={processingActive}
            failed={processingFailed}
            workerOnline={workerOnline}
            onClear={clearProcessing}
          />
        </div>
      </div>
    </aside>
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 px-5 py-8 xl:px-0">
      {/* Small (not 0x0) and tucked in a corner rather than fully hidden —
          mobile browsers are much more aggressive about blocking
          autoplay-with-sound on hidden/zero-size iframes, even from a
          direct tap, so this stays real but easy to miss. The "now
          previewing" feedback is the pink pulse on the button instead. */}
      <div className="youtube-preview-wrapper fixed bottom-3 right-3 z-20 h-6 w-10 overflow-hidden rounded-md opacity-60">
        <div id={playerElementId} />
      </div>

      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Sala</p>
          <h1 className="text-lg font-semibold">Olá, {guest.displayName}</h1>
        </div>
        <Link
          href={`/stage/${roomId}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-hover"
        >
          <Monitor className="h-4 w-4" /> Ir para o palco
        </Link>
      </header>

      {/* On wide screens the queue lives in the right column instead. */}
      <section className="flex flex-col gap-3 xl:hidden">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <ListMusic className="h-4 w-4" /> Fila do palco
        </h2>
        {queueList}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <SpotifyIcon /> Buscar no Spotify
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Música, álbum ou artista"
            value={spotifyInput}
            onChange={(e) => setSpotifyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchSpotify()}
          />
          <Button
            variant="secondary"
            disabled={!spotifyInput.trim()}
            loading={spotifyLoading}
            onClick={() => searchSpotify()}
            icon={<SpotifyIcon />}
          >
            Buscar
          </Button>
        </div>
        <p className="text-xs text-muted">Nome ou link. As escolhidas vão para a lista de importação abaixo.</p>
        {spotifyMsg && <p className="text-sm">{spotifyMsg}</p>}

        {spotifyResults && spotifyResults.tracks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">Músicas</p>
            <ul className="flex flex-col gap-1.5">
              {spotifyResults.tracks.map((track) => {
                const added = stagedKeys.has(stagedKey(track.artist, track.title));
                return (
                  <li key={track.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                    <SpotifyThumb url={track.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{track.title}</p>
                      <p className="truncate text-xs text-muted">
                        {track.artist} · {track.albumName}
                      </p>
                    </div>
                    <IconButton
                      variant={added ? "ghost" : "secondary"}
                      icon={added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      aria-label={added ? "Já está na lista" : "Adicionar à lista"}
                      disabled={added}
                      onClick={() => addStagedRows([track])}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {spotifyResults && spotifyResults.albums.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">Álbuns</p>
            <ul className="flex flex-col gap-1.5">
              {spotifyResults.albums.map((album) => (
                <li key={album.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                  <SpotifyThumb url={album.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{album.name}</p>
                    <p className="truncate text-xs text-muted">
                      {album.artist} · {album.year} · {album.totalTracks} faixa(s)
                    </p>
                  </div>
                  <IconButton
                    variant="secondary"
                    icon={<Plus className="h-4 w-4" />}
                    aria-label="Adicionar todas as faixas à lista"
                    title="Adicionar todas as faixas à lista"
                    loading={addingAlbumId === album.id}
                    onClick={async () => {
                      setAddingAlbumId(album.id);
                      await addSpotifyAlbum(`spotify:album:${album.id}`);
                      setAddingAlbumId(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {spotifyResults && spotifyResults.artists.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">Artistas</p>
            <ul className="flex flex-col gap-1.5">
              {spotifyResults.artists.map((artist) => (
                <li key={artist.id}>
                  <button
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                    onClick={() => showSpotifyArtist(artist.name)}
                  >
                    <SpotifyThumb url={artist.imageUrl} round />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{artist.name}</span>
                    <span className="shrink-0 text-xs text-muted">Ver músicas e álbuns</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
            <YoutubeIcon /> Adicionar do YouTube
          </h2>
          <div className="flex rounded-full border border-border p-0.5 text-xs">
            <button
              className={`rounded-full px-3 py-1 transition-colors ${autoMode ? "bg-gradient-to-r from-accent to-accent-2 text-accent-foreground" : "text-muted"}`}
              onClick={() => setAutoMode(true)}
            >
              Automático
            </button>
            <button
              className={`rounded-full px-3 py-1 transition-colors ${!autoMode ? "bg-surface-hover text-foreground" : "text-muted"}`}
              onClick={() => setAutoMode(false)}
            >
              Manual
            </button>
          </div>
        </div>

        {autoMode ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Buscar música no YouTube"
                value={autoQuery}
                onChange={(e) => setAutoQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && requestSongAutomatic()}
              />
              <Button
                disabled={!autoQuery.trim()}
                loading={autoSubmitting}
                onClick={requestSongAutomatic}
                icon={<Sparkles className="h-4 w-4" />}
              >
                Adicionar
              </Button>
            </div>
            <p className="text-xs text-muted">
              Pega o primeiro resultado do YouTube e a letra automaticamente — sem precisar escolher.
            </p>
            {autoResultMsg && <p className="text-sm">{autoResultMsg}</p>}
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Buscar música no YouTube"
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
                  {/* Doesn't work on mobile accessed via the LAN IP — see
                      the "Known limitation" note in useYoutubePreview.ts. */}
                  <IconButton
                    variant={previewingVideoId === result.videoId ? "primary" : "ghost"}
                    icon={<Volume2 className={previewingVideoId === result.videoId ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />}
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
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Upload className="h-4 w-4" /> Importar músicas
        </h2>
        <p className="text-xs text-muted">
          Músicas escolhidas no Spotify ou enviadas por .csv. Entram na biblioteca para processamento, não na fila de
          hoje.
        </p>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleCsvFile(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          loading={csvResolving}
          onClick={() => csvInputRef.current?.click()}
          icon={<Upload className="h-4 w-4" />}
        >
          Enviar arquivo .csv
        </Button>
        {csvMsg && <p className="text-sm">{csvMsg}</p>}

        {stagedRows.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-medium">{stagedRows.length} música(s) para importar</p>
            <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {stagedRows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-hover px-3 py-2">
                  {row.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- external Spotify cover art
                    <img src={row.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{row.title}</p>
                    {row.artist && <p className="truncate text-xs text-muted">{row.artist}</p>}
                    {row.notOnSpotify && <p className="truncate text-xs text-amber-400">Não encontrada no Spotify</p>}
                  </div>
                  <IconButton
                    variant="ghost"
                    icon={<X className="h-4 w-4" />}
                    aria-label="Remover"
                    className="h-7 w-7"
                    onClick={() => removeStagedRow(row.id)}
                  />
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <input
                className="w-24 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Artista (opcional)"
                value={manualArtist}
                onChange={(e) => setManualArtist(e.target.value)}
              />
              <input
                className="w-24 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Título"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManualStagedRow()}
              />
              <IconButton
                icon={<Plus className="h-4 w-4" />}
                aria-label="Adicionar linha"
                disabled={!manualTitle.trim()}
                onClick={addManualStagedRow}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={downloadStagedCsv} icon={<Download className="h-4 w-4" />}>
                Baixar .csv
              </Button>
              <Button loading={importing} onClick={confirmImport} icon={<Sparkles className="h-4 w-4" />} className="flex-1">
                Confirmar importação
              </Button>
            </div>
          </div>
        )}

        {importResultMsg && <p className="text-sm">{importResultMsg}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Sparkles className="h-4 w-4" /> Já prontas
        </h2>
        {storage && !storage.available && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p>
              A pasta das músicas não está acessível — o HD está conectado? As músicas não vão tocar até ela voltar.
              <span className="block break-all text-xs text-muted">{storage.dir}</span>
            </p>
          </div>
        )}
        {library.length === 0 && <p className="text-sm text-muted">Nenhuma música processada ainda.</p>}
        {library.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-4 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Filtrar por título ou artista"
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
            />
          </div>
        )}
        {library.length > 0 && filteredLibrary.length === 0 && (
          <p className="text-sm text-muted">Nenhuma música encontrada para &quot;{libraryFilter}&quot;.</p>
        )}
        <ul className="flex flex-col gap-2">
          {filteredLibrary.map((song) => (
            <li key={song.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
              {song.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- external, unsized YouTube thumbnail
                <img src={song.thumbnail_url} alt="" className="h-10 w-14 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                  <Music2 className="h-4 w-4 text-muted" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-medium">{song.title}</p>
                  {hasLyrics(song) ? (
                    <span title="Letra disponível">
                      <Mic2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                    </span>
                  ) : (
                    <IconButton
                      variant="ghost"
                      icon={<RefreshCw className="h-3.5 w-3.5" />}
                      aria-label="Sem letra — tentar buscar de novo"
                      title="Sem letra — tentar buscar de novo"
                      loading={retryingLyricsIds.has(song.id)}
                      onClick={() => retryLyrics(song.id)}
                      className="h-6 w-6 shrink-0"
                    />
                  )}
                </div>
                {song.artist_guess && <p className="truncate text-xs text-muted">{song.artist_guess}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {isHost && (
                  <IconButton
                    variant="ghost"
                    icon={<FolderOpen className="h-4 w-4" />}
                    aria-label="Abrir pasta da música"
                    title="Abrir pasta da música"
                    loading={openingFolderId === song.id}
                    onClick={() => openSongFolder(song.id)}
                  />
                )}
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
    <aside className="hidden xl:block">
      <div className="sticky top-0 h-screen py-8">
        <div className="flex h-full w-full max-w-md flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-4">
          <h2 className="flex items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
            <span className="flex items-center gap-2">
              <ListMusic className="h-4 w-4" /> Fila do palco
            </span>
            {queue.length > 0 && <span className="text-xs font-normal normal-case">{queue.length} música(s)</span>}
          </h2>
          <div className="flex-1 overflow-y-auto">{queueList}</div>
        </div>
      </div>
    </aside>
    </div>
  );
}
