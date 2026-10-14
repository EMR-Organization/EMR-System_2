// On the HUB, before the trip: writes the provisioning file for fallback laptops
// (accounts with password hashes, trips, who's switched on where), encrypted
// with SYNC_KEY. Copy it to each fallback and run load-provision there.
// Admin accounts are never included (see src/server/sync/provision.ts).
// Re-run it after approving new accounts so fallbacks get them too.
//
//   npm run provision-node -- [--out provision.hfprov]
import { writeFile } from "node:fs/promises";
import { db } from "@/server/db";
import { buildProvisionFile } from "@/server/sync/provision";

async function main() {
  const args = process.argv.slice(2);
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "provision.hfprov";
  const { file, counts } = await buildProvisionFile();
  await writeFile(out, file, { flag: "wx" });
  console.log(`Wrote ${out}: ${counts.users} accounts, ${counts.trips} trips, ${counts.members} trip memberships.`);
  if (counts.users === 0) {
    console.warn("! No doctor or student accounts yet (admin accounts are never copied to fallbacks), so nobody could sign in on a fallback. Approve accounts first, then run this again.");
  }
  console.log("It holds password hashes: copy it only to the fallback laptops, then delete it.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
