// Imports the old Streamlit app's data folder (Electric-Medical-Record-System-Offline/emr_data).
// Safe to run more than once: records already imported are skipped, and nothing
// already in the database is changed. Trips that don't exist yet are created as
// past trips (an admin can mark one current afterwards).
//
//   npm run import-legacy -- <path/to/emr_data> [--root-trip 12_2025] [--dry-run]
//
// --root-trip  where the old root patients.json (PT1001..., from before trips) goes
// --dry-run    show what would be imported without writing anything
import { db } from "@/server/db";
import { importLegacyTrip, readLegacyFolder } from "@/server/legacy-import";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dryRun = args.includes("--dry-run");
  const rootTrip = flag("--root-trip");
  const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root-trip");
  if (!dir) throw new Error("Usage: npm run import-legacy -- <path/to/emr_data> [--root-trip MM_YYYY] [--dry-run]");

  const { trips, warnings } = await readLegacyFolder(dir, rootTrip);
  for (const w of warnings) console.warn(`! ${w}`);
  for (const trip of trips) {
    const { summary, photosAdded, photosAlreadyHere } = await importLegacyTrip(trip, { dryRun });
    const records = Object.values(summary.recordsAdded).reduce((a, b) => a + b, 0);
    console.log(
      `${dryRun ? "[dry run] " : ""}${trip.code}: ${summary.patientsAdded} patients added (${summary.patientsAlreadyHere} already here), ` +
        `${records} records added, ${photosAdded} photos added${photosAlreadyHere ? ` (${photosAlreadyHere} already here)` : ""}`,
    );
    for (const r of summary.renumbered) console.log(`  renumbered ${r.from} -> ${r.to}`);
    for (const s of summary.skipped) console.warn(`  ! ${s}`);
  }
  if (trips.length === 0) console.log("No trips found in that folder.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
