import Link from "next/link";
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Karaoke</h1>

      {roomList.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nenhuma sala encontrada. Rode o seed em <code>supabase/seed.sql</code> para criar a
          sala de demonstração da MVP1 (veja o README).
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {roomList.map((room) => (
            <li
              key={room.id}
              className="flex items-center justify-between rounded border border-black/10 px-4 py-3 dark:border-white/10"
            >
              <span className="font-medium">{room.name}</span>
              <div className="flex gap-3 text-sm">
                <Link className="underline" href={`/stage/${room.id}`}>
                  Palco
                </Link>
                <Link className="underline" href={`/room/${room.id}`}>
                  Controle
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
