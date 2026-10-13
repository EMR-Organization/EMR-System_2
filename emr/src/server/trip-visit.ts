import "server-only";
import { TRIP_VISIT_TYPE } from "@/lib/shared/constants";
import type { Actor } from "@/server/auth/session";
import type { Tx } from "@/server/db";
import { env } from "@/server/env";

/**
 * The patient's one trip visit (created at registration, as in the old app).
 * Records imported from older data may lack one, so it's created on demand;
 * the unique (patientId, tripVisit) key makes concurrent calls safe.
 */
export function ensureTripVisit(tx: Tx, patientId: string, actor: Actor) {
  return tx.visit.upsert({
    where: { patientId_tripVisit: { patientId, tripVisit: true } },
    create: {
      patientId,
      tripVisit: true,
      visitType: TRIP_VISIT_TYPE,
      date: new Date(),
      originNodeId: env().NODE_ID,
      createdById: actor.id,
    },
    update: {},
    select: { id: true, version: true, specialty: true },
  });
}
