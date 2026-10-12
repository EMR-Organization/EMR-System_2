import "server-only";
import { z } from "zod";

// Server configuration, validated once on first use. A missing or weak value
// stops the server with a clear message instead of failing open later.

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
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
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
      throw new Error(`Invalid server configuration:\n${problems.join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}
