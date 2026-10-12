/**
 * Where to go after signing in. Only same-site paths are allowed, so a link
 * like /login?next=https://evil.example can't bounce someone off-site.
 */
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
