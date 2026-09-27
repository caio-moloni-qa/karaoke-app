import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to dev-mode resources (HMR, etc.)
  // by default — only `localhost` is trusted out of the box. Phones/other
  // devices on the LAN hit the dev server via its LAN IP instead, which
  // silently broke the client bootstrap for them specifically (desktop
  // testing via localhost never showed the problem). Add your machine's
  // current LAN IP here if it changes (e.g. after a DHCP lease renewal).
  // 192-168-15-5.sslip.io is a free wildcard-DNS hostname that resolves
  // straight to 192.168.15.5 — used so the phone accesses the app via a
  // real-looking hostname instead of a bare IP. YouTube's embedded IFrame
  // player showed "video unavailable" only when accessed via the raw IP
  // (confirmed: the same video played fine on desktop via localhost),
  // consistent with known issues in YouTube's embed origin validation for
  // bare-IP origins.
  allowedDevOrigins: ["192.168.15.5", "192-168-15-5.sslip.io"],
};

export default nextConfig;
