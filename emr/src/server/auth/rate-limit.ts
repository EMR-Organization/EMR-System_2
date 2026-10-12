import "server-only";
import { RateLimitError } from "@/server/errors";

// A small in-memory sliding-window limiter. The hub runs one Node process, so
// memory is the right place; it resets on restart, which is fine because
// per-account lockout (stored in the database) is the main brute-force defense.

type Bucket = number[];
const buckets = new Map<string, Bucket>();

export const LIMITS = {
  /** Sign-in attempts per IP. Generous, because a whole clinic can share one IP behind some routers. */
  signIn: { max: 30, windowMs: 5 * 60 * 1000 },
  /** Reset-code attempts per IP. */
  resetCode: { max: 10, windowMs: 15 * 60 * 1000 },
  /** Registrations per IP. */
  register: { max: 10, windowMs: 60 * 60 * 1000 },
  /** Password changes per user (keyed by user ID, not IP). */
  changePassword: { max: 5, windowMs: 15 * 60 * 1000 },
} as const;

export function rateLimit(kind: keyof typeof LIMITS, key: string, now = Date.now()): void {
  const { max, windowMs } = LIMITS[kind];
  const id = `${kind}:${key}`;
  const recent = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    buckets.set(id, recent);
    throw new RateLimitError();
  }
  recent.push(now);
  buckets.set(id, recent);

  // Keep memory bounded.
  if (buckets.size > 10_000) {
    for (const [k, times] of buckets) if (times.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
}

/** For tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
