import "server-only";
import { z } from "zod";
import { addConditionSchema } from "@/lib/shared/schemas/patients";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { patientForAccess } from "@/server/patient-access";
import { parse } from "@/server/validation";

/** Pre-existing conditions (app.py:1153). */
export async function addCondition(input: unknown): Promise<{ id: string }> {
  const actor = await requireUser();
  const { patientId, ...fields } = parse(addConditionSchema, input);
  return db.$transaction(async (tx) => {
    const { tripId } = await patientForAccess(actor, patientId, "condition.write", tx);
    const row = await tx.condition.create({
      data: { ...fields, patientId, originNodeId: env().NODE_ID, createdById: actor.id },
      select: { id: true },
    });
    await audit(tx, actor, { action: "condition.create", entity: "Condition", entityId: row.id, tripId, details: { patientId } });
    return row;
  });
}

export async function listConditions(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "patient.read");
  return db.condition.findMany({
    where: { patientId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, condition: true, diagnosisDate: true, severity: true, notes: true, createdAt: true },
  });
}
