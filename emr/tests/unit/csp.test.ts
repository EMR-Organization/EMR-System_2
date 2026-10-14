import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, SONNER_STYLE_HASHES } from "@/lib/shared/csp";

const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

describe("Content-Security-Policy", () => {
  it("runs only scripts carrying this request's nonce, and never eval in production", () => {
    const d = directives(contentSecurityPolicy("abc123"));
    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(directives(contentSecurityPolicy("x", true))["script-src"]).toContain("'unsafe-eval'");
  });

  it("locks down everything else to this hub", () => {
    const d = directives(contentSecurityPolicy("n"));
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    expect(d["style-src"]).not.toContain("'unsafe-inline'");
  });

  it("allows exactly the CSS the installed sonner inserts", () => {
    const source = readFileSync(path.join(process.cwd(), "node_modules/sonner/dist/index.mjs"), "utf8");
    const literal = source.match(/__insertCSS\("((?:[^"\\]|\\.)*)"\)/)?.[1];
    expect(literal, "sonner no longer inserts its CSS the same way; recheck the CSP").toBeDefined();
    const hash = createHash("sha256").update(JSON.parse(`"${literal}"`)).digest("base64");
    expect(SONNER_STYLE_HASHES).toContain(`sha256-${hash}`);
    expect(directives(contentSecurityPolicy("n"))["style-src"]).toContain(`'sha256-${hash}'`);
  });
});
