import { describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ TRUST_PROXY: false }));
vi.mock("@/server/env", () => ({ env: () => settings }));

import { isSameOrigin } from "@/server/http";

const post = (headers: Record<string, string>) => new Request("http://hub/api/x", { method: "POST", headers });

describe("isSameOrigin (CSRF check for route handlers)", () => {
  it("needs an Origin matching the host", () => {
    expect(isSameOrigin(post({ host: "emr-hub.local", origin: "https://emr-hub.local" }))).toBe(true);
    expect(isSameOrigin(post({ host: "emr-hub.local", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(post({ host: "emr-hub.local", origin: "null" }))).toBe(false);
    expect(isSameOrigin(post({ host: "emr-hub.local" }))).toBe(false);
  });

  it("ignores X-Forwarded-Host unless behind our proxy", () => {
    const spoofed = post({ host: "emr-hub.local", origin: "https://evil.example", "x-forwarded-host": "evil.example" });
    settings.TRUST_PROXY = false;
    expect(isSameOrigin(spoofed)).toBe(false);
    settings.TRUST_PROXY = true;
    expect(isSameOrigin(post({ host: "127.0.0.1:3000", origin: "https://emr-hub.local", "x-forwarded-host": "emr-hub.local" }))).toBe(true);
  });
});
