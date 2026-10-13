"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { patientInputFrom } from "@/lib/shared/patient-form";
import { toActionResult, type ActionResult } from "@/server/errors";
import { addCondition } from "@/server/services/conditions";
import { addDiabeticEntry } from "@/server/services/diabetic";
import { softDeletePatient, updatePatient } from "@/server/services/patients";
import { addVitals } from "@/server/services/vitals";

const fields = (form: FormData, names: string[]) => Object.fromEntries(names.map((n) => [n, form.get(n) ?? undefined]));

export async function updatePatientAction(patientId: string, version: number, _prev: unknown, form: FormData): Promise<ActionResult<{ version: number }>> {
  const result = await toActionResult(() => updatePatient({ patientId, version, ...patientInputFrom(form) }));
  if (result.ok) revalidatePath(`/patients/${patientId}`);
  return result;
}

export async function deletePatientAction(patientId: string, tripId: string, _prev: unknown, form: FormData): Promise<ActionResult<never>> {
  const result = await toActionResult(() => softDeletePatient({ patientId, confirmLabel: form.get("confirmLabel") }));
  if (!result.ok) return result;
  redirect(`/trips/${tripId}/patients`);
}

export async function addVitalsAction(patientId: string, _prev: unknown, form: FormData): Promise<ActionResult<{ id: string; bmi: number | null }>> {
  const result = await toActionResult(() =>
    addVitals({
      patientId,
      ...fields(form, ["bpSystolic", "bpDiastolic", "heartRate", "temperatureC", "weight", "weightUnit", "heightCm", "respiratoryRate", "oxygenSaturation", "notes"]),
    }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}/vitals`);
  return result;
}

export async function addDiabeticAction(patientId: string, _prev: unknown, form: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await toActionResult(() =>
    addDiabeticEntry({
      patientId,
      ...fields(form, [
        "bloodGlucose",
        "glucoseTiming",
        "insulinType",
        "insulinDose",
        "bpSystolic",
        "bpDiastolic",
        "totalCholesterol",
        "ldl",
        "hdl",
        "triglycerides",
        "hba1c",
        "notes",
      ]),
    }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}/diabetic`);
  return result;
}

export async function addConditionAction(patientId: string, _prev: unknown, form: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await toActionResult(() =>
    addCondition({ patientId, ...fields(form, ["condition", "otherName", "diagnosisDate", "severity", "notes"]) }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}/conditions`);
  return result;
}
