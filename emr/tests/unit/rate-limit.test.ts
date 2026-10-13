import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, rateLimit, resetRateLimits } from "@/server/auth/rate-limit";
import { RateLimitError } from "@/server/errors";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit, then blocks until the window passes", () => {
    const { max, windowMs } = LIMITS.resetCode;
    const t0 = 1_000_000;
    for (let i = 0; i < max; i++) rateLimit("resetCode", "1.2.3.4", t0 + i);
    expect(() => rateLimit("resetCode", "1.2.3.4", t0 + max)).toThrow(RateLimitError);
    expect(() => rateLimit("resetCode", "5.6.7.8", t0 + max)).not.toThrow(); // other IPs unaffected
    expect(() => rateLimit("resetCode", "1.2.3.4", t0 + windowMs + max)).not.toThrow();
  });
});
