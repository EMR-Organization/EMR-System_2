// On a FALLBACK laptop: loads the hub's provisioning file so the same logins
// and trips work here. Safe to run again with a newer file. Give each fallback
// its own NODE_ID and its own --first-number (5001, 6001, ...) so its patient
// numbers can't be confused with the hub's or another fallback's on paper.
//
//   npm run load-provision -- provision.hfprov [--first-number 5001]
import { readFile } from "node:fs/promises";
import { db } from "@/server/db";
import { SealedFileError } from "@/server/sealed";
import { loadProvisionFile } from "@/server/sync/provision";

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--first-number");
  const firstNumber = i >= 0 ? Number(args[i + 1]) : undefined;
  const file = args.find((a, j) => !a.startsWith("--") && args[j - 1] !== "--first-number");
  if (!file) throw new Error("Usage: npm run load-provision -- <provision.hfprov> [--first-number 5001]");
  try {
    const result = await loadProvisionFile(await readFile(file), { firstNumber });
    console.log(`Loaded ${result.users} accounts, ${result.trips} trips, ${result.members} memberships.`);
    for (const s of result.skipped) console.warn(`! ${s}`);
  } catch (err) {
    if (err instanceof SealedFileError) {
      throw new Error(
        {
          notOurs: "That isn't a provisioning file.",
          wrongKind: "That's a sync bundle, not a provisioning file.",
          wrongKey: "This laptop's SYNC_KEY doesn't match the hub's.",
          damaged: "The file is damaged or was changed.",
        }[err.reason],
      );
    }
    throw err;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
