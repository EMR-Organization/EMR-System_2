import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";

// The field bundle's migration runner (no Prisma CLI on Windows) against a
// brand-new database: it must leave exactly what `prisma migrate deploy` would,
// so the Prisma CLI on a developer machine agrees with it.

const name = `emr_migrate_${Date.now()}`;
const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const ownerUrl = withDb(process.env.DATABASE_OWNER_URL!, name);
const prisma = (...args: string[]) =>
  spawnSync("npx", ["prisma", ...args], { env: { ...process.env, DATABASE_OWNER_URL: ownerUrl }, encoding: "utf8" });

afterAll(async () => {
  const admin = new pg.Client({ connectionString: withDb(process.env.DATABASE_OWNER_URL!, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

describe("migration runner", () => {
  const quiet = () => {};

  it("creates the database, applies every migration, and Prisma sees it as up to date", async () => {
    const applied = await migrate(ownerUrl, path.resolve("prisma/migrations"), quiet);
    expect(applied.length).toBeGreaterThan(3);

    const status = prisma("migrate", "status");
    expect(status.status, status.stdout + status.stderr).toBe(0);
    expect(status.stdout).toContain("Database schema is up to date");
    const diff = prisma("migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code");
    expect(diff.status, diff.stdout + diff.stderr).toBe(0);
  }, 120_000);

  it("running it again applies nothing", async () => {
    expect(await migrate(ownerUrl, path.resolve("prisma/migrations"), quiet)).toEqual([]);
  });

  it("a failing migration is rolled back, recorded nowhere, and stops the run", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "emr-migrations-"));
    cpSync("prisma/migrations", folder, { recursive: true });
    const bad = path.join(folder, "29990101000000_broken");
    cpSync(path.join(folder, readFirst(folder)), bad, { recursive: true });
    writeFileSync(path.join(bad, "migration.sql"), `CREATE TABLE "ShouldNotExist" (id int);\nSELECT * FROM "NoSuchTable";\n`);

    await expect(migrate(ownerUrl, folder, quiet)).rejects.toThrow(/29990101000000_broken failed and was rolled back/);
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const { rows } = await client.query(`SELECT to_regclass('"ShouldNotExist"') AS t, (SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '29990101000000_broken')::int AS n`);
    await client.end();
    expect(rows[0]).toEqual({ t: null, n: 0 });
  });

  it("refuses a database that's newer than the app", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "emr-migrations-"));
    cpSync("prisma/migrations", folder, { recursive: true });
    rmSync(path.join(folder, "20261014041027_sync"), { recursive: true });
    await expect(migrate(ownerUrl, folder, quiet)).rejects.toThrow(/doesn't know \(20261014041027_sync\)/);
  });
});

function readFirst(folder: string): string {
  return readdirSync(folder, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()[0];
}
