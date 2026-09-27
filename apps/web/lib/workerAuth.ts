import "server-only";
import { timingSafeEqual } from "node:crypto";

// Constant-time comparison so a mistimed response can't leak the shared
// secret one byte at a time.
export function isAuthorizedWorker(request: Request): boolean {
  const expected = process.env.WORKER_API_KEY;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  if (expectedBuf.length !== tokenBuf.length) return false;

  return timingSafeEqual(expectedBuf, tokenBuf);
}
