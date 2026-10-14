import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "dotenv";

// Optional .env.test.local points tests at a separate database (e.g. emr_test),
// so test runs don't fill your dev database. Loaded first, so it wins.
config({ path: ".env.test.local", quiet: true });
config({ path: ".env.local", quiet: true });
config({ quiet: true });

// Photos written by tests go to a throwaway directory.
process.env.PHOTOS_DIR = mkdtempSync(path.join(tmpdir(), "emr-photos-"));
process.env.BACKUP_DIR = mkdtempSync(path.join(tmpdir(), "emr-backups-"));
