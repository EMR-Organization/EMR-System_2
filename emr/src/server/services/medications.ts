import "server-only";
import { z } from "zod";
import { discontinueSchema, prescribeSchema } from "@/lib/shared/schemas/doctor";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { ConflictError, NotFoundError } from "@/server/errors";
import { patientForAccess } from "@/server/patient-access";
import { ensureTripVisit } from "@/server/trip-visit";
import { parse } from "@/server/validation";

// Prescriptions (spec: services/medications). Each one is linked to the
// patient's trip visit, and prescribing marks the visit with the doctor's
// specialty (sync_medication_to_trip_visit / sync_doctor_type_to_trip_visit).
// Medications are never deleted: a mistake is discontinued with a reason.

export async function prescribe(input: unknown): Promise<{ id: string }> {
  const actor = await requireUser();
  const { patientId, ...fields } = parse(prescribeSchema, input);
  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "medication.write", tx);
    const visit = await ensureTripVisit(tx, patientId, actor);
    if (!visit.specialty && actor.specialty) {
      await tx.visit.update({ where: { id: visit.id }, data: { specialty: actor.specialty } });
    }
    const row = await tx.medication.create({
      data: { ...fields, patientId, visitId: visit.id, originNodeId: env().NODE_ID, createdById: actor.id },
      select: { id: true },
    });
    await audit(tx, actor, { action: "medication.prescribe", entity: "Medication", entityId: row.id, tripId, details: { patientId } });
    return row;
  });
}

export async function discontinue(input: unknown): Promise<void> {
  const actor = await requireUser();
  const { medicationId, version, reason, endDate } = parse(discontinueSchema, input);
  await db.$transaction(async (tx) => {
    const med = await tx.medication.findUnique({ where: { id: medicationId }, select: { patientId: true, status: true } });
    if (!med) throw new NotFoundError();
    const { tripId } = await patientForAccess(actor, med.patientId, "medication.write", tx);
    const { count } = await tx.medication.updateMany({
      where: { id: medicationId, version, status: "ACTIVE" },
      data: { status: "DISCONTINUED", discontinueReason: reason, endDate, version: { increment: 1 }, updatedById: actor.id },
    });
    if (count === 0) throw new ConflictError("not active or changed", "medicationConflict");
    await audit(tx, actor, {
      action: "medication.discontinue",
      entity: "Medication",
      entityId: medicationId,
      tripId,
      details: { patientId: med.patientId },
    });
  });
}

/** Active first, then discontinued. Anyone who can read the patient sees their medications. */
export async function listMedications(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "patient.read");
  return db.medication.findMany({
    where: { patientId: id },
    orderBy: [{ status: "asc" }, { startDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      dosage: true,
      frequency: true,
      route: true,
      startDate: true,
      endDate: true,
      prescribedFor: true,
      instructions: true,
      notes: true,
      status: true,
      discontinueReason: true,
      version: true,
      createdAt: true,
    },
  });
}
