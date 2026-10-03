import { createClient } from "@supabase/supabase-js";

// The database runs on this machine (local Supabase on port 54321), so its
// URL is configured as 127.0.0.1 — which on a phone means the phone itself.
// Browsers reach it on whatever host they loaded the page from instead
// (e.g. the PC's LAN IP), so it keeps working when DHCP hands out a new IP.
function browserSupabaseUrl(): string {
  const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const isLoopback = configured.hostname === "127.0.0.1" || configured.hostname === "localhost";
  if (isLoopback && typeof window !== "undefined") {
    configured.hostname = window.location.hostname;
  }
  return configured.origin;
}

export function createBrowserClient() {
  return createClient(browserSupabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
