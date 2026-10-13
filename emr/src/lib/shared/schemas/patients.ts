import { z } from "zod";
import {
  GLUCOSE_TIMINGS,
  INSULIN_TYPES,
  PREEXISTING_CONDITIONS,
  WATER_CONTAMINATION_CONDITIONS,
  WATER_SOURCES,
} from "../constants";

// Input shapes for patient data. The server parses every input with these.
// Ranges follow the old app's form limits. Error messages are message keys.

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLongText" })
    .optional()
    .transform((v) => (v ? v : undefined));

/** A form number: "" means not entered. */
const num = (min: number, max: number, int = false) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    (int ? z.coerce.number().int({ error: "wholeNumber" }) : z.coerce.number({ error: "number" }))
      .min(min, { error: "outOfRange" })
      .max(max, { error: "outOfRange" })
      .optional(),
  );

/** A calendar date (YYYY-MM-DD) that isn't in the future. */
const pastDate = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.iso
    .date({ error: "date" })
    .refine((d) => d <= new Date().toISOString().slice(0, 10), { error: "futureDate" })
    .transform((d) => new Date(`${d}T00:00:00Z`))
    .optional(),
);

export const SPECIALTIES = ["DENTIST", "PHYSICIAN", "PEDIATRICIAN"] as const;

const demographics = {
  firstName: z.string().trim().min(1, { error: "required" }).max(80, { error: "tooLongText" }),
  lastName: z.string().trim().min(1, { error: "required" }).max(80, { error: "tooLongText" }),
  dateOfBirth: pastDate,
  ageValue: num(0, 130, true),
  ageUnit: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["YEARS", "MONTHS"]).optional()),
  gender: z.enum(["MALE", "FEMALE", "OTHER"], { error: "required" }),
  assignedSpecialty: z.enum(SPECIALTIES, { error: "required" }),
  phone: text(40),
  address: text(300),
  emergencyContact: text(150),
  waterSource: z.preprocess((v) => (v === "" ? undefined : v), z.enum(WATER_SOURCES).optional()),
  waterRiskRating: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["LOW", "MEDIUM", "HIGH"]).optional()),
  waterHistory: z.array(z.enum(WATER_CONTAMINATION_CONDITIONS)).max(WATER_CONTAMINATION_CONDITIONS.length).default([]),
  waterNotes: text(1000),
};

/** Date of birth, or an age estimate, is required (the database enforces it too). */
function checkAge<T extends { dateOfBirth?: Date; ageValue?: number; ageUnit?: "YEARS" | "MONTHS" }>(p: T, ctx: z.RefinementCtx) {
  if (!p.dateOfBirth && p.ageValue === undefined) ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "dobOrAge" });
  if (p.ageValue !== undefined && !p.ageUnit) ctx.addIssue({ code: "custom", path: ["ageUnit"], message: "required" });
  if (p.ageUnit === "MONTHS" && p.ageValue !== undefined && p.ageValue > 24) {
    ctx.addIssue({ code: "custom", path: ["ageValue"], message: "outOfRange" });
  }
}

export const conditionSchema = z
  .object({
    condition: z.enum(PREEXISTING_CONDITIONS.filter((c) => c !== "None") as [string, ...string[]], { error: "required" }),
    /** Required when condition is "Other". */
    otherName: text(100),
    diagnosisDate: pastDate,
    severity: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["MILD", "MODERATE", "SEVERE"]).optional()),
    notes: text(1000),
  })
  .superRefine((c, ctx) => {
    if (c.condition === "Other" && !c.otherName) ctx.addIssue({ code: "custom", path: ["otherName"], message: "required" });
  })
  .transform(({ condition, otherName, ...rest }) => ({ ...rest, condition: condition === "Other" ? otherName! : condition }));

export const registerPatientSchema = z
  .object({ tripId: z.uuid(), ...demographics, conditions: z.array(conditionSchema).max(30).default([]) })
  .superRefine(checkAge);

