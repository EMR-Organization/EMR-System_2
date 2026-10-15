import "server-only";
import { z } from "zod";
import { auditOnly } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { backupFilePath, createBackup, listBackupSummaries, type BackupSummary } from "@/server/backup";
import { NotFoundError, ValidationError } from "@/server/errors";
import { offsiteTarget, offsiteUploads, uploadBackupsOffsite, type OffsiteResult } from "@/server/offsite";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Admin → Backups. The nightly backup runs the same createBackup() from
// scripts/backup.ts (scheduled by the field setup); restoring is a command-line
// job (scripts/restore.ts) because it replaces the database.

export type BackupListItem = BackupSummary & { offsiteAt: Date | null };

/** Backups on this laptop, newest first, with when each was copied offsite (if offsite backups are set up). */
export async function listBackups(): Promise<BackupListItem[]> {
  const actor = await requireUser();
  await assertCan(actor, "backup.run");
  const target = offsiteTarget();
  const [backups, uploads] = await Promise.all([listBackupSummaries(), target ? offsiteUploads(target) : new Map<string, Date>()]);
  return backups.map((b) => ({ ...b, offsiteAt: uploads.get(b.name) ?? null }));
}

/** Whether offsite copies are set up, and where they go (bucket and folder; never the keys). */
export async function offsiteSettings(): Promise<{ configured: boolean; label: string | null }> {
  const actor = await requireUser();
  await assertCan(actor, "backup.run");
  const target = offsiteTarget();
  return { configured: target !== null, label: target?.label ?? null };
}

/** "Copy offsite now", for when the hub happens to have internet. The nightly job does the same. */
export async function runOffsiteUpload(): Promise<OffsiteResult[]> {
  const actor = await requireUser();
  await assertCan(actor, "backup.run");
  if (!offsiteTarget()) throw new ValidationError({}, "offsiteNotSetUp");
  return uploadBackupsOffsite(actor);
}

export async function runBackup(): Promise<BackupSummary> {
  const actor = await requireUser();
  await assertCan(actor, "backup.run");
  return createBackup(actor);
}

/** The encrypted file, for copying to a USB stick from another laptop. Audited. */
export async function backupForDownload(name: unknown): Promise<{ path: string; fileName: string; sizeBytes: number }> {
  const actor = await requireUser();
  const backupName = parse(z.string().max(64), name);
  await assertCan(actor, "backup.run");
  const backup = (await listBackupSummaries()).find((b) => b.name === backupName);
  const file = backupFilePath(backupName);
  if (!backup || !file) throw new NotFoundError();
  await auditOnly(actor, { action: "backup.download", entity: "Backup", entityId: backup.name });
  return { path: file, fileName: `${backup.name}.hfbak`, sizeBytes: backup.sizeBytes };
}
