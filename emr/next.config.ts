import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Baseline headers for every response. The Content-Security-Policy (with per-request nonces)
// is added in src/proxy.ts in Phase 9; HSTS is set by Caddy, which terminates HTTPS.
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The standalone output is what ships to the field. File tracing follows the
  // app's dynamic file paths (photos, backups) and would copy the project's
  // local data/ folder (backups, photos) and sources into it; none of it belongs there.
  outputFileTracingExcludes: {
    "*": ["data/**", "dist/**", "deploy/**", "tests/**", "scripts/**", "src/**", "prisma/**", "*.md", "components.json", "tsconfig.json", ".env*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
