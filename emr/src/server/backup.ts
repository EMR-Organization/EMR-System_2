import "server-only";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { audit, latestCheckpoint, type AuditSubject, type Checkpoint } from "@/server/audit";
import { db } from "@/server/db";
import { env } from "@/server/env";

// Encrypted backups (spec: Backups; "Data at rest").
//
// A backup is one file, <name>.hfbak:
//   "HFEMRBK1" | salt (16) | iv (12) | key check (16) | AES-256-GCM ciphertext | tag (16)
// The key is derived from BACKUP_KEY and the per-file salt; the key check
// tells "wrong key" apart from "damaged file" before decrypting anything. Inside is a simple
// streamed archive: manifest.json, db.dump (pg_dump custom format) and every
// photo. Nothing unencrypted is written to disk while backing up.
//
// Next to it, <name>.json is a small signed (HMAC) summary for the backups
// list: when, how big, and the audit checkpoint at the time, which the audit
// screen can verify the live log against.
//
// pg_dump connects as the app role (DATABASE_URL), which can read everything,
// so the web app never needs the database owner's password.

const MAGIC = Buffer.from("HFEMRBK1");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHECK_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES + CHECK_BYTES;
export const BACKUP_FORMAT_VERSION = 1;
export const KEEP_DAYS = 14;
const NAME = /^emr-\d{8}-\d{6}-[0-9a-f]{6}$/;

export type BackupManifest = {
  formatVersion: number;
  name: string;
  createdAt: string;
  nodeId: string;
  checkpoint: Checkpoint | null;
  counts: { patients: number; photos: number; auditEntries: number };
};

export type BackupSummary = BackupManifest & { sizeBytes: number; sha256: string };

function backupDir(): string {
  return path.resolve(env().BACKUP_DIR);
}

function deriveKey(salt: Buffer, purpose: "file" | "check" | "summary"): Buffer {
  return Buffer.from(hkdfSync("sha256", env().BACKUP_KEY, salt, `hf-emr backup v1 ${purpose}`, 32));
}

function keyCheck(salt: Buffer): Buffer {
  return createHmac("sha256", deriveKey(salt, "check")).update("hf-emr backup key check").digest().subarray(0, CHECK_BYTES);
}

const SUMMARY_SALT = Buffer.from("hf-emr backup summary");

function signSummary(summary: BackupSummary): string {
  return createHmac("sha256", deriveKey(SUMMARY_SALT, "summary")).update(JSON.stringify(summary)).digest("hex");
}

/** pg_dump / pg_restore, from PG_BIN_DIR when set (the Windows bundle), else PATH. */
export function pgTool(name: "pg_dump" | "pg_restore"): string {
  const dir = env().PG_BIN_DIR;
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  return dir ? path.join(dir, exe) : exe;
}

/** libpq environment for a connection URL, so the password never appears on a command line. */
export function pgEnv(connectionString: string, database?: string): Record<string, string> {
  const url = new URL(connectionString);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database ?? decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
  };
}

// ---------- archive framing: [u32 header length][header JSON] then [u32 n][n bytes]... [u32 0]; [u32 0] ends ----------

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

type Entry = { name: string; data: AsyncIterable<Buffer> | Buffer };

async function* frame(entries: AsyncIterable<Entry> | Iterable<Entry>): AsyncGenerator<Buffer> {
  for await (const entry of entries) {
    const header = Buffer.from(JSON.stringify({ name: entry.name }));
    yield u32(header.length);
    yield header;
    const chunks = Buffer.isBuffer(entry.data) ? [entry.data] : entry.data;
    for await (const chunk of chunks) {
      if (chunk.length > 0) {
        yield u32(chunk.length);
        yield chunk;
      }
    }
    yield u32(0);
  }
  yield u32(0);
}

