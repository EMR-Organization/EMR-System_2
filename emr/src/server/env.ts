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
   * "1" only when the app is reachable solely through Caddy (the field setup binds
   * it to 127.0.0.1). Then X-Forwarded-For is the real client IP. Otherwise the
   * header is ignored, because anyone could set it.
   */
  TRUST_PROXY: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),
});

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
