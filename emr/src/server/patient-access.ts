import "server-only";
import type { Permission } from "@/lib/shared/permissions";
import type { Actor } from "@/server/auth/session";
import { db, type Tx } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { assertCan } from "@/server/rbac";

/**
 * Finds a (not deleted) patient and checks the permission against the trip the
 * patient belongs to, looked up here, never taken from the request. A student
 * switched on for trip A therefore can't reach a patient in trip B by ID.
 */
export async function patientForAccess(
  actor: Actor,
  patientId: string,
  permission: Permission,
  client: Tx | typeof db = db,
): Promise<{ id: string; tripId: string }> {
  const patient = await client.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: { id: true, tripId: true },
  });
  if (!patient) throw new NotFoundError();
  await assertCan(actor, permission, { tripId: patient.tripId });
  return patient;
}
