import "server-only";
import { z } from "zod";
import { tripCodeFor } from "@/lib/shared/patient-label";
import { createTripSchema } from "@/lib/shared/schemas/trips";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { accessibleTripIds, assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Trips and who can work on them (spec: services/trips).
// Admins and doctors see every trip; students only trips they're switched on for.

export type TripSummary = {
  id: string;
  code: string;
  name: string;
  location: string;
  month: number;
  year: number;
  active: boolean;
  patientCount: number;
};

const tripSelect = {
  id: true,
  code: true,
  name: true,
  location: true,
  month: true,
  year: true,
  active: true,
  _count: { select: { patients: { where: { deletedAt: null } } } },
} as const;

type TripRow = { _count: { patients: number } } & Omit<TripSummary, "patientCount">;
const toSummary = ({ _count, ...trip }: TripRow): TripSummary => ({ ...trip, patientCount: _count.patients });

/** Trips the signed-in user can see, newest first. */
export async function listTrips(): Promise<TripSummary[]> {
  const actor = await requireUser();
  const scope = await accessibleTripIds(actor);
  const rows = await db.trip.findMany({
    where: scope === "all" ? undefined : { id: { in: scope } },
    orderBy: [{ year: "desc" }, { month: "desc" }, { code: "desc" }],
    select: tripSelect,
  });
  return rows.map(toSummary);
}

/** One trip, if the user may read its patients. */
export async function getTrip(tripId: unknown): Promise<TripSummary> {
  const actor = await requireUser();
  const id = parse(z.uuid(), tripId);
  await assertCan(actor, "patient.read", { tripId: id });
  const row = await db.trip.findUnique({ where: { id }, select: tripSelect });
  if (!row) throw new NotFoundError();
  return toSummary(row);
}

export async function createTrip(input: unknown): Promise<TripSummary> {
  const actor = await requireUser();
  await assertCan(actor, "trip.create");
  const data = parse(createTripSchema, input);
  const code = data.suffix ? `${tripCodeFor(data.month, data.year)}_${data.suffix}` : tripCodeFor(data.month, data.year);

  return db.$transaction(async (tx) => {
    if (await tx.trip.findUnique({ where: { code }, select: { id: true } })) {
      // Two trips in one month need a suffix so patient labels stay unique.
      throw new ValidationError({ suffix: ["tripCodeTaken"] });
    }
    const trip = await tx.trip.create({
      data: { code, name: data.name, location: data.location, month: data.month, year: data.year, createdById: actor.id },
      select: tripSelect,
    });
    await audit(tx, actor, { action: "trip.create", entity: "Trip", entityId: trip.id, tripId: trip.id, details: { code } });
    return toSummary(trip);
  });
}

/** Marks a trip current or past. Past trips stay readable. */
export async function setTripActive(input: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "trip.create");
  const { tripId, active } = parse(z.object({ tripId: z.uuid(), active: z.boolean() }), input);
  await db.$transaction(async (tx) => {
    const { count } = await tx.trip.updateMany({ where: { id: tripId }, data: { active } });
    if (count === 0) throw new NotFoundError();
    await audit(tx, actor, { action: "trip.setActive", entity: "Trip", entityId: tripId, tripId, details: { active } });
  });
}

export type StudentMembership = {
  userId: string;
  name: string;
  email: string;
  enabled: boolean;
  enabledAt: Date | null;
  enabledByName: string | null;
};

/** Every active student, with whether they're switched on for this trip. */
export async function listMembers(tripId: unknown): Promise<StudentMembership[]> {
  const actor = await requireUser();
  const id = parse(z.uuid(), tripId);
  await assertCan(actor, "trip.members.toggle", { tripId: id });
  if (!(await db.trip.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError();

  const students = await db.user.findMany({
    where: { role: "STUDENT", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      memberships: {
        where: { tripId: id },
        select: { enabled: true, enabledAt: true, enabledBy: { select: { name: true } } },
      },
    },
  });
  return students.map((s) => {
    const m = s.memberships[0];
    return {
      userId: s.id,
      name: s.name,
      email: s.email,
      enabled: m?.enabled ?? false,
      enabledAt: m?.enabledAt ?? null,
      enabledByName: m?.enabledBy?.name ?? null,
    };
  });
}

/**
 * The student on/off switch for one trip. Takes effect on the student's very
 * next request (assertCan reads it from the database every time).
 */
export async function setStudentEnabled(input: unknown): Promise<void> {
  const actor = await requireUser();
  const { tripId, userId, enabled } = parse(z.object({ tripId: z.uuid(), userId: z.uuid(), enabled: z.boolean() }), input);
  await assertCan(actor, "trip.members.toggle", { tripId });

  await db.$transaction(async (tx) => {
    const [trip, student] = await Promise.all([
      tx.trip.findUnique({ where: { id: tripId }, select: { id: true } }),
      tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    ]);
    if (!trip || !student) throw new NotFoundError();
    // Only approved students have a switch; doctors and admins reach every trip anyway.
    if (student.role !== "STUDENT" || (enabled && student.status !== "ACTIVE")) throw new ConflictError("not an active student", "notActiveStudent");

    const stamp = enabled ? { enabledById: actor.id, enabledAt: new Date() } : {};
    await tx.tripMember.upsert({
      where: { tripId_userId: { tripId, userId } },
      create: { tripId, userId, enabled, ...stamp },
      update: { enabled, ...stamp },
    });
    await audit(tx, actor, { action: "member.toggle", entity: "TripMember", entityId: userId, tripId, details: { enabled } });
  });
}
