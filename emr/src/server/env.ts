import "server-only";
import { z } from "zod";

// Server configuration, validated once on first use. A missing or weak value
// stops the server with a clear message instead of failing open later.

// Values from .env.example, CI and docs. Fine for development, never for a real install.
const PLACEHOLDER_SECRET = /dev-only|not-for-real-use|ci-only|change-?me|example/i;

function secret(name: string) {
  return z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine(
      (value) => process.env.NODE_ENV !== "production" || (!PLACEHOLDER_SECRET.test(value) && new Set(value).size >= 16),
      `${name} looks like a placeholder; run setup to generate a real one`,
    );
}

const schema = z.object({
  DATABASE_URL: z.string().url(),
  /** Signs session cookies and keys reset-code hashes. */
  BETTER_AUTH_SECRET: secret("BETTER_AUTH_SECRET"),
  /** Keys the audit-log hash chain. Separate so rotating the session secret never breaks the chain. */
  AUDIT_KEY: secret("AUDIT_KEY"),
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  NODE_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/, "NODE_ID may contain letters, digits, - and _ (max 32)"),
  /** Where photo files are stored. Relative paths are resolved from the working directory. */
  PHOTOS_DIR: z.string().min(1).default("data/photos"),
  /**
   * Encrypts backups. Keep a copy OFF the hub (with AUDIT_KEY): if the hub is
   * lost, its backups can't be restored without it.
   */
  BACKUP_KEY: secret("BACKUP_KEY"),
  /**
   * Encrypts provisioning files and sync bundles. The SAME value on the hub and
   * every fallback laptop of a deployment (the field setup copies it).
   */
  SYNC_KEY: secret("SYNC_KEY"),
  /** Where encrypted backups are written (kept 14 days). */
  BACKUP_DIR: z.string().min(1).default("data/backups"),
  /** Caddy's root certificate (field install), offered on /setup so devices can trust the hub's HTTPS. */
  CADDY_ROOT_CERT: z.string().optional(),
  /** Folder holding pg_dump / pg_restore when they aren't on PATH (the Windows bundle's PostgreSQL bin). */
  PG_BIN_DIR: z.string().optional(),
  /**
   * "1" only when the app is reachable solely through Caddy (the field setup binds
   * it to 127.0.0.1). Then X-Forwarded-For is the real client IP. Otherwise the
   * header is ignored, because anyone could set it.
   */
  TRUST_PROXY: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),
  /**
   * Offsite copies of the (already encrypted) backups, in any S3-compatible
   * bucket: AWS S3, Backblaze B2, Cloudflare R2, MinIO... All optional; set
   * OFFSITE_BUCKET and the two keys to turn it on. Use keys that may only
   * upload (no read, no delete), so a stolen hub can't remove the copies.
   */
  OFFSITE_BUCKET: optional(z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "OFFSITE_BUCKET is not a valid bucket name")),
  /** Leave empty for AWS S3; otherwise the provider's S3 endpoint. HTTPS only (except on this computer, for tests). */
  OFFSITE_ENDPOINT: optional(
    z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      }, "OFFSITE_ENDPOINT must be an https:// address"),
  ),
  OFFSITE_REGION: optional(z.string().regex(/^[a-z0-9-]{2,32}$/, "OFFSITE_REGION is not a valid region")).transform((v) => v ?? "us-east-1"),
  /** Folder inside the bucket, e.g. "hub-guatemala/". */
  OFFSITE_PREFIX: optional(z.string().regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/?$/, "OFFSITE_PREFIX may contain letters, digits, . _ - and /"))
    .transform((v) => (v ? v.replace(/\/?$/, "/") : "")),
  OFFSITE_ACCESS_KEY_ID: optional(z.string().max(256)),
  OFFSITE_SECRET_ACCESS_KEY: optional(z.string().max(256)),
}).superRefine((value, ctx) => {
  const keys = [value.OFFSITE_ACCESS_KEY_ID, value.OFFSITE_SECRET_ACCESS_KEY];
  if (value.OFFSITE_BUCKET && keys.some((k) => !k)) {
    ctx.addIssue({ code: "custom", path: ["OFFSITE_ACCESS_KEY_ID"], message: "offsite backups need OFFSITE_ACCESS_KEY_ID and OFFSITE_SECRET_ACCESS_KEY" });
  }
  if (!value.OFFSITE_BUCKET && (keys.some(Boolean) || value.OFFSITE_ENDPOINT)) {
    ctx.addIssue({ code: "custom", path: ["OFFSITE_BUCKET"], message: "offsite settings are set but OFFSITE_BUCKET is missing" });
  }
});

/** An unset or empty ("") variable counts as not set. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid server configuration:\n${problems.join("\n")}`);
  }
  return parsed.data;
}
