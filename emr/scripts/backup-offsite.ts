// Uploads backups that aren't offsite yet (still encrypted) to the S3-compatible
// bucket in OFFSITE_*. The field setup runs it after every nightly backup;
// without internet it just stops, and the next run carries on.
//
//   npm run backup:offsite [-- --if-configured]
//
// --if-configured: do nothing (and succeed) when offsite backups aren't set up.
import { db } from "@/server/db";
import { offsiteTarget, uploadBackupsOffsite } from "@/server/offsite";

async function main() {
  const target = offsiteTarget();
  if (!target) {
    if (process.argv.includes("--if-configured")) return;
    throw new Error("Offsite backups aren't set up: set OFFSITE_BUCKET, OFFSITE_ACCESS_KEY_ID and OFFSITE_SECRET_ACCESS_KEY (see docs/offsite-backups.md).");
  }
  const results = await uploadBackupsOffsite(null);
  if (results.length === 0) console.log(`Offsite (${target.label}): every backup is already there.`);
  for (const r of results) {
    const line = {
      uploaded: "uploaded",
      alreadyThere: "was already there",
      damaged: `NOT uploaded: ${r.error}`,
      failed: `FAILED: ${r.error}`,
      notTried: "not tried (will retry next time)",
    }[r.status];
    console.log(`Offsite (${target.label}): ${r.name} ${line}`);
  }
  if (results.some((r) => r.status === "failed" || r.status === "damaged")) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
