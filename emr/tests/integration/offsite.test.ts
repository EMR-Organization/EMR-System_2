import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CreateBucketCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Offsite copies, against a real S3-compatible server (versitygw in CI; see
// docs/offsite-backups.md for running one locally). Each run uses a bucket of
// its own, so earlier runs never count as "already offsite".
const S3 = {
  endpoint: process.env.OFFSITE_TEST_ENDPOINT,
  accessKeyId: process.env.OFFSITE_TEST_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.OFFSITE_TEST_SECRET_ACCESS_KEY ?? "",
};
const bucket = vi.hoisted(() => {
  const name = `emr-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (process.env.OFFSITE_TEST_ENDPOINT) {
    process.env.OFFSITE_BUCKET = name;
    process.env.OFFSITE_ENDPOINT = process.env.OFFSITE_TEST_ENDPOINT;
    process.env.OFFSITE_PREFIX = "hub-test";
    process.env.OFFSITE_ACCESS_KEY_ID = process.env.OFFSITE_TEST_ACCESS_KEY_ID;
    process.env.OFFSITE_SECRET_ACCESS_KEY = process.env.OFFSITE_TEST_SECRET_ACCESS_KEY;
  }
  return name;
});

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { createBackup } from "@/server/backup";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { uploadBackupsOffsite } from "@/server/offsite";
import { listBackups, offsiteSettings, runOffsiteUpload } from "@/server/services/backups";
import { signIn } from "@/server/services/users";
import { browser } from "./fake-request";
import { createUser } from "./fixtures";

if (process.env.CI && !S3.endpoint) throw new Error("CI must run the offsite tests: set OFFSITE_TEST_ENDPOINT");

const s3 = () =>
  new S3Client({
    region: "us-east-1",
    endpoint: S3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

async function remote(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch {
    return null;
  }
}

const local = (name: string, ext: "hfbak" | "json") => path.join(process.env.BACKUP_DIR!, `${name}.${ext}`);

async function signInAs(user: { email: string; password: string }) {
  browser.reset();
  await signIn({ email: user.email, password: user.password });
}

describe.skipIf(!S3.endpoint)("offsite backups", () => {
  beforeAll(async () => {
    await s3().send(new CreateBucketCommand({ Bucket: bucket }));
  });
  beforeEach(() => {
    browser.reset();
    resetRateLimits();
  });

  it("are admin-only", async () => {
    await signInAs(await createUser());
    await expect(runOffsiteUpload()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(offsiteSettings()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("upload the encrypted files byte for byte, newest first, once, and show it on the list", async () => {
    const older = await createBackup(null);
    const newer = await createBackup(null);
    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    expect(await offsiteSettings()).toEqual({ configured: true, label: `${new URL(S3.endpoint!).host}/${bucket}/hub-test/` });

    const results = await runOffsiteUpload();
    const ours = results.filter((r) => [older.name, newer.name].includes(r.name));
    expect(ours).toEqual([
      { name: newer.name, status: "uploaded" },
      { name: older.name, status: "uploaded" },
    ]);
    for (const b of [older, newer]) {
      expect((await remote(`hub-test/${b.name}.hfbak`))!.equals(readFileSync(local(b.name, "hfbak")))).toBe(true);
      expect((await remote(`hub-test/${b.name}.json`))!.equals(readFileSync(local(b.name, "json")))).toBe(true);
    }
    // Still the ciphertext: nothing readable leaves the hub.
    expect((await remote(`hub-test/${newer.name}.hfbak`))!.subarray(0, 8).toString()).toBe("HFEMRBK1");

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "backup.offsite", entityId: newer.name } });
    expect(entry.details).toMatchObject({ target: expect.stringContaining(bucket), alreadyThere: false });
    const listed = await listBackups();
    expect(listed.find((b) => b.name === newer.name)!.offsiteAt).toBeInstanceOf(Date);

    // A second run has nothing left to do.
    expect(await runOffsiteUpload()).toEqual([]);
  });

  it("never overwrite a copy that is already offsite", async () => {
    const backup = await createBackup(null);
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: `hub-test/${backup.name}.hfbak`, Body: "an earlier copy" }));
    const results = await uploadBackupsOffsite(null);
    expect(results.find((r) => r.name === backup.name)).toEqual({ name: backup.name, status: "alreadyThere" });
    expect((await remote(`hub-test/${backup.name}.hfbak`))!.toString()).toBe("an earlier copy");
  });

  it("don't send a damaged backup, and carry on with the others", async () => {
    const damaged = await createBackup(null);
    const good = await createBackup(null);
    const bytes = readFileSync(local(damaged.name, "hfbak"));
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    writeFileSync(local(damaged.name, "hfbak"), bytes);

    const results = await uploadBackupsOffsite(null);
    expect(results.find((r) => r.name === damaged.name)).toMatchObject({ status: "damaged" });
    expect(results.find((r) => r.name === good.name)).toEqual({ name: good.name, status: "uploaded" });
    expect(await remote(`hub-test/${damaged.name}.hfbak`)).toBeNull();
    expect(await db.auditLog.findFirst({ where: { action: "backup.offsite", entityId: damaged.name } })).toBeNull();
    await expect(db.auditLog.findFirst({ where: { action: "backup.offsite.failed" }, orderBy: { id: "desc" } })).resolves.toMatchObject({
      details: { problems: [expect.stringContaining(damaged.name)] },
    });
  });

  it("without a connection: stop quickly, record nothing as offsite, and leave the rest for next time", async () => {
    const backup = await createBackup(null);
    vi.resetModules();
    const endpoint = process.env.OFFSITE_ENDPOINT;
    process.env.OFFSITE_ENDPOINT = "http://127.0.0.1:9"; // nothing listens there
    try {
      const { uploadBackupsOffsite: upload } = await import("@/server/offsite");
      const started = Date.now();
      const results = await upload(null);
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(results[0]).toMatchObject({ name: backup.name, status: "failed", error: expect.stringMatching(/no connection/) });
      expect(results.slice(1).every((r) => r.status === "notTried")).toBe(true);
      expect(await db.auditLog.findFirst({ where: { action: "backup.offsite", entityId: backup.name } })).toBeNull();
    } finally {
      process.env.OFFSITE_ENDPOINT = endpoint;
      vi.resetModules();
    }
  });

  it("only ever writes inside the configured folder", async () => {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket }));
    const keys = (res.Contents ?? []).map((o) => o.Key!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => /^hub-test\/emr-\d{8}-\d{6}-[0-9a-f]{6}\.(hfbak|json)$/.test(k))).toBe(true);
  });
});
