// Restores an encrypted backup. Safe by default: it restores into a NEW
// database next to the live one and checks it (the audit chain verifies and
// still has the backup's checkpoint; the patient count matches). Nothing live
// is touched unless you add --swap, which renames the live database and photos
// folder aside (kept, never deleted) and puts the restored copy in their place.
//
//   npm run restore -- data/backups/emr-20261014-020000-ab12cd.hfbak
//   npm run restore -- <file> --swap        (stop the app first)
//
// Needs BACKUP_KEY and AUDIT_KEY from the install that made the backup, and
// DATABASE_OWNER_URL (an owner role allowed to create databases).
import { db } from "@/server/db";
import { restoreBackup } from "@/server/restore";

async function main() {
  const args = process.argv.slice(2);
  const swap = args.includes("--swap");
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length !== 1) throw new Error("Usage: npm run restore -- <backup.hfbak> [--swap]");
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is not set (restoring needs the owner role, not the app role)");

  console.log(`Restoring ${files[0]}${swap ? " and swapping it in" : " into a new database"}...`);
  const result = await restoreBackup({ file: files[0], ownerUrl, swap });
  console.log(`Backup from ${result.manifest.createdAt} (node ${result.manifest.nodeId}): OK`);
  console.log(`  ${result.patients} patients, ${result.photos} photos; audit log verified (${result.chain.checked} entries)`);
  if (result.swapped) {
    console.log(`Swapped in. The previous database is kept as "${result.swapped.previousDatabase}".`);
    if (result.swapped.previousPhotosDir) console.log(`The previous photos are kept in ${result.swapped.previousPhotosDir}`);
    console.log("Start the app again.");
  } else {
    console.log(`Restored into database "${result.database}". Nothing live was changed.`);
    console.log("To use it, stop the app and run this again with --swap.");
    console.log(`(Or drop the copy: DROP DATABASE "${result.database}";)`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