/** Reads exact byte counts from a stream of chunks. */
class ByteReader {
  private buffered: Buffer[] = [];
  private size = 0;
  private iterator: AsyncIterator<Buffer>;
  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }
  async read(n: number): Promise<Buffer> {
    while (this.size < n) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("Backup archive is truncated");
      this.buffered.push(next.value);
      this.size += next.value.length;
    }
    const all = Buffer.concat(this.buffered);
    this.buffered = [all.subarray(n)];
    this.size = all.length - n;
    return all.subarray(0, n);
  }
  /** Reads to the end (so a decipher stream gets to check its tag); anything left over is an error. */
  async finish(): Promise<void> {
    for (;;) {
      const next = await this.iterator.next();
      if (next.done) break;
      this.size += next.value.length;
    }
    if (this.size > 0) throw new Error("Backup archive has trailing data");
  }
}

/** Splits a decrypted archive into files under outDir. Entry names are checked, never trusted as paths. */
async function unframe(source: AsyncIterable<Buffer>, outDir: string): Promise<string[]> {
  const reader = new ByteReader(source);
  const names: string[] = [];
  for (;;) {
    const headerLength = (await reader.read(4)).readUInt32BE();
    if (headerLength === 0) {
      await reader.finish();
      return names;
    }
    if (headerLength > 1024) throw new Error("Backup archive header is invalid");
    const { name } = JSON.parse((await reader.read(headerLength)).toString("utf8")) as { name: unknown };
    if (typeof name !== "string" || !/^(manifest\.json|db\.dump|photos\/[0-9a-f-]{36}\.jpg)$/.test(name)) {
      throw new Error("Backup archive has an unexpected entry");
    }
    const file = await open(path.join(outDir, name), "wx");
    try {
      for (;;) {
        const n = (await reader.read(4)).readUInt32BE();
        if (n === 0) break;
        await file.write(await reader.read(n));
      }
    } finally {
      await file.close();
    }
    names.push(name);
  }
}

// ---------- create ----------

async function* pgDumpOutput(): AsyncGenerator<Buffer> {
  const child = spawn(pgTool("pg_dump"), ["--format=custom", "--no-password"], {
    env: { ...process.env, ...pgEnv(env().DATABASE_URL) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  for await (const chunk of child.stdout) yield chunk as Buffer;
  const code = await exited;
  if (code !== 0) throw new Error(`pg_dump failed (exit ${code}): ${stderr.trim().slice(0, 500)}`);
}

async function* photoEntries(): AsyncGenerator<Entry> {
  const dir = path.resolve(env().PHOTOS_DIR);
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const file of files.sort()) {
    if (/^[0-9a-f-]{36}\.jpg$/.test(file)) yield { name: `photos/${file}`, data: await readFile(path.join(dir, file)) };
  }
}

function timestampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `emr-${stamp}-${randomBytes(3).toString("hex")}`;
}

/**
 * Writes a new encrypted backup and its signed summary, records it in the
 * audit log, and removes backups older than KEEP_DAYS (always keeping the newest).
 * `subject` is the admin who asked, or null for the nightly job.
 */
export async function createBackup(subject: AuditSubject): Promise<BackupSummary> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const now = new Date();
  const name = timestampName(now);

  // The checkpoint is taken first, so the dump always contains it.
  const [checkpoint, patients, photos, auditEntries] = await Promise.all([
    latestCheckpoint(),
    db.patient.count(),
    db.photo.count(),
    db.auditLog.count(),
  ]);
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    name,
    createdAt: now.toISOString(),
    nodeId: env().NODE_ID,
    checkpoint,
    counts: { patients, photos, auditEntries },
  };

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt, "file"), iv);
  const target = path.join(dir, `${name}.hfbak`);
  const partial = `${target}.partial`;
  const hash = createHash("sha256");

  async function* entries(): AsyncGenerator<Entry> {
    yield { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) };
    yield { name: "db.dump", data: pgDumpOutput() };
    yield* photoEntries();
  }

  try {
    const out = await open(partial, "wx");
    try {
      const write = async (chunk: Buffer) => {
        hash.update(chunk);
        await out.write(chunk);
      };
      await write(Buffer.concat([MAGIC, salt, iv, keyCheck(salt)]));
      // pipeline (not .pipe) so a pg_dump failure rejects here instead of hanging.
      await pipeline(Readable.from(frame(entries())), cipher, async (encrypted: AsyncIterable<Buffer>) => {
        for await (const chunk of encrypted) await write(chunk);
      });
      await write(cipher.getAuthTag());
      await out.sync();
    } finally {
      await out.close();
    }
    if (await exists(target)) throw new Error(`Backup ${target} already exists`);
    await rename(partial, target);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }

  const { size } = await stat(target);
  const summary: BackupSummary = { ...manifest, sizeBytes: size, sha256: hash.digest("hex") };
  await writeFile(path.join(dir, `${name}.json`), JSON.stringify({ summary, mac: signSummary(summary) }, null, 2), { flag: "wx" });

  await db.$transaction((tx) =>
    audit(tx, subject, {
      action: "backup.create",
      entity: "Backup",
      entityId: name,
      details: { sizeBytes: size, checkpointId: checkpoint?.id ?? null, patients, photos },
    }),
  );
  await rotateBackups(now);
  return summary;
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Deletes backups older than KEEP_DAYS, but never the newest one. */
export async function rotateBackups(now = new Date()): Promise<string[]> {
  const backups = await listBackupSummaries();
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const b of backups.slice(1)) {
    if (new Date(b.createdAt).getTime() < cutoff) {
      await unlink(path.join(backupDir(), `${b.name}.hfbak`)).catch(() => undefined);
      await unlink(path.join(backupDir(), `${b.name}.json`)).catch(() => undefined);
      removed.push(b.name);
    }
  }
  return removed;
}

