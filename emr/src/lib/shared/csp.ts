/**
 * The Content-Security-Policy for every page (set per request in src/proxy.ts).
 *
 * - Scripts: only ones carrying this request's nonce, plus whatever those load
 *   ('strict-dynamic'). An injected <script> or onclick="" never runs.
 * - Styles: <style>/<link> need the nonce or to come from this hub, except the
 *   one stylesheet the toast library (sonner) inserts itself, allowed by its
 *   exact hash. style="" attributes are allowed (components position things
 *   with them, and a style attribute cannot run code).
 * - Everything else: this hub only. No framing, no plugins, forms post back here.
 * No upgrade-insecure-requests: Caddy redirects and sends HSTS in the field, and
 * dev/e2e servers are plain http on 127.0.0.1.
 */
/**
 * SHA-256 of the CSS sonner inserts at startup, and of the empty <style> it
 * inserts first. tests/unit/csp.test.ts recomputes it from the installed
 * sonner, so an upgrade that changes the CSS fails the tests, not the toasts.
 */
export const SONNER_STYLE_HASHES = [
  "sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY=",
  "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
];

export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // In development Next injects <style> tags without the nonce (hot reload,
    // error overlay). 'unsafe-inline' only works with no nonce or hash beside it.
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}' ${SONNER_STYLE_HASHES.map((h) => `'${h}'`).join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join("; ");
}
