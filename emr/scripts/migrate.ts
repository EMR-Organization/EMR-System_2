// Applies database migrations without the Prisma CLI, for the Windows field
// bundle (which ships no Prisma engines). Same files, same bookkeeping table
// (_prisma_migrations, same checksums), so `prisma migrate deploy/status` on a
// developer machine agrees with it.
//
// Creates the database first if it doesn't exist. Each migration runs in its
// own transaction; a failed one is rolled back and stops the run.
//
//   node tools/migrate.mjs [migrations folder]     (DATABASE_OWNER_URL from the environment)
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const LOCK_KEY = 72_017_003;

export async function migrate(ownerUrl: string, folder: string, log: (line: string) => void = console.log): Promise<string[]> {
  await createDatabaseIfMissing(ownerUrl, log);
  const names = readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(folder, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();
  if (names.length === 0) throw new Error(`No migrations found in ${folder}`);

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const { rows } = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`,
    );
    const failed = rows.find((r) => r.finished_at === null && r.rolled_back_at === null);
    if (failed) throw new Error(`Migration ${failed.migration_name} failed earlier and needs attention before anything else is applied`);
    const applied = new Map(rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null).map((r) => [r.migration_name, r.checksum]));
    const unknown = [...applied.keys()].filter((n) => !names.includes(n));
    if (unknown.length) throw new Error(`The database has migrations this version doesn't know (${unknown.join(", ")}): is this an older copy of the app?`);

    const done: string[] = [];
    for (const name of names) {
      // Hash the file as stored in git (LF), so a CRLF checkout on Windows gives the same checksum.
      const sql = readFileSync(path.join(folder, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const known = applied.get(name);
      if (known) {
        if (known !== checksum) log(`! ${name} was changed after it was applied (checksum differs); leaving it as it is`);
        continue;
      }
      log(`Applying ${name}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed and was rolled back: ${err instanceof Error ? err.message : err}`);
      }
      done.push(name);
    }
    return done;
  } finally {
    await client.end();
  }
}

async function createDatabaseIfMissing(ownerUrl: string, log: (line: string) => void) {
  const url = new URL(ownerUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name "${name}"`);
  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
      log(`Created database ${name}`);
    }
  } finally {
    await client.end();
  }
}

// Run directly (not when imported by a test).
if (process.argv[1] && /migrate\.(ts|mjs)$/.test(process.argv[1])) {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const folder = process.argv[2] ?? path.resolve("prisma/migrations");
  if (!ownerUrl) {
    console.error("DATABASE_OWNER_URL must be set");
    process.exit(1);
  }
  migrate(ownerUrl, folder)
    .then((done) => console.log(done.length ? `Applied ${done.length} migration(s).` : "Database is up to date."))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
