import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeCa } from "../../scripts/make-ca";

// The hub's certificate authority. Devices trust its root, so what matters is
// what a stolen hub could do with the one key it keeps (the intermediate's):
// sign certificates for the local network, and nothing on the internet.

const dir = mkdtempSync(path.join(tmpdir(), "emr-ca-"));
const ca = makeCa("test-hub");
const file = (name: string, content: string) => {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
};
const rootFile = file("root.crt", ca.rootPem);
const interFile = file("intermediate.crt", ca.intermediatePem);
const interKey = file("intermediate.key", ca.intermediateKeyPem);

/** What a stolen intermediate key could sign: a server certificate for `san`. */
function leafFor(san: string): string {
  const name = san.replace(/[^a-z0-9]/gi, "_");
  const key = path.join(dir, `${name}.key`);
  const csr = path.join(dir, `${name}.csr`);
  const ext = file(`${name}.ext`, `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
  execFileSync("openssl", ["req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", key, "-out", csr, "-subj", "/"], { stdio: "ignore" });
  const out = path.join(dir, `${name}.crt`);
  execFileSync("openssl", ["x509", "-req", "-in", csr, "-CA", interFile, "-CAkey", interKey, "-CAcreateserial", "-out", out, "-days", "1", "-extfile", ext], { stdio: "ignore" });
  return out;
}
const verifies = (leaf: string) =>
  spawnSync("openssl", ["verify", "-CAfile", rootFile, "-untrusted", interFile, "-purpose", "sslserver", leaf], { encoding: "utf8" });

describe("hub certificate authority", () => {
  it("is a root and a name-constrained intermediate it signed; the root's key is never returned", () => {
    const root = new X509Certificate(ca.rootPem);
    const inter = new X509Certificate(ca.intermediatePem);
    expect(root.ca && inter.ca).toBe(true);
    expect(inter.checkIssued(root) && inter.verify(root.publicKey)).toBe(true);
    expect(root.verify(root.publicKey)).toBe(true);
    expect(new Date(inter.validTo) < new Date(root.validTo)).toBe(true);
    expect(Object.keys(ca)).toEqual(["rootPem", "intermediatePem", "intermediateKeyPem"]);
    const text = execFileSync("openssl", ["x509", "-in", interFile, "-noout", "-text"], { encoding: "utf8" });
    expect(text).toMatch(/Name Constraints: critical/);
    expect(text).toMatch(/pathlen:0/);
  });

  it("vouches for the hub's names and local addresses", () => {
    for (const san of ["DNS:emr-hub.local", "DNS:localhost", "IP:192.168.8.20", "IP:10.1.2.3", "IP:172.20.10.2", "IP:127.0.0.1"]) {
      const r = verifies(leafFor(san));
      expect(r.status, `${san}: ${r.stdout}${r.stderr}`).toBe(0);
    }
  });

  it("refuses anything on the internet, even signed with the hub's key", () => {
    for (const san of ["DNS:www.example-bank.com", "DNS:mail.google.com", "IP:8.8.8.8", "DNS:local.example.com"]) {
      const r = verifies(leafFor(san));
      expect(r.status, san).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/permitted subtree violation|name constraint/i);
    }
  });
});
