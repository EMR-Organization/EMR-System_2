"use server";

import { redirect } from "next/navigation";
import { PREEXISTING_CONDITIONS } from "@/lib/shared/constants";
import { patientInputFrom } from "@/lib/shared/patient-form";
import { toActionResult, type ActionResult } from "@/server/errors";
import { registerPatient } from "@/server/services/patients";

export async function registerPatientAction(tripId: string, _prev: unknown, form: FormData): Promise<ActionResult<never>> {
  // Ticked conditions, each with its own severity select ("severity:<condition>").
  const conditions = form
    .getAll("conditions")
    .filter((c): c is string => typeof c === "string" && (PREEXISTING_CONDITIONS as readonly string[]).includes(c))
    .map((condition) => ({
      condition,
      severity: form.get(`severity:${condition}`) ?? undefined,
      otherName: condition === "Other" ? (form.get("otherCondition") ?? undefined) : undefined,
    }));

  const result = await toActionResult(() => registerPatient({ tripId, ...patientInputFrom(form), conditions }));
  if (!result.ok) return result;
  redirect(`/patients/${result.data.id}?registered=${encodeURIComponent(result.data.label)}`);
}