/** Backups with a valid signed summary, newest first. Anything else in the folder is ignored. */
export async function listBackupSummaries(): Promise<BackupSummary[]> {
  const dir = backupDir();
  const files = await readdir(dir).catch(() => [] as string[]);
  const summaries: BackupSummary[] = [];
  for (const file of files) {
    const name = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !NAME.test(name)) continue;
    try {
      const { summary, mac } = JSON.parse(await readFile(path.join(dir, file), "utf8")) as { summary: BackupSummary; mac: string };
      const expected = Buffer.from(signSummary(summary), "hex");
      const given = Buffer.from(String(mac), "hex");
      if (summary.name !== name || given.length !== expected.length || !timingSafeEqual(given, expected)) continue;
      summaries.push(summary);
    } catch {
      // unreadable or unsigned: not ours
    }
  }
  return summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** The path of a listed backup, or null. Names are checked against the pattern, never used raw. */
export function backupFilePath(name: string): string | null {
  return NAME.test(name) ? path.join(backupDir(), `${name}.hfbak`) : null;
}

// ---------- read (restore) ----------

/**
 * Decrypts a backup into outDir (manifest.json, db.dump, photos/). GCM
 * authenticates the whole file, so a wrong key or any tampering is detected;
 * in that case outDir is removed and nothing in it may be used.
 */
export async function extractBackup(file: string, outDir: string): Promise<BackupManifest> {
  const handle = await open(file, "r");
  let header: Buffer;
  let tag: Buffer;
  let size: number;
  try {
    size = (await handle.stat()).size;
    if (size < HEADER_BYTES + TAG_BYTES) throw new Error("Not a backup file (too short)");
    header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a backup file");
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES, MAGIC.length + SALT_BYTES + IV_BYTES);
  if (!timingSafeEqual(header.subarray(HEADER_BYTES - CHECK_BYTES), keyCheck(salt))) {
    throw new Error("Backup could not be decrypted: wrong BACKUP_KEY (this backup was made with a different key)");
  }

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(salt, "file"), iv);
  decipher.setAuthTag(tag);
  await mkdir(path.join(outDir, "photos"), { recursive: true });
  try {
    let names: string[] = [];
    // unframe reads to the very end, where the decipher checks the tag (and throws if it's wrong).
    await pipeline(createReadStream(file, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }), decipher, async (plain: AsyncIterable<Buffer>) => {
      names = await unframe(plain, outDir);
    });
    if (!names.includes("manifest.json") || !names.includes("db.dump")) throw new Error("Backup archive is incomplete");
    return JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8")) as BackupManifest;
  } catch (err) {
    await rm(outDir, { recursive: true, force: true });
    // The key was right, so a failed tag or unreadable contents means the bytes changed.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Backup could not be decrypted: the file was changed or damaged (${message})`);
  }
}