export const updatePatientSchema = z
  .object({ patientId: z.uuid(), version: z.coerce.number().int().min(1), ...demographics })
  .superRefine(checkAge);

export const listPatientsSchema = z.object({
  tripId: z.uuid(),
  q: z.string().trim().max(100).optional(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  specialty: z.enum(SPECIALTIES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** When the measurement was taken: defaults to now; can't be in the future (5 min of clock slack). */
const takenAt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce
    .date({ error: "date" })
    .refine((d) => d.getTime() <= Date.now() + 5 * 60 * 1000, { error: "futureDate" })
    .optional(),
);

export const vitalsSchema = z
  .object({
    patientId: z.uuid(),
    takenAt,
    bpSystolic: num(60, 250, true),
    bpDiastolic: num(40, 150, true),
    heartRate: num(30, 220, true),
    temperatureC: num(30, 43),
    weight: num(0.5, 660),
    weightUnit: z.enum(["KG", "LB"]).default("KG"),
    heightCm: num(30, 250),
    respiratoryRate: num(6, 60, true),
    oxygenSaturation: num(50, 100, true),
    notes: text(1000),
  })
  .superRefine((v, ctx) => {
    const measured = [v.bpSystolic, v.bpDiastolic, v.heartRate, v.temperatureC, v.weight, v.heightCm, v.respiratoryRate, v.oxygenSaturation];
    if (measured.every((m) => m === undefined)) ctx.addIssue({ code: "custom", path: ["form"], message: "noMeasurements" });
    if ((v.bpSystolic === undefined) !== (v.bpDiastolic === undefined)) {
      ctx.addIssue({ code: "custom", path: ["bpDiastolic"], message: "bpPair" });
    }
    if (v.bpSystolic !== undefined && v.bpDiastolic !== undefined && v.bpDiastolic >= v.bpSystolic) {
      ctx.addIssue({ code: "custom", path: ["bpDiastolic"], message: "bpOrder" });
    }
    // 660 is the pound limit; in kilograms that's 300.
    if (v.weight !== undefined && v.weightUnit === "KG" && v.weight > 300) {
      ctx.addIssue({ code: "custom", path: ["weight"], message: "outOfRange" });
    }
  });

export const diabeticSchema = z
  .object({
    patientId: z.uuid(),
    takenAt,
    bloodGlucose: num(20, 600, true),
    glucoseTiming: z.preprocess((v) => (v === "" ? undefined : v), z.enum(GLUCOSE_TIMINGS).optional()),
    insulinType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(INSULIN_TYPES).optional()),
    insulinDose: num(0, 100),
    bpSystolic: num(60, 250, true),
    bpDiastolic: num(40, 150, true),
    totalCholesterol: num(0, 500, true),
    ldl: num(0, 300, true),
    hdl: num(0, 150, true),
    triglycerides: num(0, 1000, true),
    hba1c: num(0, 20),
    notes: text(1000),
  })
  .superRefine((d, ctx) => {
    const measured = [d.bloodGlucose, d.insulinDose, d.bpSystolic, d.totalCholesterol, d.ldl, d.hdl, d.triglycerides, d.hba1c];
    if (measured.every((m) => m === undefined)) ctx.addIssue({ code: "custom", path: ["form"], message: "noMeasurements" });
    if ((d.bpSystolic === undefined) !== (d.bpDiastolic === undefined)) {
      ctx.addIssue({ code: "custom", path: ["bpDiastolic"], message: "bpPair" });
    }
    if (d.bpSystolic !== undefined && d.bpDiastolic !== undefined && d.bpDiastolic >= d.bpSystolic) {
      ctx.addIssue({ code: "custom", path: ["bpDiastolic"], message: "bpOrder" });
    }
  });

export const addConditionSchema = z.object({ patientId: z.uuid() }).and(conditionSchema);
