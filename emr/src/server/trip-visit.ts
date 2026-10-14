import "server-only";
import { TRIP_VISIT_TYPE } from "@/lib/shared/constants";
import type { Actor } from "@/server/auth/session";
import type { Tx } from "@/server/db";
import { env } from "@/server/env";

/**
 * The patient's one trip visit (created at registration, as in the old app).
 * Records imported from older data may lack one, so it's created on demand.
 * Prisma's upsert reads then inserts, so two doctors saving at once both tried
 * to insert and one failed on the unique key. createMany + skipDuplicates is
 * INSERT ... ON CONFLICT DO NOTHING: the second insert waits for the first and
 * is skipped, and both then read the same row.
 */
export async function ensureTripVisit(tx: Tx, patientId: string, actor: Actor) {
  await tx.visit.createMany({
    data: [
      {
        patientId,
        tripVisit: true,
        visitType: TRIP_VISIT_TYPE,
        date: new Date(),
        originNodeId: env().NODE_ID,
        createdById: actor.id,
      },
    ],
    skipDuplicates: true,
  });
  return tx.visit.findUniqueOrThrow({
    where: { patientId_tripVisit: { patientId, tripVisit: true } },
    select: { id: true, version: true, specialty: true },
  });
}
