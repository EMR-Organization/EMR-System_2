import "server-only";
import { MATRIX, TRIP_WRITE_PERMISSIONS, type Permission } from "@/lib/shared/permissions";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";

export type { Permission };

/**
 * Throws ForbiddenError unless the actor may do this. Every service calls it
 * right after requireUser(), before touching any data.
 *
 * For trip-scoped work pass the trip the data belongs to (looked up from the
 * record, never taken from the request). Students must be switched on for that
 * trip, checked in the database on every call.
 *
 * Past trips are read-only: on an inactive trip, changing clinical records
 * (TRIP_WRITE_PERMISSIONS) is for admins only.
 */
export async function assertCan(actor: Actor, permission: Permission, scope: { tripId?: string } = {}): Promise<void> {
  const grant = MATRIX[permission]?.[actor.role] ?? "none";
  if (grant === "none") throw new ForbiddenError(`${actor.role} lacks ${permission}`);

  if (scope.tripId && actor.role !== "ADMIN" && TRIP_WRITE_PERMISSIONS.has(permission) && !(await isTripActive(scope.tripId))) {
    throw new ForbiddenError(`trip ${scope.tripId} is past`, "tripClosed");
  }
  if (grant === "all") return;

  // grant === "trip": the student needs an enabled membership for this trip.
  if (!scope.tripId) throw new ForbiddenError(`${permission} needs a trip for ${actor.role}`);
  if (!(await isEnabledForTrip(actor.id, scope.tripId))) {
    throw new ForbiddenError(`${actor.role} not enabled for trip ${scope.tripId}`);
  }
}

/** Non-throwing version, for deciding what to show. */
export async function can(actor: Actor, permission: Permission, scope: { tripId?: string } = {}): Promise<boolean> {
  try {
    await assertCan(actor, permission, scope);
    return true;
  } catch (err) {
    if (err instanceof ForbiddenError) return false;
    throw err;
  }
}

/**
 * Trips the actor can see: every trip for admins and doctors, enabled trips for
 * students. Use it to scope lists and searches.
 * Returns "all" rather than a list of every trip ID.
 */
export async function accessibleTripIds(actor: Actor): Promise<"all" | string[]> {
  if (actor.role === "ADMIN" || actor.role === "DOCTOR") return "all";
  const memberships = await db.tripMember.findMany({
    where: { userId: actor.id, enabled: true },
    select: { tripId: true },
  });
  return memberships.map((m) => m.tripId);
}

/** A trip that doesn't exist counts as active here; the service then reports it as not found. */
async function isTripActive(tripId: string): Promise<boolean> {
  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { active: true } });
  return trip?.active ?? true;
}

async function isEnabledForTrip(userId: string, tripId: string): Promise<boolean> {
  const membership = await db.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    select: { enabled: true },
  });
  return membership?.enabled === true;
}
