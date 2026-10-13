import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/server/env";

const random = () => randomBytes(32).toString("base64url");
const base = {
  DATABASE_URL: "postgresql://emr_app:x@127.0.0.1:5432/emr",
  ALLOWED_EMAIL_DOMAINS: "example.org",
  NODE_ID: "hub",
};

afterEach(() => vi.unstubAllEnvs());

describe("parseEnv secrets", () => {
  it("accepts the documented placeholders in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() =>
      parseEnv({ ...base, BETTER_AUTH_SECRET: "dev-only-secret-not-for-real-use-0123456789", AUDIT_KEY: "ci-only-secret-not-for-real-use-0123456789" }),
    ).not.toThrow();
  });

  it("refuses placeholder or low-variety secrets in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const placeholder of [
      "dev-only-secret-not-for-real-use-0123456789",
      "ci-only-secret-not-for-real-use-0123456789",
      "changeme-changeme-changeme-changeme-changeme",
      "a".repeat(40),
      "abababababababababababababababababababab",
    ]) {
      expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: placeholder, AUDIT_KEY: random() }), placeholder).toThrow(/placeholder/);
      expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: placeholder }), placeholder).toThrow(/placeholder/);
    }
  });

  it("accepts generated secrets in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(parseEnv({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random(), TRUST_PROXY: "1" })).toMatchObject({ TRUST_PROXY: true });
  });

  it("requires both secrets and defaults TRUST_PROXY off", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: random() })).toThrow(/AUDIT_KEY/);
    expect(parseEnv({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random() }).TRUST_PROXY).toBe(false);
  });
});
