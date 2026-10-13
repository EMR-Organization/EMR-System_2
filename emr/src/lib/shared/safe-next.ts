const BASE = "http://internal.invalid";

/**
 * Where to go after signing in. Only same-site paths are allowed, so a link
 * like /login?next=https://evil.example can't bounce someone off-site.
 *
 * Browsers silently drop tabs and newlines in URLs and treat "\" like "/", so
 * "/\t/evil.example" or "/\evil.example" would become "//evil.example". Those
 * are rejected outright, and whatever's left must resolve to our own origin.
 */
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || /[\u0000-\u001F\u007F\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
