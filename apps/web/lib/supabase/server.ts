import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS, only ever imported from server-side
// code (route handlers, server components) — never bundled for the browser.
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
