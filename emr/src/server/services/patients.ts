import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { TRIP_VISIT_TYPE } from "@/lib/shared/constants";
import { formatPatientLabel, parsePatientLabel } from "@/lib/shared/patient-label";
import { listPatientsSchema, registerPatientSchema, updatePatientSchema } from "@/lib/shared/schemas/patients";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { patientForAccess } from "@/server/patient-access";
import { allocatePatientNumber } from "@/server/patient-number";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Patients (spec: services/patients). Registration, the record, list/search,
// edits with optimistic locking, and admin-only soft delete. Audit details
// carry IDs and field names, never the values.

export const PAGE_SIZE = 50;

const recordSelect = {
  id: true,
  tripId: true,
  displayNumber: true,
  originLabel: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  ageValue: true,
  ageUnit: true,
  gender: true,
  phone: true,
  address: true,
  emergencyContact: true,
  waterSource: true,
  waterRiskRating: true,
  waterHistory: true,
  waterNotes: true,
  assignedSpecialty: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  trip: { select: { code: true, name: true, active: true } },
} as const satisfies Prisma.PatientSelect;

export type PatientRecord = Omit<Prisma.PatientGetPayload<{ select: typeof recordSelect }>, "trip"> & {
  label: string;
  tripCode: string;
  tripName: string;
  /** False for a past trip, whose records only admins may change. */
  tripActive: boolean;
};

function toRecord({ trip, ...p }: Prisma.PatientGetPayload<{ select: typeof recordSelect }>): PatientRecord {
  return { ...p, label: formatPatientLabel(p.displayNumber, trip.code), tripCode: trip.code, tripName: trip.name, tripActive: trip.active };
}

/**
 * Registers a patient on a trip: the next number for that trip, any known
 * conditions, and the patient's trip visit (as the old app did), all in one
 * transaction with the audit entry.
 */
export async function registerPatient(input: unknown): Promise<{ id: string; label: string }> {
  const actor = await requireUser();
  const data = parse(registerPatientSchema, input);
  await assertCan(actor, "patient.register", { tripId: data.tripId });
  const { tripId, conditions, ...fields } = data;
  const origin = { originNodeId: env().NODE_ID, createdById: actor.id };

  return db.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { code: true } });
    if (!trip) throw new NotFoundError();
    const displayNumber = await allocatePatientNumber(tx, tripId);

    const patient = await tx.patient.create({
      data: {
        ...fields,
        // Keep the age estimate only when there's no date of birth.
        ageValue: fields.dateOfBirth ? null : fields.ageValue,
        ageUnit: fields.dateOfBirth ? null : fields.ageUnit,
        tripId,
        displayNumber,
        ...origin,
        conditions: { create: conditions.map((c) => ({ ...c, ...origin })) },
        visits: { create: { tripVisit: true, visitType: TRIP_VISIT_TYPE, date: new Date(), ...origin } },
      },
      select: { id: true },
    });
    await audit(tx, actor, {
      action: "patient.create",
      entity: "Patient",
      entityId: patient.id,
      tripId,
      details: { displayNumber, conditions: conditions.length },
    });
    return { id: patient.id, label: formatPatientLabel(displayNumber, trip.code) };
  });
}

/**
 * The patient's record. Every view is audited (who looked at whom, when).
 * Pages showing any part of a record (vitals, conditions...) call this first,
 * so each opened record leaves an audit entry; the list* functions in the
 * other services don't audit on their own.
 */
export async function getPatient(patientId: unknown): Promise<PatientRecord> {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, id, "patient.read", tx);
    const patient = await tx.patient.findUniqueOrThrow({ where: { id }, select: recordSelect });
    await audit(tx, actor, { action: "patient.view", entity: "Patient", entityId: id, tripId });
    return toRecord(patient);
  });
}

export type PatientListItem = Pick<
  PatientRecord,
  "id" | "label" | "firstName" | "lastName" | "gender" | "dateOfBirth" | "ageValue" | "ageUnit" | "assignedSpecialty" | "waterRiskRating" | "createdAt"
>;

