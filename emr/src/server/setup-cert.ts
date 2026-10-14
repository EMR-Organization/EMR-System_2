import "server-only";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { env } from "@/server/env";

// The field install's Caddy root certificate, offered on /setup before sign-in
// so phones and laptops can trust the hub's HTTPS. It's a public certificate
// (no private key), so serving it to anyone on the network is fine.

export type RootCertificate = { pem: string; der: Buffer; fingerprint: string; validTo: Date };

export async function rootCertificate(): Promise<RootCertificate | null> {
  const file = env().CADDY_ROOT_CERT;
  if (!file) return null;
  const pem = await readFile(file, "utf8").catch(() => null);
  if (!pem) return null;
  try {
    const cert = new X509Certificate(pem);
    if (!cert.ca) return null;
    return { pem: cert.toString(), der: cert.raw, fingerprint: cert.fingerprint256, validTo: new Date(cert.validTo) };
  } catch {
    return null;
  }
}
