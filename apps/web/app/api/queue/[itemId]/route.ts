import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Guests can only remove their own queue entry. The anon key's RLS policy on
// queue_items is wide open (`using (true)`), so ownership is enforced here
// instead, by checking the caller's client_token against the guest row that
// requested the item, before doing the write with the service-role key.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  const { clientToken } = (await request.json()) as { clientToken?: string };

  if (!clientToken) {
    return NextResponse.json({ error: "Missing clientToken" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: item, error: itemError } = await supabase
    .from("queue_items")
    .select("id, requested_by")
    .eq("id", itemId)
    .single();

  if (itemError || !item || !item.requested_by) {
    return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  }

  const { data: guest, error: guestError } = await supabase
    .from("guests")
    .select("id")
    .eq("id", item.requested_by)
    .eq("client_token", clientToken)
    .maybeSingle();

  if (guestError || !guest) {
    return NextResponse.json({ error: "Not the owner of this request" }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("queue_items")
    .update({ status: "removed" })
    .eq("id", itemId);

  if (updateError) {
    return NextResponse.json({ error: "Failed to remove item" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
