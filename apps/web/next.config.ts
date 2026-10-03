import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// Next.js blocks cross-origin requests to dev-mode resources (HMR, client
// bootstrap) from anything but localhost. Phones on the Wi-Fi reach the dev
// server through the host's LAN IP, so that IP must be allowed — otherwise
// the control panel loads as a blank page on phones only. It used to be
// hardcoded and broke every time DHCP handed out a new address, so it's now
// read from the network interfaces at startup (restart after switching
// networks). The sslip.io names resolve straight back to those IPs, for
// opening the app through a hostname instead of a bare IP.
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface!.address);
}

const lanIps = lanAddresses();

const nextConfig: NextConfig = {
  allowedDevOrigins: [...lanIps, ...lanIps.map((ip) => `${ip.replace(/\./g, "-")}.sslip.io`)],
};

export default nextConfig;
