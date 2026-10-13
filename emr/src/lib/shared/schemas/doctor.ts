import { z } from "zod";
import { COMMON_MEDICATIONS, MEDICATION_FREQUENCIES, MEDICATION_ROUTES, PHOTO_CATEGORIES, VISIT_TYPES } from "../constants";

// Inputs for the doctor's workflow and photos. Error messages are message keys.

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLongText" })
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(values).optional());

const isoDay = (v: Date) => v.toISOString().slice(0, 10);
const today = () => isoDay(new Date());
const day = (rule?: (d: string) => boolean, error = "date") =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.iso
      .date({ error: "date" })
      .refine((d) => !rule || rule(d), { error })
      .transform((d) => new Date(`${d}T00:00:00Z`))
      .optional(),
  );

/** The diagnosis on the patient's trip visit (render_diagnosis in the old app). */
export const diagnosisSchema = z.object({
  patientId: z.uuid(),
  /** The trip visit's version when the form was opened (optimistic locking). */
  version: z.coerce.number().int().min(1),
  chiefComplaint: text(500),
  diagnosis: z.string().trim().min(1, { error: "required" }).max(5000, { error: "tooLongText" }),
  treatment: text(5000),
});

export const visitSchema = z.object({
  patientId: z.uuid(),
  visitType: z.enum(VISIT_TYPES, { error: "required" }),
  date: day((d) => d <= today(), "futureDate").default(() => new Date(`${today()}T00:00:00Z`)),
  chiefComplaint: text(500),
  symptoms: text(5000),
  diagnosis: text(5000),
  treatment: text(5000),
  followUpDate: day((d) => d >= today(), "pastDate"),
  notes: text(5000),
});

export const prescribeSchema = z
  .object({
    patientId: z.uuid(),
    name: z.enum(COMMON_MEDICATIONS, { error: "required" }),
    /** Required when name is "Other". */
    otherName: text(120),
    dosage: z.string().trim().min(1, { error: "required" }).max(100, { error: "tooLongText" }),
    frequency: z.enum(MEDICATION_FREQUENCIES, { error: "required" }),
    route: optionalEnum(MEDICATION_ROUTES),
    startDate: day().default(() => new Date(`${today()}T00:00:00Z`)),
    prescribedFor: text(300),
    instructions: text(2000),
    notes: text(2000),
  })
  .superRefine((m, ctx) => {
    if (m.name === "Other" && !m.otherName) ctx.addIssue({ code: "custom", path: ["otherName"], message: "required" });
  })
  .transform(({ name, otherName, ...rest }) => ({ ...rest, name: name === "Other" ? otherName! : name }));

export const discontinueSchema = z.object({
  medicationId: z.uuid(),
  version: z.coerce.number().int().min(1),
  reason: z.string().trim().min(1, { error: "required" }).max(500, { error: "tooLongText" }),
  endDate: day((d) => d <= today(), "futureDate").default(() => new Date(`${today()}T00:00:00Z`)),
});

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const photoMetaSchema = z.object({
  patientId: z.uuid(),
  kind: z.enum(["PROFILE", "MEDICAL"]).default("MEDICAL"),
  category: optionalEnum(PHOTO_CATEGORIES),
  description: text(300),
  takenOn: day((d) => d <= today(), "futureDate"),
  notes: text(2000),
});
