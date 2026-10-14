import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// /setup offers Caddy's root certificate before sign-in. Only a CA certificate
// from the configured file is ever served; anything else means "not available".

const dir = mkdtempSync(path.join(tmpdir(), "emr-cert-"));
function makeCert(name: string, ca: boolean): string {
  const file = path.join(dir, `${name}.crt`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-keyout", path.join(dir, `${name}.key`), "-out", file, "-days", "30", "-subj", `/CN=${name}`,
    "-addext", `basicConstraints=critical,CA:${ca ? "TRUE" : "FALSE"}`,
  ], { stdio: "ignore" });
  return file;
}

async function rootCertificateWith(file: string | undefined) {
  vi.resetModules();
  if (file === undefined) vi.stubEnv("CADDY_ROOT_CERT", undefined);
  else vi.stubEnv("CADDY_ROOT_CERT", file);
  return (await import("@/server/setup-cert")).rootCertificate();
}

afterEach(() => vi.unstubAllEnvs());

describe("rootCertificate", () => {
  it("reads the CA certificate, with its fingerprint and DER bytes", async () => {
    const file = makeCert("HF EMR Local Authority", true);
    const cert = await rootCertificateWith(file);
    expect(cert).not.toBeNull();
    const parsed = new X509Certificate(cert!.der);
    expect(parsed.subject).toContain("HF EMR Local Authority");
    expect(cert!.fingerprint).toBe(parsed.fingerprint256);
  });

  it("serves nothing when unset, missing, not a certificate, or not a CA", async () => {
    expect(await rootCertificateWith(undefined)).toBeNull();
    expect(await rootCertificateWith(path.join(dir, "missing.crt"))).toBeNull();
    expect(await rootCertificateWith(path.join(dir, "HF EMR Local Authority.key"))).toBeNull();
    expect(await rootCertificateWith(makeCert("leaf", false))).toBeNull();
  });
});
