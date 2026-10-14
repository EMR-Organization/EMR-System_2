import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

// Encrypted, authenticated files for moving data between laptops: the
// provisioning file (hub -> fallback) and sync bundles (fallback -> hub).
//
//   "HFEMRSY1" | purpose (1) | salt (16) | iv (12) | key check (16) | AES-256-GCM ciphertext | tag (16)
//
// The key comes from SYNC_KEY (shared by the hub and its fallbacks, set by the
// field setup) via HKDF with a per-file salt. The purpose byte is authenticated
// too, so a provisioning file can never be imported as a bundle or vice versa.

const MAGIC = Buffer.from("HFEMRSY1");
const PURPOSES = { provision: 1, bundle: 2 } as const;
export type SealPurpose = keyof typeof PURPOSES;
const SALT = 16;
const IV = 12;
const CHECK = 16;
const TAG = 16;
const HEADER = MAGIC.length + 1 + SALT + IV + CHECK;

function keys(salt: Buffer, purpose: SealPurpose) {
  const derive = (use: string) => Buffer.from(hkdfSync("sha256", env().SYNC_KEY, salt, `hf-emr ${purpose} v1 ${use}`, 32));
  return {
    file: derive("file"),
    check: createHmac("sha256", derive("check")).update("hf-emr key check").digest().subarray(0, CHECK),
  };
}

export class SealedFileError extends Error {
  constructor(readonly reason: "notOurs" | "wrongKind" | "wrongKey" | "damaged") {
    super(`Sealed file rejected: ${reason}`);
  }
}

export function seal(purpose: SealPurpose, plaintext: Buffer): Buffer {
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const k = keys(salt, purpose);
  const header = Buffer.concat([MAGIC, Buffer.from([PURPOSES[purpose]]), salt, iv, k.check]);
  const cipher = createCipheriv("aes-256-gcm", k.file, iv);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

export function unseal(purpose: SealPurpose, file: Buffer): Buffer {
  if (file.length < HEADER + TAG || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new SealedFileError("notOurs");
  if (file[MAGIC.length] !== PURPOSES[purpose]) throw new SealedFileError("wrongKind");
  const header = file.subarray(0, HEADER);
  const salt = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT);
  const iv = header.subarray(MAGIC.length + 1 + SALT, MAGIC.length + 1 + SALT + IV);
  const k = keys(salt, purpose);
  if (!timingSafeEqual(header.subarray(HEADER - CHECK), k.check)) throw new SealedFileError("wrongKey");
  const decipher = createDecipheriv("aes-256-gcm", k.file, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(file.subarray(file.length - TAG));
  try {
    return Buffer.concat([decipher.update(file.subarray(HEADER, file.length - TAG)), decipher.final()]);
  } catch {
    throw new SealedFileError("damaged");
  }
}
