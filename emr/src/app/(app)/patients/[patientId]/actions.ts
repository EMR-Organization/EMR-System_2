"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { patientInputFrom } from "@/lib/shared/patient-form";
import { toActionResult, type ActionResult } from "@/server/errors";
import { addCondition } from "@/server/services/conditions";
import { addDiabeticEntry } from "@/server/services/diabetic";
import { softDeletePatient, updatePatient } from "@/server/services/patients";
import { discontinue, prescribe } from "@/server/services/medications";
import { addVitals } from "@/server/services/vitals";
import { addVisit, recordDiagnosis } from "@/server/services/visits";

const fields = (form: FormData, names: string[]) => Object.fromEntries(names.map((n) => [n, form.get(n) ?? undefined]));

export async function updatePatientAction(patientId: string, version: number, _prev: unknown, form: FormData): Promise<ActionResult<{ version: number }>> {
  const result = await toActionResult(() => updatePatient({ patientId, version, ...patientInputFrom(form) }));
  if (result.ok) revalidatePath(`/patients/${patientId}`);
  return result;
}

export async function deletePatientAction(patientId: string, _prev: unknown, form: FormData): Promise<ActionResult<never>> {
  const result = await toActionResult(() => softDeletePatient({ patientId, confirmLabel: form.get("confirmLabel") }));
  if (!result.ok) return result;
  redirect(`/trips/${result.data.tripId}/patients`);
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

export async function recordDiagnosisAction(patientId: string, version: number, _prev: unknown, form: FormData): Promise<ActionResult<{ version: number }>> {
  const result = await toActionResult(() => recordDiagnosis({ patientId, version, ...fields(form, ["chiefComplaint", "diagnosis", "treatment"]) }));
  if (result.ok) revalidatePath(`/patients/${patientId}/diagnosis`);
  return result;
}

export async function addVisitAction(patientId: string, _prev: unknown, form: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await toActionResult(() =>
    addVisit({ patientId, ...fields(form, ["visitType", "date", "chiefComplaint", "symptoms", "diagnosis", "treatment", "followUpDate", "notes"]) }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}/visits`);
  return result;
}

export async function prescribeAction(patientId: string, _prev: unknown, form: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await toActionResult(() =>
    prescribe({
      patientId,
      ...fields(form, ["name", "otherName", "dosage", "frequency", "route", "startDate", "prescribedFor", "instructions", "notes"]),
    }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}/medications`);
  return result;
}

export async function discontinueAction(patientId: string, medicationId: string, version: number, _prev: unknown, form: FormData): Promise<ActionResult> {
  const result = await toActionResult(() => discontinue({ medicationId, version, reason: form.get("reason"), endDate: form.get("endDate") ?? undefined }));
  if (result.ok) revalidatePath(`/patients/${patientId}/medications`);
  return result;
}
