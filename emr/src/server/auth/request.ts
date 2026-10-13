import "server-only";
import { headers } from "next/headers";
import { env } from "@/server/env";

/** The current request's headers (works in server components and server actions). */
export async function requestHeaders(): Promise<Headers> {
  return new Headers(await headers());
}

/**
 * The client's IP address, used for rate limiting and the audit log.
 *
 * Only trusted with TRUST_PROXY=1, which the field setup sets because there the
 * app listens on 127.0.0.1 and only Caddy can reach it; Caddy overwrites
 * X-Forwarded-For with the real client address. Without it the header could be
 * anything a client sends, so we ignore it and every request shares one label:
 * the rate limits get stricter (one bucket), never bypassable.
 */
export function clientIp(h: Headers): string {
  if (!env().TRUST_PROXY) return "direct";
  const forwarded = h.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || "unknown";
}

export function userAgent(h: Headers): string | null {
  return h.get("user-agent")?.slice(0, 300) ?? null;
}
