import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to dev-mode resources (HMR, etc.)
  // by default — only `localhost` is trusted out of the box. Phones/other
  // devices on the LAN hit the dev server via its LAN IP instead, which
  // silently broke the client bootstrap for them specifically (desktop
  // testing via localhost never showed the problem). Add your machine's
  // current LAN IP here if it changes (e.g. after a DHCP lease renewal).
  allowedDevOrigins: ["192.168.15.5"],
};

export default nextConfig;
