import "server-only";

/**
 * CSRF protection for route handlers (server actions get this from Next.js):
 * a state-changing request must come from a page on this same site. Browsers
 * always send Origin on cross-site POSTs and can't fake it.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
