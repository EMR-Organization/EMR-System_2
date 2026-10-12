import "server-only";
import { headers } from "next/headers";

/** The current request's headers (works in server components and server actions). */
export async function requestHeaders(): Promise<Headers> {
  return new Headers(await headers());
}

/**
 * The client's IP address. In the field, Caddy is the only thing that can reach
 * the app (it binds 127.0.0.1) and it overwrites X-Forwarded-For with the real
 * client address, so the last entry is trustworthy. In development there's no
 * proxy and this is just a label for rate limiting.
 */
export function clientIp(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || "unknown";
}

export function userAgent(h: Headers): string | null {
  return h.get("user-agent")?.slice(0, 300) ?? null;
}
