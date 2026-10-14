import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { createBackup, extractBackup, listBackupSummaries, rotateBackups } from "@/server/backup";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { restoreBackup } from "@/server/restore";
import { listBackups, runBackup } from "@/server/services/backups";
import { signIn } from "@/server/services/users";
import { browser } from "./fake-request";
import { createUser } from "./fixtures";

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

async function signInAs(user: { email: string; password: string }) {
  browser.reset();
  await signIn({ email: user.email, password: user.password });
}

const backupDir = () => process.env.BACKUP_DIR!;
const fileOf = (name: string) => path.join(backupDir(), `${name}.hfbak`);

describe("backups", () => {
  it("are admin-only, encrypted, listed with a checkpoint, and audited", async () => {
    await signInAs(await createUser());
    await expect(runBackup()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listBackups()).rejects.toBeInstanceOf(ForbiddenError);

    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    const backup = await runBackup();
    expect(backup.checkpoint).not.toBeNull();
    expect((await listBackups())[0]).toMatchObject({ name: backup.name, sizeBytes: backup.sizeBytes });

    const bytes = readFileSync(fileOf(backup.name));
    expect(bytes.subarray(0, 8).toString()).toBe("HFEMRBK1");
    // Encrypted: no table names or SQL in the file.
    expect(bytes.includes(Buffer.from("AuditLog"))).toBe(false);
    expect(bytes.includes(Buffer.from("PGDMP"))).toBe(false);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "backup.create", entityId: backup.name } });
    expect(entry.details).toMatchObject({ checkpointId: backup.checkpoint!.id });
  });

  it("decrypt only with the right key and untouched bytes", async () => {
    const photo = `${crypto.randomUUID()}.jpg`;
    writeFileSync(path.join(process.env.PHOTOS_DIR!, photo), "jpeg bytes");
    const backup = await createBackup(null);
    const out = await mkdtemp(path.join(tmpdir(), "emr-extract-"));
    const manifest = await extractBackup(fileOf(backup.name), path.join(out, "ok"));
    expect(manifest).toMatchObject({ name: backup.name, checkpoint: backup.checkpoint });
    expect(readFileSync(path.join(out, "ok", "db.dump")).subarray(0, 5).toString()).toBe("PGDMP");
    expect(readFileSync(path.join(out, "ok", "photos", photo), "utf8")).toBe("jpeg bytes");

    const tampered = path.join(out, "tampered.hfbak");
    const bytes = readFileSync(fileOf(backup.name));
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    writeFileSync(tampered, bytes);
    await expect(extractBackup(tampered, path.join(out, "bad"))).rejects.toThrow(/the file was changed or damaged/);
    expect(readdirSync(out)).not.toContain("bad"); // nothing half-decrypted is left behind

    const key = process.env.BACKUP_KEY;
    vi.resetModules();
    process.env.BACKUP_KEY = "a-completely-different-backup-key-0123456789";
    try {
      const fresh = await import("@/server/backup");
      // Module-level env() is cached; a fresh import reads the new key.
      const { env } = await import("@/server/env");
      expect(env().BACKUP_KEY).toBe(process.env.BACKUP_KEY);
      await expect(fresh.extractBackup(fileOf(backup.name), path.join(out, "wrongkey"))).rejects.toThrow(/wrong BACKUP_KEY/);
      // Summaries signed with the real key don't show up under another one.
      expect(await fresh.listBackupSummaries()).toEqual([]);
    } finally {
      process.env.BACKUP_KEY = key;
      vi.resetModules();
    }
  });

  it("ignores summaries that were edited", async () => {
    const backup = await createBackup(null);
    const summaryFile = path.join(backupDir(), `${backup.name}.json`);
    const signed = JSON.parse(readFileSync(summaryFile, "utf8"));
    signed.summary.checkpoint.hash = "f".repeat(64);
    writeFileSync(summaryFile, JSON.stringify(signed));
    expect((await listBackupSummaries()).map((b) => b.name)).not.toContain(backup.name);
  });

  it("keeps 14 days but never deletes the newest", async () => {
    await createBackup(null);
    const names = (await listBackupSummaries()).map((b) => b.name);
    const in20Days = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const removed = await rotateBackups(in20Days);
    expect(removed).toEqual(names.slice(1));
    expect((await listBackupSummaries()).map((b) => b.name)).toEqual([names[0]]);
  });

  it("restore into a new database, with the audit chain checked against the checkpoint", async () => {
    const backup = await createBackup(null);
    const ownerUrl = process.env.DATABASE_OWNER_URL!;
    const result = await restoreBackup({ file: fileOf(backup.name), ownerUrl });
    try {
      expect(result).toMatchObject({ chain: { ok: true }, patients: backup.counts.patients, swapped: null });
      expect(result.database).toMatch(/_restore_\d{8}_\d{6}$/);
      // The app role can use the restored copy (its grants came with the dump).
      const { default: pg } = await import("pg");
      const appUrl = new URL(process.env.DATABASE_URL!);
      appUrl.pathname = `/${result.database}`;
      const app = new pg.Client({ connectionString: appUrl.toString() });
      await app.connect();
      try {
        const { rows } = await app.query('SELECT count(*)::int AS n FROM "Patient"');
        expect(rows[0].n).toBe(backup.counts.patients);
        // Users come back; their sign-in sessions (tokens) were never in the backup.
        expect((await app.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n).toBeGreaterThan(0);
        expect((await app.query('SELECT count(*)::int AS n FROM "Session"')).rows[0].n).toBe(0);
        await expect(app.query('DELETE FROM "AuditLog"')).rejects.toThrow(/permission denied/);
      } finally {
        await app.end();
      }
    } finally {
      const { default: pg } = await import("pg");
      const admin = new pg.Client({ connectionString: ownerUrl });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS "${result.database}"`);
      await admin.end();
    }
  });

  it("refuses a restore whose audit log doesn't verify (e.g. the wrong AUDIT_KEY) and drops the copy", async () => {
    const backup = await createBackup(null);
    const ownerUrl = process.env.DATABASE_OWNER_URL!;
    const auditKey = process.env.AUDIT_KEY;
    vi.resetModules();
    process.env.AUDIT_KEY = "an-audit-key-from-some-other-install-0123456789";
    const database = `emr_badrestore_${Date.now()}`;
    try {
      const { restoreBackup: restoreWithOtherKey } = await import("@/server/restore");
      await expect(restoreWithOtherKey({ file: fileOf(backup.name), ownerUrl, database })).rejects.toThrow(/audit log doesn't verify/);
    } finally {
      process.env.AUDIT_KEY = auditKey;
      vi.resetModules();
    }
    const { default: pg } = await import("pg");
    const admin = new pg.Client({ connectionString: ownerUrl });
    await admin.connect();
    try {
      const { rows } = await admin.query("SELECT datname FROM pg_database WHERE datname = $1", [database]);
      if (rows.length > 0) await admin.query(`DROP DATABASE "${database}"`); // clean up even when the check below fails
      expect(rows).toEqual([]);
    } finally {
      await admin.end();
    }
  });

  it("restore accepts a backup taken while a patient was being registered", async () => {
    // Simulates a registration landing between the manifest's count and pg_dump's snapshot.
    const real = db.patient.count.bind(db.patient);
    const spy = vi.spyOn(db.patient, "count").mockImplementationOnce((async () => (await real()) - 1) as never);
    const backup = await createBackup(null);
    spy.mockRestore();
    const database = `emr_busyrestore_${Date.now()}`;
    try {
      await expect(
        restoreBackup({ file: path.join(process.env.BACKUP_DIR!, `${backup.name}.hfbak`), ownerUrl: process.env.DATABASE_OWNER_URL!, database }),
      ).resolves.toMatchObject({ chain: { ok: true } });
    } finally {
      const { default: pg } = await import("pg");
      const u = new URL(process.env.DATABASE_OWNER_URL!);
      u.pathname = "/postgres";
      const admin = new pg.Client({ connectionString: u.toString() });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  it("swap puts the restored copy in place and keeps the old database and photos aside", async () => {
    const { default: pg } = await import("pg");
    const ownerUrl = process.env.DATABASE_OWNER_URL!;
    const backup = await createBackup(null);
    // A throwaway "live" database, so the shared test database is never renamed.
    const live = `emr_swaptest_${Date.now()}`;
    await restoreBackup({ file: fileOf(backup.name), ownerUrl, database: live });
    const liveUrl = new URL(ownerUrl);
    liveUrl.pathname = `/${live}`;

    const photosBefore = process.env.PHOTOS_DIR!;
    writeFileSync(path.join(photosBefore, `${crypto.randomUUID()}.jpg`), "written after the backup");
    let result: Awaited<ReturnType<typeof restoreBackup>> | undefined;
    const admin = new pg.Client({ connectionString: ownerUrl });
    await admin.connect();
    try {
      result = await restoreBackup({ file: fileOf(backup.name), ownerUrl: liveUrl.toString(), swap: true });
      expect(result.database).toBe(live);
      const { rows } = await admin.query("SELECT datname FROM pg_database WHERE datname IN ($1, $2)", [live, result.swapped!.previousDatabase]);
      expect(rows.map((r) => r.datname).sort()).toEqual([live, result.swapped!.previousDatabase].sort());
      // The photos folder now holds exactly the backup's photos; the old one is kept beside it.
      expect(readdirSync(photosBefore).length).toBe(result.photos);
      expect(result.swapped!.previousPhotosDir).toMatch(/\.before-restore-/);
      expect(readdirSync(result.swapped!.previousPhotosDir!).length).toBe(result.photos + 1);
    } finally {
      // Throwaway databases only (emr_swaptest_*), whatever happened above.
      const { rows } = await admin.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [`${live}%`]);
      for (const { datname } of rows) await admin.query(`DROP DATABASE IF EXISTS "${datname}"`);
      await admin.end();
    }
  });
});
