import Link from "next/link";
import { Mic2, Monitor, Smartphone } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Room } from "@/lib/types";

// Room list is always fetched live — this page depends on Supabase being
// configured, so it can't be prerendered at build time.
export const dynamic = "force-dynamic";

const PRIMARY_LINK =
  "inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-lg shadow-accent/20 transition-opacity hover:opacity-90";
const SECONDARY_LINK =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3.5 text-base font-medium transition-colors hover:bg-surface-hover";

export default async function Home() {
  const supabase = createBrowserClient();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const roomList = (rooms as Room[]) ?? [];
  const singleRoom = roomList.length === 1 ? roomList[0] : null;

  let nowPlayingTitle: string | null = null;
  if (singleRoom) {
    const { data: nowPlayingRow } = await supabase
      .from("queue_items")
      .select("songs(title)")
      .eq("room_id", singleRoom.id)
      .eq("status", "now_playing")
      .maybeSingle();
    nowPlayingTitle = (nowPlayingRow?.songs as unknown as { title: string } | null)?.title ?? null;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-accent to-accent-2 shadow-lg shadow-accent/30">
          <Mic2 className="h-9 w-9 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Karaoke</h1>
          <p className="text-muted">Sua festa, seu palco.</p>
        </div>
      </div>

      {nowPlayingTitle && (
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          Tocando agora: <span className="font-medium text-foreground">{nowPlayingTitle}</span>
        </div>
      )}

      {roomList.length === 0 && (
        <p className="text-sm text-muted">
          Nenhuma sala encontrada. Rode o seed em <code>supabase/seed.sql</code> para criar a
          sala de demonstração (veja o README).
        </p>
      )}

      {singleRoom && (
        <div className="flex w-full flex-col gap-3">
          <Link href={`/room/${singleRoom.id}`} className={PRIMARY_LINK}>
            <Smartphone className="h-5 w-5" /> Entrar como convidado
          </Link>
          <Link href={`/stage/${singleRoom.id}`} className={SECONDARY_LINK}>
            <Monitor className="h-5 w-5" /> Abrir palco
          </Link>
        </div>
      )}

      {roomList.length > 1 && (
        <ul className="flex w-full flex-col gap-3">
          {roomList.map((room) => (
            <li key={room.id} className="flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4">
              <span className="font-medium">{room.name}</span>
              <div className="flex gap-2 text-sm">
                <Link
                  href={`/stage/${room.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 transition-colors hover:bg-surface-hover"
                >
                  <Monitor className="h-3.5 w-3.5" /> Palco
                </Link>
                <Link
                  href={`/room/${room.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent to-accent-2 px-3 py-1.5 text-accent-foreground transition-opacity hover:opacity-90"
                >
                  <Smartphone className="h-3.5 w-3.5" /> Controle
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
