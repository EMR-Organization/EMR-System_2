import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { auditOnly, type AuditSubject } from "@/server/audit";
import { backupFilePath, listBackupSummaries, type BackupSummary } from "@/server/backup";
import { db } from "@/server/db";
import { env } from "@/server/env";

// Offsite copies of backups (spec: Backups). A lost or stolen hub, plus the
// USB stick in the same bag, would otherwise mean every record is gone.
//
// - Only the .hfbak files (AES-256-GCM, BACKUP_KEY never leaves the hub) and
//   their signed .json summaries are uploaded. The storage provider only ever
//   sees ciphertext; without BACKUP_KEY a copy is useless.
// - Before uploading, each file is checked against the SHA-256 in its signed
//   summary, so a damaged local file is never sent as if it were good, and the
//   provider checks the same SHA-256 on arrival (x-amz-checksum-sha256).
// - Uploads never overwrite (If-None-Match: *), so the hub's keys can be
//   upload-only: with object lock on the bucket, nobody holding the hub can
//   delete or replace copies already offsite.
// - Each upload is recorded in the audit log ("backup.offsite"), which is also
//   how the next run knows what's already there.
// - The hub is offline most of the time: a failed connection just stops the
//   run; the next one (after the nightly backup, or by hand) carries on.

export type OffsiteTarget = { bucket: string; prefix: string; endpoint: string | null; region: string; label: string };

export type OffsiteResult = {
  name: string;
  status: "uploaded" | "alreadyThere" | "damaged" | "failed" | "notTried";
  error?: string;
};

/** Where offsite copies go, or null when offsite backups aren't set up. */
export function offsiteTarget(): OffsiteTarget | null {
  const e = env();
  if (!e.OFFSITE_BUCKET) return null;
  const endpoint = e.OFFSITE_ENDPOINT ?? null;
  const host = endpoint ? new URL(endpoint).host : "s3";
  return { bucket: e.OFFSITE_BUCKET, prefix: e.OFFSITE_PREFIX, endpoint, region: e.OFFSITE_REGION, label: `${host}/${e.OFFSITE_BUCKET}/${e.OFFSITE_PREFIX}` };
}

function client(target: OffsiteTarget): S3Client {
  const e = env();
  return new S3Client({
    region: target.region,
    ...(target.endpoint && { endpoint: target.endpoint, forcePathStyle: true }),
    credentials: { accessKeyId: e.OFFSITE_ACCESS_KEY_ID!, secretAccessKey: e.OFFSITE_SECRET_ACCESS_KEY! },
    // We send our own SHA-256 checksum; don't add others some providers reject.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
    // Offline should fail in seconds, not hang the nightly job.
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
  });
}

/** Backups already uploaded to this target, from the audit log. */
export async function offsiteUploads(target: OffsiteTarget): Promise<Map<string, Date>> {
  const entries = await db.auditLog.findMany({
    where: { action: "backup.offsite", entity: "Backup", details: { path: ["target"], equals: target.label } },
    select: { entityId: true, ts: true },
  });
  return new Map(entries.filter((e) => e.entityId).map((e) => [e.entityId!, e.ts]));
}

class DamagedBackupError extends Error {}

async function sha256Of(file: string): Promise<Buffer> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest();
}

/** PUT that never replaces an existing object. Returns false if the object was already there. */
async function putNew(s3: S3Client, target: OffsiteTarget, key: string, body: Buffer | NodeJS.ReadableStream, size: number, sha256: Buffer): Promise<boolean> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: target.bucket,
        Key: key,
        Body: body as Buffer,
        ContentLength: size,
        ContentType: "application/octet-stream",
        ChecksumSHA256: sha256.toString("base64"),
        IfNoneMatch: "*",
      }),
    );
    return true;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) return false;
    throw err;
  }
}

async function uploadOne(s3: S3Client, target: OffsiteTarget, backup: BackupSummary): Promise<"uploaded" | "alreadyThere"> {
  const file = backupFilePath(backup.name);
  if (!file) throw new DamagedBackupError("not a backup name");
  const { size } = await stat(file);
  const sha256 = await sha256Of(file);
  if (size !== backup.sizeBytes || sha256.toString("hex") !== backup.sha256) {
    throw new DamagedBackupError("the file no longer matches its signed summary (damaged or changed); not uploaded");
  }
  const created = await putNew(s3, target, `${target.prefix}${backup.name}.hfbak`, createReadStream(file), size, sha256);
  // The summary goes second: a copy with a summary is always complete.
  const summary = await readFile(path.join(path.dirname(file), `${backup.name}.json`));
  await putNew(s3, target, `${target.prefix}${backup.name}.json`, summary, summary.length, createHash("sha256").update(summary).digest());
  return created ? "uploaded" : "alreadyThere";
}

let running: Promise<OffsiteResult[]> | null = null;

/**
 * Uploads every local backup that isn't offsite yet, newest first (the newest
 * matters most when the connection is short). A damaged file is skipped; a
 * connection or storage error stops the run. Two runs at once share one.
 * `subject` is the admin who asked, or null for the nightly job.
 */
export function uploadBackupsOffsite(subject: AuditSubject): Promise<OffsiteResult[]> {
  running ??= run(subject).finally(() => (running = null));
  return running;
}

async function run(subject: AuditSubject): Promise<OffsiteResult[]> {
  const target = offsiteTarget();
  if (!target) throw new Error("Offsite backups aren't set up (set OFFSITE_BUCKET, OFFSITE_ACCESS_KEY_ID and OFFSITE_SECRET_ACCESS_KEY)");
  const done = await offsiteUploads(target);
  const pending = (await listBackupSummaries()).filter((b) => !done.has(b.name));
  const s3 = client(target);
  const results: OffsiteResult[] = [];
  try {
    for (const [i, backup] of pending.entries()) {
      try {
        const status = await uploadOne(s3, target, backup);
        await auditOnly(subject, {
          action: "backup.offsite",
          entity: "Backup",
          entityId: backup.name,
          details: { target: target.label, sizeBytes: backup.sizeBytes, alreadyThere: status === "alreadyThere" },
        });
        results.push({ name: backup.name, status });
      } catch (err) {
        if (err instanceof DamagedBackupError) {
          results.push({ name: backup.name, status: "damaged", error: err.message });
          continue;
        }
        results.push({ name: backup.name, status: "failed", error: describe(err) });
        for (const rest of pending.slice(i + 1)) results.push({ name: rest.name, status: "notTried" });
        break;
      }
    }
  } finally {
    s3.destroy();
  }
  if (results.some((r) => r.status === "failed" || r.status === "damaged")) {
    await auditOnly(subject, {
      action: "backup.offsite.failed",
      entity: "Backup",
      details: { target: target.label, problems: results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`) },
    });
  }
  return results;
}

/** A short reason, without credentials or request details. */
function describe(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (e.code && ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET"].includes(e.code)) return `no connection (${e.code})`;
  if (e.name === "TimeoutError") return "no connection (timed out)";
  if (status === 403) return "the storage refused the upload (check the access key and its permissions)";
  if (status === 404) return "the bucket doesn't exist";
  return `${e.name ?? "Error"}${status ? ` (HTTP ${status})` : ""}: ${(e.message ?? String(err)).slice(0, 200)}`;
}
