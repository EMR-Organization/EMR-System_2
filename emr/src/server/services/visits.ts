import "server-only";
import { z } from "zod";
import { diagnosisSchema, visitSchema } from "@/lib/shared/schemas/doctor";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { ConflictError } from "@/server/errors";
import { patientForAccess } from "@/server/patient-access";
import { ensureTripVisit } from "@/server/trip-visit";
import { parse } from "@/server/validation";

// The doctor's notes (spec: services/visits). The diagnosis lives on the
// patient's trip visit, as sync_diagnosis_to_trip_visit did in the old app,
// and records which specialty saw the patient (that drives "seen" counts).

const visitSelect = {
  id: true,
  tripVisit: true,
  visitType: true,
  date: true,
  chiefComplaint: true,
  symptoms: true,
  diagnosis: true,
  treatment: true,
  specialty: true,
  followUpDate: true,
  notes: true,
  version: true,
  updatedAt: true,
} as const;

/** The trip visit, for the Diagnosis tab. Students can't read visit history. */
export async function getTripVisit(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "visit.read");
  return db.visit.findFirst({ where: { patientId: id, tripVisit: true }, select: visitSelect });
}

/**
 * Saves the diagnosis on the trip visit. The caller sends the version they
 * opened; a save based on an older version is refused (two doctors can't
 * silently overwrite each other).
 */
export async function recordDiagnosis(input: unknown): Promise<{ version: number }> {
  const actor = await requireUser();
  const { patientId, version, ...fields } = parse(diagnosisSchema, input);

  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "diagnosis.write", tx);
    const visit = await ensureTripVisit(tx, patientId, actor);
    const { count } = await tx.visit.updateMany({
      where: { id: visit.id, version },
      data: {
        chiefComplaint: fields.chiefComplaint ?? null,
        diagnosis: fields.diagnosis,
        treatment: fields.treatment ?? null,
        // Who saw the patient: the doctor's specialty (an admin keeps whatever was there).
        specialty: actor.specialty ?? visit.specialty,
        version: { increment: 1 },
        updatedById: actor.id,
      },
    });
    if (count === 0) throw new ConflictError("version mismatch", "patientConflict");
    await audit(tx, actor, { action: "diagnosis.save", entity: "Visit", entityId: visit.id, tripId, details: { patientId } });
    return { version: version + 1 };
  });
}

/** Adds a separate visit (follow-up, procedure...) to the patient's history. */
export async function addVisit(input: unknown): Promise<{ id: string }> {
  const actor = await requireUser();
  const { patientId, ...fields } = parse(visitSchema, input);
  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "visit.write", tx);
    const row = await tx.visit.create({
      data: { ...fields, patientId, specialty: actor.specialty, originNodeId: env().NODE_ID, createdById: actor.id },
      select: { id: true },
    });
    await audit(tx, actor, { action: "visit.create", entity: "Visit", entityId: row.id, tripId, details: { patientId } });
    return row;
  });
}

/** Full visit history, trip visit first. Doctors and admins only. */
export async function listVisits(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "visit.read");
  return db.visit.findMany({
    where: { patientId: id },
    orderBy: [{ tripVisit: { sort: "asc", nulls: "last" } }, { date: "desc" }, { createdAt: "desc" }],
    select: { ...visitSelect, medications: { select: { id: true, name: true, dosage: true, frequency: true, status: true } } },
  });
}
