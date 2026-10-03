import { NextResponse } from "next/server";
import { networkInterfaces } from "node:os";

// Virtual adapters (WSL, Docker, Hyper-V, VPNs) have IPs phones on the
// Wi-Fi can't reach — skip them when picking the address to share.
const VIRTUAL = /vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|tailscale|zerotier/i;

function lanIp(): string | null {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, ifaces]) =>
    (ifaces ?? [])
      .filter((i) => i.family === "IPv4" && !i.internal && !VIRTUAL.test(name))
      .map((i) => i.address)
  );
  // Home routers almost always hand out 192.168.x.x; prefer that if several.
  return candidates.find((ip) => ip.startsWith("192.168.")) ?? candidates[0] ?? null;
}

// The URL phones should use to reach this server — for the stage's QR code
// when the stage itself was opened as localhost on the host PC.
export async function GET(request: Request) {
  const ip = lanIp();
  const port = (request.headers.get("host") ?? "").split(":")[1] ?? "3000";
  return NextResponse.json({ lanUrl: ip ? `http://${ip}:${port}` : null });
}
