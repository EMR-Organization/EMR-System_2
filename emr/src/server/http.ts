import "server-only";
import { env } from "@/server/env";

/**
 * CSRF protection for route handlers (server actions get this from Next.js):
 * a state-changing request must come from a page on this same site. Browsers
 * always send Origin on cross-site POSTs and can't fake it. X-Forwarded-Host
 * only counts behind our own proxy (TRUST_PROXY), as for client IPs.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = (env().TRUST_PROXY && request.headers.get("x-forwarded-host")) || request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
