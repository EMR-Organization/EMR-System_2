// On a FALLBACK laptop, once the hub is back: writes everything recorded here
// (patients, records, photos, audit entries) to an encrypted bundle for the
// hub's Admin → Sync page. With --since, only what changed since then (plus
// each record's patient); exporting overlapping periods is harmless.
//
//   npm run export-bundle -- [--since 2026-05-07T08:00] [--out <file>]
import { writeFile } from "node:fs/promises";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { buildBundleFile } from "@/server/sync/export";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const sinceArg = flag("--since");
  const since = sinceArg ? new Date(sinceArg) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error("--since must be a date and time, e.g. 2026-05-07T08:00");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = flag("--out") ?? `sync-${env().NODE_ID}-${stamp}.hfsync`;

  const { file, bundle, missingPhotos } = await buildBundleFile({ since });
  await writeFile(out, file, { flag: "wx" });
  const r = bundle.records;
  console.log(`Wrote ${out} from ${bundle.sourceNodeId}${since ? ` (changes since ${since.toISOString()})` : ""}:`);
  console.log(`  ${r.patients.length} patients, ${r.vitals.length + r.diabetic.length + r.conditions.length + r.visits.length + r.medications.length} records, ${r.photos.length} photos, ${bundle.audit.length} audit entries`);
  if (missingPhotos.length) console.warn(`! ${missingPhotos.length} photo file(s) were missing from disk and are not in the bundle`);
  console.log("Take it to the hub on a USB stick and import it in Admin → Sync.");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
