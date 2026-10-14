import "server-only";
import { z } from "zod";
import { auditOnly } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { backupFilePath, createBackup, listBackupSummaries, type BackupSummary } from "@/server/backup";
import { NotFoundError } from "@/server/errors";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Admin → Backups. The nightly backup runs the same createBackup() from
// scripts/backup.ts (scheduled by the field setup); restoring is a command-line
// job (scripts/restore.ts) because it replaces the database.

export async function listBackups(): Promise<BackupSummary[]> {
  const actor = await requireUser();
  await assertCan(actor, "backup.run");
  return listBackupSummaries();
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
