import "server-only";
import { z } from "zod";
import { bmi, lbsToKg } from "@/lib/shared/clinical";
import { vitalsSchema } from "@/lib/shared/schemas/patients";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { patientForAccess } from "@/server/patient-access";
import { parse } from "@/server/validation";

/** Records a set of vital signs. Weight may be entered in lb; it's stored in kg, and BMI is computed here. */
export async function addVitals(input: unknown): Promise<{ id: string; bmi: number | null }> {
  const actor = await requireUser();
  const { patientId, weight, weightUnit, takenAt, ...fields } = parse(vitalsSchema, input);
  const weightKg = weight === undefined ? undefined : weightUnit === "LB" ? lbsToKg(weight) : weight;
  const computedBmi = bmi(weightKg, fields.heightCm);

  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "vitals.write", tx);
    const row = await tx.vitals.create({
      data: {
        ...fields,
        patientId,
        weightKg,
        bmi: computedBmi,
        takenAt: takenAt ?? new Date(),
        originNodeId: env().NODE_ID,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await audit(tx, actor, { action: "vitals.create", entity: "Vitals", entityId: row.id, tripId, details: { patientId } });
    return { id: row.id, bmi: computedBmi };
  });
}

export async function listVitals(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "patient.read");
  return db.vitals.findMany({
    where: { patientId: id },
    orderBy: { takenAt: "desc" },
    select: {
      id: true,
      takenAt: true,
      bpSystolic: true,
      bpDiastolic: true,
      heartRate: true,
      temperatureC: true,
      weightKg: true,
      heightCm: true,
      bmi: true,
      respiratoryRate: true,
      oxygenSaturation: true,
      notes: true,
    },
  });
}
