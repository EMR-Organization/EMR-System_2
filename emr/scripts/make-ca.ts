// Creates the certificate authority behind the hub's HTTPS (run by setup).
//
// Phones and laptops install the root certificate from /setup. A root a phone
// trusts could vouch for ANY website, so its private key must never sit on a
// laptop that can be stolen. So:
//   - root:          made here, signs the intermediate, and its key is thrown away
//                    (it only ever exists in this process's memory);
//   - intermediate:  the only key Caddy gets. Name-constrained to *.local,
//                    localhost and private IP ranges, so even if the laptop is
//                    stolen, the key can't impersonate a bank or email site to
//                    anyone who installed the root.
// Both are also limited to TLS certificates (extended key usage: server and
// client auth, exactly what Caddy puts on the hub's certificate), so the key
// can't sign code or email (S/MIME) either: those carry no DNS name, so the
// name constraints alone wouldn't stop them.
// The intermediate is valid 3 years; after that, setup -NewCertificates makes a
// new pair and every device installs the new root (the old key is gone).
//
//   node tools/make-ca.mjs <folder> [<label>]     writes root.crt, intermediate.crt, intermediate.key
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------- minimal DER encoding (just what X.509 needs) ----------

function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}
const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
const set = (...parts: Buffer[]) => tlv(0x31, ...parts);
const octets = (b: Buffer) => tlv(0x04, b);
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
function integer(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const trimmed = b.subarray(i);
  return tlv(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
}
const int = (n: number) => integer(Buffer.from([n]));
function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * a + b];
  for (const v of rest) {
    const chunk = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) chunk.unshift((x & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}
function bitString(b: Buffer, unusedBits = 0): Buffer {
  return tlv(0x03, Buffer.from([unusedBits]), b);
}
function utcTime(d: Date): Buffer {
  const s = d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"; // YYMMDDHHMMSSZ
  return tlv(0x17, Buffer.from(s, "ascii"));
}
const name = (cn: string) => seq(set(seq(oid("2.5.4.10"), tlv(0x0c, Buffer.from("Humanity First EMR")))), set(seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn, "utf8")))));
const extension = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

const ECDSA_SHA256 = seq(oid("1.2.840.10045.4.3.2"));
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
const KEY_CERT_SIGN = 0x04;
const CRL_SIGN = 0x02;

/** Where certificates from this CA may be used: this kind of network, nothing on the internet. */
export const PERMITTED = {
  dns: ["local", "localhost"],
  ip: [
    ["10.0.0.0", "255.0.0.0"],
    ["172.16.0.0", "255.240.0.0"],
    ["192.168.0.0", "255.255.0.0"],
    ["127.0.0.0", "255.0.0.0"],
  ],
};

function nameConstraints(): Buffer {
  const ipBytes = (a: string) => Buffer.from(a.split(".").map(Number));
  const subtrees = [
    ...PERMITTED.dns.map((d) => seq(tlv(0x82, Buffer.from(d, "ascii")))),
    ...PERMITTED.ip.map(([addr, mask]) => seq(tlv(0x87, Buffer.concat([ipBytes(addr), ipBytes(mask)])))),
  ];
  return seq(tlv(0xa0, ...subtrees));
}

function keyId(publicKey: KeyObject): Buffer {
  // RFC 5280 method 1: SHA-1 of the subjectPublicKey bits (the EC point).
  const spki = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha1").update(spki.subarray(spki.length - 65)).digest();
}

function certificate(o: {
  subject: string;
  issuer: string;
  publicKey: KeyObject;
  signer: KeyObject;
  issuerKeyId: Buffer;
  notBefore: Date;
  notAfter: Date;
  pathLen: number;
}): Buffer {
  const ski = keyId(o.publicKey);
  const extensions = [
    extension("2.5.29.19", true, seq(bool(true), int(o.pathLen))),
    extension("2.5.29.15", true, bitString(Buffer.from([KEY_CERT_SIGN | CRL_SIGN]), 1)),
    extension("2.5.29.14", false, octets(ski)),
    extension("2.5.29.35", false, seq(tlv(0x80, o.issuerKeyId))),
    // On the root too, for the clients that also enforce constraints on trust anchors.
    extension("2.5.29.30", true, nameConstraints()),
    // Not critical: clients that enforce EKU on CAs (Windows, Apple, Chrome) apply it through the chain.
    extension("2.5.29.37", false, seq(oid(SERVER_AUTH), oid(CLIENT_AUTH))),
  ];
  const tbs = seq(
    tlv(0xa0, int(2)), // v3
    integer(Buffer.concat([Buffer.from([0x40 | (randomBytes(1)[0] & 0x3f)]), randomBytes(15)])),
    ECDSA_SHA256,
    name(o.issuer),
    seq(utcTime(o.notBefore), utcTime(o.notAfter)),
    name(o.subject),
    o.publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(...extensions)),
  );
  return seq(tbs, ECDSA_SHA256, bitString(sign("sha256", tbs, o.signer)));
}

const pem = (label: string, der: Buffer) => `-----BEGIN ${label}-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

export function makeCa(label: string, now = new Date()) {
  const root = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const inter = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const year = (n: number) => new Date(Date.UTC(now.getUTCFullYear() + n, now.getUTCMonth(), now.getUTCDate()));
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000); // an hour back, for clocks slightly behind
  const stamp = now.toISOString().slice(0, 10);
  const rootName = `HF EMR Local Authority (${label}, ${stamp})`;
  const rootDer = certificate({ subject: rootName, issuer: rootName, publicKey: root.publicKey, signer: root.privateKey, issuerKeyId: keyId(root.publicKey), notBefore, notAfter: year(10), pathLen: 1 });
  const interDer = certificate({
    subject: `HF EMR Hub CA (${label}, ${stamp})`,
    issuer: rootName,
    publicKey: inter.publicKey,
    signer: root.privateKey,
    issuerKeyId: keyId(root.publicKey),
    notBefore,
    notAfter: year(3),
    pathLen: 0,
  });
  // root.privateKey goes out of scope here and is never written anywhere.
  return {
    rootPem: pem("CERTIFICATE", rootDer),
    intermediatePem: pem("CERTIFICATE", interDer),
    intermediateKeyPem: inter.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

if (process.argv[1] && /make-ca\.(ts|mjs)$/.test(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: make-ca <folder> [<label>]");
    process.exit(1);
  }
  const label = (process.argv[3] ?? "hub").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 40) || "hub";
  const ca = makeCa(label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "root.crt"), ca.rootPem);
  writeFileSync(path.join(dir, "intermediate.crt"), ca.intermediatePem);
  writeFileSync(path.join(dir, "intermediate.key"), ca.intermediateKeyPem, { mode: 0o600 });
  console.log(`Created this laptop's HTTPS certificate authority in ${dir} (the root's private key was not kept).`);
}
