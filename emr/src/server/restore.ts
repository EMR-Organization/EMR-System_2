import "server-only";
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { audit, verifyChain, type ChainResult } from "@/server/audit";
import { extractBackup, pgEnv, pgTool, type BackupManifest } from "@/server/backup";
import { env } from "@/server/env";

// Restoring a backup (scripts/restore.ts). Never destructive by itself:
//   1. decrypt into a working folder next to the backups (same encrypted drive),
//   2. restore into a NEW database, as the owner role,
//   3. check it: the audit chain verifies and still has the backup's checkpoint,
//      and the patient count matches the manifest,
//   4. only with swap: rename the live database aside (kept, not dropped), put
//      the restored one in its place, and do the same with the photos folder.

export type RestoreResult = {
  database: string;
  manifest: BackupManifest;
  chain: ChainResult;
  patients: number;
  photos: number;
  swapped: { previousDatabase: string; previousPhotosDir: string | null } | null;
};

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

async function runPgRestore(ownerUrl: string, database: string, dumpFile: string): Promise<void> {
  const child = spawn(pgTool("pg_restore"), ["--no-owner", "--exit-on-error", "--single-transaction", "--no-password", `--dbname=${database}`, dumpFile], {
    env: { ...process.env, ...pgEnv(ownerUrl, database) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 1));
  });
  if (code !== 0) throw new Error(`pg_restore failed (exit ${code}): ${stderr.trim().slice(0, 1000)}`);
}

export async function restoreBackup(options: {
  file: string;
  ownerUrl: string;
  /** Replace the live database and photos with the restored copy. Stop the app first. */
  swap?: boolean;
  /** Name for the new database (default: <live name>_restore_<time>). */
  database?: string;
}): Promise<RestoreResult> {
  const { file, ownerUrl, swap = false } = options;
  const liveDb = decodeURIComponent(new URL(ownerUrl).pathname.slice(1));
  const database = options.database ?? `${liveDb}_restore_${stamp()}`;
  if (!IDENT.test(database) || !IDENT.test(liveDb)) throw new Error("Database names may only use a-z, 0-9 and _");

  const work = path.join(path.resolve(env().BACKUP_DIR), `.restore-${stamp()}-${process.pid}`);
  // Connected to the maintenance database: Postgres can't rename the database a session is using.
  const admin = new pg.Client({ connectionString: withDatabase(ownerUrl, "postgres") });
  await admin.connect();
  let created = false;
  try {
    const manifest = await extractBackup(file, work);

    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    await runPgRestore(ownerUrl, database, path.join(work, "db.dump"));

    const restored = new PrismaClient({ adapter: new PrismaPg({ connectionString: withDatabase(ownerUrl, database) }) });
    let chain: ChainResult;
    let patients: number;
    try {
      chain = await verifyChain({ client: restored, ...(manifest.checkpoint ? { checkpoint: manifest.checkpoint } : {}) });
      patients = await restored.patient.count();
      if (!chain.ok) throw new Error(`The restored audit log doesn't verify (entry ${chain.brokenAtId}, ${chain.reason}); not using it`);
      if (patients !== manifest.counts.patients) {
        throw new Error(`The restored database has ${patients} patients but the backup says ${manifest.counts.patients}; not using it`);
      }
      await restored.$transaction((tx) =>
        audit(tx, null, {
          action: "backup.restore",
          entity: "Backup",
          entityId: manifest.name,
          details: { checkpointId: manifest.checkpoint?.id ?? null, swapped: swap },
        }),
      );
    } finally {
      await restored.$disconnect();
    }

    const photoFiles = (await readdir(path.join(work, "photos"))).filter((f) => f.endsWith(".jpg"));
    let swapped: RestoreResult["swapped"] = null;
    if (swap) {
      const previousDatabase = `${liveDb}_before_restore_${stamp()}`;
      // Fails if anything is still connected to the live database: stop the app first.
      await admin.query(`ALTER DATABASE "${liveDb}" RENAME TO "${previousDatabase}"`);
      try {
        await admin.query(`ALTER DATABASE "${database}" RENAME TO "${liveDb}"`);
      } catch (err) {
        await admin.query(`ALTER DATABASE "${previousDatabase}" RENAME TO "${liveDb}"`);
        throw err;
      }
      created = false; // it's the live database now: never drop it below

      const photosDir = path.resolve(env().PHOTOS_DIR);
      const previousPhotosDir = `${photosDir}.before-restore-${stamp()}`;
      const hadPhotos = await rename(photosDir, previousPhotosDir).then(
        () => true,
        () => false,
      );
      await mkdir(path.dirname(photosDir), { recursive: true });
      await cp(path.join(work, "photos"), photosDir, { recursive: true });
      swapped = { previousDatabase, previousPhotosDir: hadPhotos ? previousPhotosDir : null };
    }

    return { database: swap ? liveDb : database, manifest, chain, patients, photos: photoFiles.length, swapped };
  } catch (err) {
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}"`).catch(() => undefined);
    throw err;
  } finally {
    await admin.end();
    await rm(work, { recursive: true, force: true });
  }
}
