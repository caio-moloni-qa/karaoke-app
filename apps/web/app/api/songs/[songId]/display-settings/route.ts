import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

interface DisplaySettingsBody {
  artUrl?: string | null;
  blur?: number;
  opacity?: number;
  contrast?: number;
  mixInstrumentalVol?: number;
  mixLeadVol?: number;
  mixBackingVol?: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ songId: string }> }) {
  const { songId } = await params;
  const body = (await request.json()) as DisplaySettingsBody;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("song_display_settings").upsert(
    {
      song_id: songId,
      art_url: body.artUrl ?? null,
      blur: body.blur ?? 0,
      opacity: body.opacity ?? 0.6,
      contrast: body.contrast ?? 1,
      mix_instrumental_vol: body.mixInstrumentalVol ?? 1,
      mix_lead_vol: body.mixLeadVol ?? 1,
      mix_backing_vol: body.mixBackingVol ?? 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "song_id" }
  );

  if (error) return NextResponse.json({ error: "Failed to save display settings" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
