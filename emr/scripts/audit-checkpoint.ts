// Verifies the audit log and prints a checkpoint to keep OUTSIDE the database
// (write it down, put it on a USB stick; backups store one automatically from
// Phase 6). Pass an earlier checkpoint to check the log wasn't rewritten since:
//
//   npm run audit:checkpoint
//   npm run audit:checkpoint -- <id> <hash>
import { latestCheckpoint, verifyChain } from "@/server/audit";
import { db } from "@/server/db";

async function main() {
  const [id, hash] = process.argv.slice(2);
  const checkpoint = id && hash ? { id, hash } : undefined;
  if (checkpoint && (!/^\d+$/.test(id) || !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error("Usage: npm run audit:checkpoint -- <id> <64-hex hash>");
  }

  const result = await verifyChain({ checkpoint });
  if (!result.ok) {
    console.error(`AUDIT LOG FAILED VERIFICATION at entry ${result.brokenAtId} (${result.reason}).`);
    process.exitCode = 2;
    return;
  }
  console.log(`Audit log OK: ${result.checked} entries verified${checkpoint ? ", matches the given checkpoint" : ""}.`);

  const latest = await latestCheckpoint();
  if (latest) {
    console.log("\nCheckpoint (keep this outside the database):");
    console.log(`  entry ${latest.id}  ${latest.hash}`);
    console.log(`  ${latest.count} entries, last at ${latest.at}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