/** One trip's patients, newest first, with search by name or patient number. */
export async function listPatients(input: unknown): Promise<{ patients: PatientListItem[]; total: number; page: number; pageSize: number }> {
  const actor = await requireUser();
  const { tripId, q, risk, specialty, page } = parse(listPatientsSchema, input);
  await assertCan(actor, "patient.read", { tripId });

  const where: Prisma.PatientWhereInput = {
    tripId,
    deletedAt: null,
    ...(risk ? { waterRiskRating: risk } : {}),
    ...(specialty ? { assignedSpecialty: specialty } : {}),
    ...(q ? { OR: searchTerms(q) } : {}),
  };
  const [rows, total] = await Promise.all([
    db.patient.findMany({
      where,
      orderBy: { displayNumber: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        displayNumber: true,
        firstName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
        ageValue: true,
        ageUnit: true,
        assignedSpecialty: true,
        waterRiskRating: true,
        createdAt: true,
        trip: { select: { code: true } },
      },
    }),
    db.patient.count({ where }),
  ]);
  return {
    patients: rows.map(({ trip, displayNumber, ...p }) => ({ ...p, label: formatPatientLabel(displayNumber, trip.code) })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

// "maria", "lopez maria", "12", "012", "012_05_2026"
function searchTerms(q: string): Prisma.PatientWhereInput[] {
  const terms: Prisma.PatientWhereInput[] = [];
  const label = parsePatientLabel(q);
  const number = label?.displayNumber ?? (/^\d{1,6}$/.test(q) ? Number(q) : null);
  if (number) terms.push({ displayNumber: number });
  const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length > 0 && !label) {
    terms.push({
      AND: words.map((w) => ({
        OR: [{ firstName: { contains: w, mode: "insensitive" as const } }, { lastName: { contains: w, mode: "insensitive" as const } }],
      })),
    });
  }
  return terms.length > 0 ? terms : [{ id: { in: [] } }];
}

/**
 * Edits demographics. The caller sends the version they loaded; if someone
 * else saved in between, nothing is written and ConflictError is thrown, so a
 * later save can never silently overwrite an earlier one.
 */
export async function updatePatient(input: unknown): Promise<{ version: number }> {
  const actor = await requireUser();
  const { patientId, version, ...fields } = parse(updatePatientSchema, input);

  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "patient.register", tx);
    const before = await tx.patient.findUniqueOrThrow({ where: { id: patientId } });
    const data = {
      ...fields,
      ageValue: fields.dateOfBirth ? null : fields.ageValue,
      ageUnit: fields.dateOfBirth ? null : fields.ageUnit,
      phone: fields.phone ?? null,
      address: fields.address ?? null,
      emergencyContact: fields.emergencyContact ?? null,
      waterSource: fields.waterSource ?? null,
      waterRiskRating: fields.waterRiskRating ?? null,
      waterNotes: fields.waterNotes ?? null,
      dateOfBirth: fields.dateOfBirth ?? null,
    };
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
      (k) => JSON.stringify(data[k] ?? null) !== JSON.stringify(before[k] ?? null),
    );

    const { count } = await tx.patient.updateMany({
      where: { id: patientId, version, deletedAt: null },
      data: { ...data, version: { increment: 1 }, updatedById: actor.id },
    });
    if (count === 0) throw new ConflictError("version mismatch", "patientConflict");

    await audit(tx, actor, {
      action: "patient.update",
      entity: "Patient",
      entityId: patientId,
      tripId,
      details: { fields: changed, fromVersion: version },
    });
    return { version: version + 1 };
  });
}

/**
 * Hides a patient (admin only). Nothing is erased and the number is never
 * reused, unlike the old app, which renumbered everyone after a delete.
 */
export async function softDeletePatient(input: unknown): Promise<{ tripId: string }> {
  const actor = await requireUser();
  const { patientId, confirmLabel } = parse(z.object({ patientId: z.uuid(), confirmLabel: z.string().trim() }), input);

  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "patient.delete", tx);
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: patientId }, select: { displayNumber: true, trip: { select: { code: true } } } });
    // Typing the patient's number guards against deleting the wrong record.
    if (confirmLabel !== formatPatientLabel(patient.displayNumber, patient.trip.code)) {
      throw new ValidationError({ confirmLabel: ["confirmMismatch"] });
    }
    await tx.patient.update({ where: { id: patientId }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await audit(tx, actor, { action: "patient.delete", entity: "Patient", entityId: patientId, tripId });
    return { tripId };
  });
}
