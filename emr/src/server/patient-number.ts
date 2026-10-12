import "server-only";
import type { Tx } from "@/server/db";

/**
 * Hands out the next patient number for a trip.
 *
 * A single UPDATE ... RETURNING takes a row lock on the trip, so two people
 * registering patients at the same moment always get different numbers (the second
 * waits for the first transaction to finish). Call it inside the same transaction
 * that creates the patient, so a failed registration rolls the counter back too.
 */
export async function allocatePatientNumber(tx: Tx, tripId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ allocated: number }[]>`
    UPDATE "Trip"
    SET "nextPatientNumber" = "nextPatientNumber" + 1, "updatedAt" = now()
    WHERE "id" = ${tripId}::uuid
    RETURNING "nextPatientNumber" - 1 AS allocated
  `;
  if (rows.length === 0) throw new Error(`Trip ${tripId} not found`);
  return Number(rows[0].allocated);
}
