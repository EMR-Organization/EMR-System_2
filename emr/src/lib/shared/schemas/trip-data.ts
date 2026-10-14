import { z } from "zod";

// The trip export/import file (spec: services/data). JSON export writes it;
// import (admins, merge only) and the legacy importer read it. Everything is
// validated before anything is written. Photos aren't included (they're
// backed up with the database instead).
//
// Bounds are the database's and the clinical forms' outer limits: wide enough
// for data recorded by older versions, narrow enough to keep nonsense out.

export const TRIP_DATA_FORMAT = "hf-emr-trip";
export const TRIP_DATA_VERSION = 1;
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;

const id = z.uuid();
const str = (max: number) => z.string().max(max).nullish().transform((v) => v || null);
const day = z.iso.date().nullish().transform((v) => v ?? null);
const instant = z.iso.datetime({ offset: true });
const int = (min: number, max: number) => z.number().int().min(min).max(max).nullish().transform((v) => v ?? null);
const num = (min: number, max: number) => z.number().min(min).max(max).nullish().transform((v) => v ?? null);
const specialty = z.enum(["DENTIST", "PHYSICIAN", "PEDIATRICIAN"]);
const origin = { originNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), createdById: id, createdAt: instant };

const condition = z.object({
  id,
  condition: z.string().min(1).max(200),
  diagnosisDate: day,
  severity: z.enum(["MILD", "MODERATE", "SEVERE"]).nullish().transform((v) => v ?? null),
  notes: str(2000),
  ...origin,
});

const vitals = z.object({
  id,
  takenAt: instant,
  bpSystolic: int(40, 300),
  bpDiastolic: int(20, 200),
  heartRate: int(20, 300),
  temperatureC: num(25, 45),
  weightKg: num(0.2, 400),
  heightCm: num(20, 260),
  bmi: num(5, 150),
  respiratoryRate: int(2, 100),
  oxygenSaturation: int(30, 100),
  notes: str(2000),
  ...origin,
});

const diabetic = z.object({
  id,
  takenAt: instant,
  bloodGlucose: int(10, 2000),
  glucoseTiming: str(60),
  insulinType: str(60),
  insulinDose: num(0, 500),
  bpSystolic: int(40, 300),
  bpDiastolic: int(20, 200),
  totalCholesterol: int(0, 2000),
  ldl: int(0, 2000),
  hdl: int(0, 500),
  triglycerides: int(0, 5000),
  hba1c: num(2, 25),
  notes: str(2000),
  ...origin,
});

const visit = z.object({
  id,
  tripVisit: z.boolean(),
  visitType: z.string().min(1).max(60),
  date: z.iso.date(),
  chiefComplaint: str(500),
  symptoms: str(5000),
  diagnosis: str(5000),
  treatment: str(5000),
  specialty: specialty.nullish().transform((v) => v ?? null),
  followUpDate: day,
  notes: str(5000),
  ...origin,
});

const medication = z.object({
  id,
  visitId: id.nullish().transform((v) => v ?? null),
  name: z.string().min(1).max(120),
  dosage: str(100),
  frequency: str(60),
  route: str(60),
  startDate: day,
  endDate: day,
  prescribedFor: str(300),
  instructions: str(2000),
  notes: str(2000),
  status: z.enum(["ACTIVE", "DISCONTINUED"]),
  discontinueReason: str(500),
  ...origin,
});

export const tripDataPatientSchema = z
  .object({
    id,
    displayNumber: z.number().int().min(1).max(999_999),
    originLabel: str(60),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    dateOfBirth: day,
    ageValue: int(0, 130),
    ageUnit: z.enum(["YEARS", "MONTHS"]).nullish().transform((v) => v ?? null),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    phone: str(40),
    address: str(300),
    emergencyContact: str(200),
    waterSource: str(100),
    waterRiskRating: z.enum(["LOW", "MEDIUM", "HIGH"]).nullish().transform((v) => v ?? null),
    waterHistory: z.array(z.string().max(100)).max(50).default([]),
    waterNotes: str(2000),
    assignedSpecialty: specialty,
    ...origin,
    conditions: z.array(condition).max(500).default([]),
    vitals: z.array(vitals).max(2000).default([]),
    diabetic: z.array(diabetic).max(2000).default([]),
    visits: z.array(visit).max(500).default([]),
    medications: z.array(medication).max(1000).default([]),
  })
  .refine((p) => p.dateOfBirth || p.ageValue !== null, { message: "dobOrAge" })
  .refine((p) => (p.ageValue === null) === (p.ageUnit === null), { message: "agePair" })
  .refine((p) => p.visits.filter((v) => v.tripVisit).length <= 1, { message: "oneTripVisit" });

export const tripDataSchema = z.object({
  format: z.literal(TRIP_DATA_FORMAT),
  formatVersion: z.literal(TRIP_DATA_VERSION),
  exportedAt: instant,
  sourceNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  trip: z.object({
    code: z.string().regex(/^[0-9]{2}_[0-9]{4}(_[A-Za-z0-9]+)?$/),
    name: z.string().min(1).max(200),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2000).max(2100),
    location: z.string().max(200),
  }),
  patients: z.array(tripDataPatientSchema).max(20_000),
}).superRefine((data, ctx) => {
  // Every ID appears once: a hand-merged file with duplicates is refused up front
  // (otherwise the database's unique keys would stop the import halfway).
  const seen = new Set<string>();
  for (const p of data.patients) {
    for (const id of [p.id, ...p.conditions.map((r) => r.id), ...p.vitals.map((r) => r.id), ...p.diabetic.map((r) => r.id), ...p.visits.map((r) => r.id), ...p.medications.map((r) => r.id)]) {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", path: ["patients"], message: "duplicateId" });
        return;
      }
      seen.add(id);
    }
  }
});

export type TripData = z.infer<typeof tripDataSchema>;
export type TripDataInput = z.input<typeof tripDataSchema>;
export type TripDataPatient = TripData["patients"][number];
