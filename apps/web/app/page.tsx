import Link from "next/link";
import { Monitor, Smartphone, Sparkles } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Room } from "@/lib/types";

// Room list is always fetched live — this page depends on Supabase being
// configured, so it can't be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = createBrowserClient();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const roomList = (rooms as Room[]) ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-accent to-accent-2">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl font-semibold">Karaoke</h1>
      </div>

      {roomList.length === 0 ? (
        <p className="text-center text-sm text-muted">
          Nenhuma sala encontrada. Rode o seed em <code>supabase/seed.sql</code> para criar a
          sala de demonstração (veja o README).
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
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
