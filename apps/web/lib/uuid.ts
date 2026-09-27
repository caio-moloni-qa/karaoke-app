// crypto.randomUUID() requires a "secure context" (HTTPS, or localhost
// specifically) per the Web Crypto spec — it's silently undefined over
// plain HTTP on a LAN IP, which is exactly how phones reach this app during
// local dev/hosting. crypto.getRandomValues() has no such restriction, so
// it's used as a manual UUID v4 fallback.
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
