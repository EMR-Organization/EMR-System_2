import "server-only";
import { z } from "zod";
import { diabeticSchema } from "@/lib/shared/schemas/patients";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { patientForAccess } from "@/server/patient-access";
import { parse } from "@/server/validation";

/** Diabetes monitoring: glucose, insulin, BP and lipids (app.py:1099-1133). */
export async function addDiabeticEntry(input: unknown): Promise<{ id: string }> {
  const actor = await requireUser();
  const { patientId, takenAt, ...fields } = parse(diabeticSchema, input);
  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "diabetic.write", tx);
    const row = await tx.diabeticEntry.create({
      data: { ...fields, patientId, takenAt: takenAt ?? new Date(), originNodeId: env().NODE_ID, createdById: actor.id },
      select: { id: true },
    });
    await audit(tx, actor, { action: "diabetic.create", entity: "DiabeticEntry", entityId: row.id, tripId, details: { patientId } });
    return row;
  });
}

export async function listDiabeticEntries(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "patient.read");
  return db.diabeticEntry.findMany({
    where: { patientId: id },
    orderBy: { takenAt: "desc" },
    select: {
      id: true,
      takenAt: true,
      bloodGlucose: true,
      glucoseTiming: true,
      insulinType: true,
      insulinDose: true,
      bpSystolic: true,
      bpDiastolic: true,
      totalCholesterol: true,
      ldl: true,
      hdl: true,
      triglycerides: true,
      hba1c: true,
      notes: true,
    },
  });
}
