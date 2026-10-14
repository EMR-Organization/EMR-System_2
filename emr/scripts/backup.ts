// Writes an encrypted backup to BACKUP_DIR (database + photos) and removes ones
// older than 14 days. The field setup schedules this nightly at 02:00; admins
// can also press "Back up now" in Admin → Backups.
//
//   npm run backup
import { createBackup } from "@/server/backup";
import { db } from "@/server/db";
import { env } from "@/server/env";

async function main() {
  const backup = await createBackup(null);
  const mb = (backup.sizeBytes / 1024 / 1024).toFixed(1);
  console.log(`Backup written: ${env().BACKUP_DIR}/${backup.name}.hfbak (${mb} MB)`);
  console.log(`  ${backup.counts.patients} patients, ${backup.counts.photos} photos, ${backup.counts.auditEntries} audit entries`);
  if (backup.checkpoint) console.log(`  audit checkpoint: entry ${backup.checkpoint.id}  ${backup.checkpoint.hash}`);
  console.log("Copy the .hfbak and .json files to a USB stick at the end of each clinic day.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
