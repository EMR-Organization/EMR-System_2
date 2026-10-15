import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/server/env";

const random = () => randomBytes(32).toString("base64url");
const base = {
  DATABASE_URL: "postgresql://emr_app:x@127.0.0.1:5432/emr",
  ALLOWED_EMAIL_DOMAINS: "example.org",
  NODE_ID: "hub",
  BACKUP_KEY: randomBytes(32).toString("base64url"),
  SYNC_KEY: randomBytes(32).toString("base64url"),
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
      expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random(), BACKUP_KEY: placeholder }), placeholder).toThrow(/placeholder/);
    }
  });

  it("accepts generated secrets in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(parseEnv({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random(), TRUST_PROXY: "1" })).toMatchObject({ TRUST_PROXY: true });
  });

  it("requires every secret and defaults TRUST_PROXY off", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: random() })).toThrow(/AUDIT_KEY/);
    expect(() => parseEnv({ ...base, BACKUP_KEY: undefined, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random() })).toThrow(/BACKUP_KEY/);
    expect(parseEnv({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random() }).TRUST_PROXY).toBe(false);
  });
});

describe("parseEnv offsite backups", () => {
  const secrets = () => ({ ...base, BETTER_AUTH_SECRET: random(), AUDIT_KEY: random() });
  const keys = { OFFSITE_ACCESS_KEY_ID: "AKIAEXAMPLE", OFFSITE_SECRET_ACCESS_KEY: "secret" };

  it("are off unless a bucket is set, and empty values count as unset", () => {
    const off = parseEnv(secrets());
    expect(off.OFFSITE_BUCKET).toBeUndefined();
    expect(off).toMatchObject({ OFFSITE_REGION: "us-east-1", OFFSITE_PREFIX: "" });
    expect(parseEnv({ ...secrets(), OFFSITE_BUCKET: "", OFFSITE_ENDPOINT: "", OFFSITE_ACCESS_KEY_ID: "" }).OFFSITE_BUCKET).toBeUndefined();
  });

  it("need both keys with a bucket, and a bucket with any other setting", () => {
    expect(() => parseEnv({ ...secrets(), OFFSITE_BUCKET: "hf-emr-backups" })).toThrow(/OFFSITE_ACCESS_KEY_ID and OFFSITE_SECRET_ACCESS_KEY/);
    expect(() => parseEnv({ ...secrets(), ...keys })).toThrow(/OFFSITE_BUCKET is missing/);
    expect(parseEnv({ ...secrets(), ...keys, OFFSITE_BUCKET: "hf-emr-backups", OFFSITE_PREFIX: "hub-guatemala" })).toMatchObject({
      OFFSITE_BUCKET: "hf-emr-backups",
      OFFSITE_PREFIX: "hub-guatemala/",
    });
  });

  it("only send backups over HTTPS (plain http only to this computer, for tests)", () => {
    const withEndpoint = (OFFSITE_ENDPOINT: string) => () => parseEnv({ ...secrets(), ...keys, OFFSITE_BUCKET: "hf-emr-backups", OFFSITE_ENDPOINT });
    expect(withEndpoint("http://s3.example.com")).toThrow(/https/);
    expect(withEndpoint("http://192.168.1.20:9000")).toThrow(/https/);
    expect(withEndpoint("https://s3.us-west-004.backblazeb2.com")).not.toThrow();
    expect(withEndpoint("http://127.0.0.1:9100")).not.toThrow();
  });

  it("reject odd bucket names and folders", () => {
    const withValue = (extra: Record<string, string>) => () => parseEnv({ ...secrets(), ...keys, OFFSITE_BUCKET: "hf-emr-backups", ...extra });
    expect(withValue({ OFFSITE_BUCKET: "Has Spaces" })).toThrow(/bucket name/);
    expect(withValue({ OFFSITE_PREFIX: "/leading" })).toThrow(/OFFSITE_PREFIX/);
    expect(withValue({ OFFSITE_PREFIX: "a//b" })).toThrow(/OFFSITE_PREFIX/);
  });
});
