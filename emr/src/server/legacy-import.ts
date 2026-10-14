import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TRIP_VISIT_TYPE } from "@/lib/shared/constants";
import { parsePatientLabel } from "@/lib/shared/patient-label";
import {
  TRIP_DATA_FORMAT,
  TRIP_DATA_VERSION,
  tripDataPatientSchema,
  type TripData,
  type TripDataPatient,
} from "@/lib/shared/schemas/trip-data";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { removePhoto, storePhoto } from "@/server/photo-store";
import { importTripData, type ImportSummary } from "@/server/trip-data";

// Imports the old Streamlit app's emr_data/ folder (scripts/import-legacy.ts):
//   trips.json                    trip code -> { name, month, year, location, created_at }
//   trip_<code>/patients.json     "001_05_2026" -> patient (with nested lists)
//   patients.json                 "PT1001" -> patient, from before trips existed
//
// Each old record gets a fixed ID derived from where it came from, so running
// the import again adds nothing twice. It goes through the same merge as the
// admin JSON import, so nothing already in the database is ever changed.
// Photos (base64 inside the JSON) are re-encoded like any upload.

export const LEGACY_NODE_ID = "legacy";
/** Old records have no author; they're attributed to this fixed, non-user ID. */
export const LEGACY_AUTHOR_ID = legacyId("author");

/** A stable UUID (v5 layout) for an old record. */
export function legacyId(...parts: (string | number)[]): string {
  const h = createHash("sha256").update(["hf-emr-legacy", ...parts].join("\u0000")).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Old = Record<string, unknown>;
type LegacyPhoto = { id: string; patientId: string; kind: "PROFILE" | "MEDICAL"; base64: string; takenOn: string | null; description: string | null; category: string | null; notes: string | null };

export type LegacyTrip = {
  code: string;
  meta: { name: string; month: number; year: number; location: string; createdAt: Date | null };
  data: TripData;
  photos: LegacyPhoto[];
};

export type LegacyReport = { trip: string; summary: ImportSummary; photosAdded: number; photosAlreadyHere: number };

// ---------- reading values ----------

const text = (v: unknown, max = 5000): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const number = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** Old forms stored 0 for "not measured". */
const measured = (v: unknown, round = false): number | null => {
  const n = number(v);
  return n === null || n <= 0 ? null : round ? Math.round(n) : n;
};
const day = (v: unknown): string | null => {
  const s = text(v, 40);
  const m = s && /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && !Number.isNaN(new Date(`${m[1]}T00:00:00Z`).getTime()) ? m[1] : null;
};
/** Date and time recorded on the hub, read in the hub's local time (as the old app wrote them). */
const instant = (date: unknown, time?: unknown): string | null => {
  const d = day(date);
  if (!d) return null;
  const t = text(time, 20);
  const hms = t && /^\d{2}:\d{2}(:\d{2})?/.exec(t)?.[0];
  const at = new Date(`${d}T${hms ?? "12:00:00"}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};
const list = (v: unknown): Old[] => (Array.isArray(v) ? v.filter((x): x is Old => !!x && typeof x === "object") : []);
const pick = <T extends string>(v: unknown, map: Record<string, T>): T | null => {
  const s = text(v, 60)?.toLowerCase();
  if (!s) return null;
  const key = Object.keys(map).find((k) => s === k || s.startsWith(k));
  return key ? map[key] : null;
};
const SPECIALTY = { dentist: "DENTIST", physician: "PHYSICIAN", pediatrician: "PEDIATRICIAN" } as const;

// ---------- converting one patient ----------

function convertPatient(
  tripCode: string,
  key: string,
  old: Old,
  displayNumber: number,
  originLabel: string | null,
  warn: (message: string) => void,
): { patient: unknown; photos: LegacyPhoto[] } {
  const id = legacyId("patient", tripCode, key);
  const createdAt = instant(old.registration_date) ?? new Date().toISOString();
  const origin = (at: string | null = createdAt) => ({ originNodeId: LEGACY_NODE_ID, createdById: LEGACY_AUTHOR_ID, createdAt: at ?? createdAt });
  const sub = (kind: string, i: number) => legacyId(kind, tripCode, key, i);

  // Age vs date of birth. The old form always saved a date of birth (defaulting
  // to 1990-01-01) even when an age was typed instead; then the age is the truth.
  let dateOfBirth = day(old.date_of_birth);
  let ageValue = number(old.age_value);
  let ageUnit = pick(old.age_unit, { years: "YEARS", months: "MONTHS" } as const);
  if (ageValue === null && number(old.age_at_registration) !== null) {
    ageValue = number(old.age_at_registration);
    ageUnit = "YEARS";
  }
  if (dateOfBirth && ageValue !== null && ageUnit) {
    const registered = new Date(createdAt);
    const dob = new Date(`${dateOfBirth}T00:00:00Z`);
    const years = registered.getUTCFullYear() - dob.getUTCFullYear() - (registered.getUTCMonth() < dob.getUTCMonth() || (registered.getUTCMonth() === dob.getUTCMonth() && registered.getUTCDate() < dob.getUTCDate()) ? 1 : 0);
    const dobAge = ageUnit === "YEARS" ? years : null;
    if (dateOfBirth === "1990-01-01" && dobAge !== ageValue) {
      warn(`${key}: date of birth 1990-01-01 looks like the old form's default; kept the age (${ageValue} ${ageUnit.toLowerCase()}) instead`);
      dateOfBirth = null;
    }
  }
  if (dateOfBirth) {
    ageValue = null;
    ageUnit = null;
  } else if (ageValue !== null) ageValue = Math.round(ageValue);

  const diagnosis = (old.diagnosis && typeof old.diagnosis === "object" ? old.diagnosis : {}) as Old;
  const oldVisits = list(old.visits);
  const oldTripVisit = oldVisits.find((v) => v.trip_visit === true);
  const tripVisitInfo = (oldTripVisit?.diagnosis_info && typeof oldTripVisit.diagnosis_info === "object" ? oldTripVisit.diagnosis_info : {}) as Old;
  const seenBy = pick(diagnosis.doctor_type ?? oldTripVisit?.doctor_type, SPECIALTY);
  let assigned = pick(old.assigned_doctor_type, SPECIALTY) ?? seenBy;
  if (!assigned) {
    warn(`${key}: no doctor type recorded; assigned to Physician`);
    assigned = "PHYSICIAN";
  }

  const tripVisitId = sub("trip-visit", 0);
  const visits = [
    {
      id: tripVisitId,
      tripVisit: true,
      visitType: TRIP_VISIT_TYPE,
      date: day(oldTripVisit?.date) ?? createdAt.slice(0, 10),
      chiefComplaint: text(diagnosis.chief_complaint ?? tripVisitInfo.chief_complaint, 500),
      symptoms: null,
      diagnosis: text(diagnosis.diagnosis ?? tripVisitInfo.diagnosis),
      treatment: text(diagnosis.treatment ?? tripVisitInfo.treatment),
      specialty: seenBy,
      followUpDate: null,
      notes: null,
      ...origin(instant(oldTripVisit?.date) ?? createdAt),
    },
    ...oldVisits
      .filter((v) => v.trip_visit !== true)
      .map((v, i) => ({
        id: sub("visit", i),
        tripVisit: false,
        visitType: text(v.visit_type, 60) ?? "Visit",
        date: day(v.date) ?? createdAt.slice(0, 10),
        chiefComplaint: text(v.chief_complaint, 500),
        symptoms: text(v.symptoms),
        diagnosis: text(v.diagnosis),
        treatment: text(v.treatment),
        specialty: pick(v.doctor_type, SPECIALTY),
        followUpDate: day(v.follow_up_date),
        notes: [text(v.notes), text(v.medications_prescribed) && `Medications: ${text(v.medications_prescribed)}`].filter(Boolean).join("\n") || null,
        ...origin(instant(v.date, v.time)),
      })),
  ];

  const photos: LegacyPhoto[] = [];
  const profile = text(old.photo, 50_000_000);
  if (profile) photos.push({ id: sub("photo-profile", 0), patientId: id, kind: "PROFILE", base64: profile, takenOn: day(old.registration_date), description: null, category: null, notes: null });
  list(old.medical_photos).forEach((ph, i) => {
    const image = text(ph.image, 50_000_000);
    if (image) {
      photos.push({ id: sub("photo", i), patientId: id, kind: "MEDICAL", base64: image, takenOn: day(ph.date), description: text(ph.description, 300), category: text(ph.category, 60), notes: text(ph.notes, 2000) });
    }
  });

  const patient = {
    id,
    displayNumber,
    originLabel,
    firstName: text(old.first_name, 100) ?? "(no first name)",
    lastName: text(old.last_name, 100) ?? "(no last name)",
    dateOfBirth,
    ageValue,
    ageUnit: ageValue === null ? null : ageUnit,
    gender: pick(old.gender, { male: "MALE", female: "FEMALE", other: "OTHER" } as const) ?? "OTHER",
    phone: text(old.phone, 40),
    address: text(old.address, 300),
    emergencyContact: text(old.emergency_contact, 200),
    waterSource: text(old.water_source, 100),
    waterRiskRating: pick(old.water_risk_rating, { low: "LOW", medium: "MEDIUM", high: "HIGH" } as const),
    waterHistory: Array.isArray(old.water_related_history) ? old.water_related_history.flatMap((w) => text(w, 100) ?? []) : [],
    waterNotes: text(old.water_notes, 2000),
    assignedSpecialty: assigned,
    ...origin(),
    conditions: list(old.conditions)
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => text(c.condition)?.toLowerCase() !== "none") // "None" meant no conditions
      .map(({ c, i }) => ({
        id: sub("condition", i),
        condition: text(c.condition, 200) ?? "Unknown",
        diagnosisDate: day(c.diagnosis_date),
        severity: pick(c.severity, { mild: "MILD", moderate: "MODERATE", severe: "SEVERE" } as const),
        notes: text(c.notes, 2000),
        ...origin(),
      })),
    vitals: list(old.vital_entries).map((v, i) => ({
      id: sub("vitals", i),
      takenAt: instant(v.date, v.time) ?? createdAt,
      bpSystolic: measured(v.bp_systolic, true),
      bpDiastolic: measured(v.bp_diastolic, true),
      heartRate: measured(v.heart_rate, true),
      temperatureC: measured(v.temperature), // the old form was in °C
      weightKg: measured(v.weight), // stored in kg (lb were converted on entry)
      heightCm: measured(v.height),
      bmi: measured(v.bmi),
      respiratoryRate: measured(v.respiratory_rate, true),
      oxygenSaturation: measured(v.oxygen_saturation, true),
      notes: text(v.notes, 2000),
      ...origin(instant(v.date, v.time)),
    })),
    diabetic: list(old.diabetic_entries).map((d, i) => ({
      id: sub("diabetic", i),
      takenAt: instant(d.date, d.time) ?? createdAt,
      bloodGlucose: measured(d.blood_glucose, true),
      glucoseTiming: text(d.glucose_timing, 60),
      insulinType: text(d.insulin_type, 60),
      insulinDose: measured(d.insulin_dose),
      bpSystolic: measured(d.bp_systolic, true),
      bpDiastolic: measured(d.bp_diastolic, true),
      totalCholesterol: measured(d.total_cholesterol, true),
      ldl: measured(d.ldl, true),
      hdl: measured(d.hdl, true),
      triglycerides: measured(d.triglycerides, true),
      hba1c: measured(d.hba1c),
      notes: text(d.notes, 2000),
      ...origin(instant(d.date, d.time)),
    })),
    visits,
    medications: list(old.medications).map((m, i) => ({
      id: sub("medication", i),
      visitId: tripVisitId,
      name: text(m.medication, 120) ?? "Unknown",
      dosage: text(m.dosage, 100),
      frequency: text(m.frequency, 60),
      route: text(m.route, 60),
      startDate: day(m.start_date),
      endDate: day(m.end_date),
      prescribedFor: text(m.prescribed_for, 300),
      instructions: text(m.instructions, 2000),
      notes: text(m.notes, 2000),
      status: text(m.status)?.toLowerCase() === "active" ? "ACTIVE" : "DISCONTINUED",
      discontinueReason: text(m.discontinue_reason, 500),
      ...origin(instant(m.start_date)),
    })),
  };
  return { patient, photos };
}

// ---------- reading the folder ----------

async function readJson(file: string): Promise<Old | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Old) : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${file} isn't valid JSON`);
  }
}

/**
 * Reads emr_data/ into trip data files. Old patients from the root
 * patients.json (no trip) go into `rootTrip` if given, else they're skipped.
 */
export async function readLegacyFolder(dir: string, rootTrip?: string): Promise<{ trips: LegacyTrip[]; warnings: string[] }> {
  const warnings: string[] = [];
  const tripsMeta = (await readJson(path.join(dir, "trips.json"))) ?? {};
  const folders = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && /^trip_/.test(e.name)).map((e) => e.name.slice(5));
  const codes = [...new Set([...Object.keys(tripsMeta), ...folders])].sort();
  const trips: LegacyTrip[] = [];

  const build = (code: string, meta: Old, entries: [string, Old][], numbering: (key: string, index: number) => { displayNumber: number; originLabel: string | null }) => {
    const patients: TripDataPatient[] = [];
    const photos: LegacyPhoto[] = [];
    entries.forEach(([key, old], index) => {
      const { displayNumber, originLabel } = numbering(key, index);
      const { patient, photos: own } = convertPatient(code, key, old, displayNumber, originLabel, (m) => warnings.push(`${code} ${m}`));
      const parsed = tripDataPatientSchema.safeParse(patient);
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || i.message))].join(", ");
        warnings.push(`${code} ${key}: skipped, values out of range or missing (${fields})`);
        return;
      }
      patients.push(parsed.data);
      photos.push(...own);
    });
    const [mm, yyyy] = code.split("_").map(Number);
    return {
      code,
      meta: {
        name: text(meta.name, 200) ?? `Trip ${code}`,
        month: mm,
        year: yyyy,
        location: text(meta.location, 200) ?? "",
        createdAt: day(meta.created_at) ? new Date(`${day(meta.created_at)}T00:00:00Z`) : null,
      },
      data: {
        format: TRIP_DATA_FORMAT,
        formatVersion: TRIP_DATA_VERSION,
        exportedAt: new Date().toISOString(),
        sourceNodeId: LEGACY_NODE_ID,
        trip: { code, name: text(meta.name, 200) ?? `Trip ${code}`, month: mm, year: yyyy, location: text(meta.location, 200) ?? "" },
        patients,
      },
      photos,
    } satisfies LegacyTrip;
  };

  for (const code of codes) {
    if (!/^[0-9]{2}_[0-9]{4}(_[A-Za-z0-9]+)?$/.test(code)) {
      warnings.push(`trip ${code}: not a valid trip code (MM_YYYY), skipped`);
      continue;
    }
    const meta = (tripsMeta[code] && typeof tripsMeta[code] === "object" ? tripsMeta[code] : {}) as Old;
    const patients = (await readJson(path.join(dir, `trip_${code}`, "patients.json"))) ?? {};
    const entries = Object.entries(patients).filter((e): e is [string, Old] => !!e[1] && typeof e[1] === "object");
    trips.push(
      build(code, meta, entries, (key) => {
        const label = parsePatientLabel(key);
        if (!label || label.tripCode !== code) {
          warnings.push(`${code} ${key}: unexpected patient ID; numbered on import`);
          return { displayNumber: 100_000 + entries.findIndex(([k]) => k === key), originLabel: key };
        }
        return { displayNumber: label.displayNumber, originLabel: null };
      }),
    );
  }

  const root = Object.entries((await readJson(path.join(dir, "patients.json"))) ?? {}).filter((e): e is [string, Old] => !!e[1] && typeof e[1] === "object");
  if (root.length > 0) {
    if (!rootTrip) {
      warnings.push(`patients.json: ${root.length} patient(s) from before trips existed were NOT imported; pass --root-trip <MM_YYYY> to import them into a trip`);
    } else if (!/^[0-9]{2}_[0-9]{4}(_[A-Za-z0-9]+)?$/.test(rootTrip)) {
      throw new Error("--root-trip must be a trip code like 12_2025");
    } else {
      const existing = trips.find((t) => t.code === rootTrip);
      const extra = build(rootTrip, { name: "Records from before trips", location: "" }, root, (key, i) => {
        // PT1001 keeps 1001 when it's free (else the next number); the old ID stays on the record.
        const n = Number(/(\d{1,6})$/.exec(key)?.[1] ?? NaN);
        return { displayNumber: n >= 1 ? n : 50_000 + i, originLabel: key };
      });
      if (existing) {
        existing.data.patients.push(...extra.data.patients);
        existing.photos.push(...extra.photos);
      } else trips.push(extra);
    }
  }
  return { trips, warnings };
}

// ---------- writing ----------

/** Creates the trip if it isn't here yet (as a past trip), merges its patients, then adds photos. */
export async function importLegacyTrip(trip: LegacyTrip, options: { dryRun?: boolean } = {}): Promise<LegacyReport> {
  let tripId = (await db.trip.findUnique({ where: { code: trip.code }, select: { id: true } }))?.id;
  const summary = await db
    .$transaction(
      async (tx) => {
        if (!tripId) {
          const created = await tx.trip.create({
            data: { code: trip.code, name: trip.meta.name, month: trip.meta.month, year: trip.meta.year, location: trip.meta.location, active: false, ...(trip.meta.createdAt ? { createdAt: trip.meta.createdAt } : {}) },
            select: { id: true },
          });
          tripId = created.id;
          await audit(tx, null, { action: "trip.create", entity: "Trip", entityId: tripId, tripId, details: { code: trip.code, legacy: true } });
        }
        const result = await importTripData(tx, trip.data, tripId, null);
        if (options.dryRun) throw new DryRun(result);
        return result;
      },
      { timeout: 300_000, maxWait: 10_000 },
    )
    .catch((err: unknown) => {
      if (err instanceof DryRun) return err.summary;
      throw err;
    });
  if (options.dryRun) return { trip: trip.code, summary, photosAdded: 0, photosAlreadyHere: 0 };

  let photosAdded = 0;
  let photosAlreadyHere = 0;
  const imported = new Set((await db.patient.findMany({ where: { id: { in: trip.data.patients.map((p) => p.id) }, tripId }, select: { id: true } })).map((p) => p.id));
  for (const photo of trip.photos) {
    if (!imported.has(photo.patientId)) continue;
    if (await db.photo.findUnique({ where: { id: photo.id }, select: { id: true } })) {
      photosAlreadyHere++;
      continue;
    }
    const stored = await storePhoto(Buffer.from(photo.base64.replace(/^data:[^,]*,/, ""), "base64")).catch(() => null);
    if (!stored) {
      summary.skipped.push(`photo for patient ${photo.patientId}: not a readable image`);
      continue;
    }
    await db
      .$transaction(async (tx) => {
      await tx.photo.create({
        data: {
          id: photo.id,
          patientId: photo.patientId,
          kind: photo.kind,
          filePath: stored.fileName,
          mimeType: "image/jpeg",
          sizeBytes: stored.sizeBytes,
          category: photo.category,
          description: photo.description,
          notes: photo.notes,
          takenOn: photo.takenOn ? new Date(`${photo.takenOn}T00:00:00Z`) : null,
          originNodeId: LEGACY_NODE_ID,
          createdById: LEGACY_AUTHOR_ID,
        },
      });
      await audit(tx, null, { action: "photo.create", entity: "Photo", entityId: photo.id, tripId, details: { patientId: photo.patientId, kind: photo.kind, legacy: true } });
      })
      .catch(async (err: unknown) => {
        await removePhoto(stored.fileName);
        throw err;
      });
    photosAdded++;
  }
  return { trip: trip.code, summary, photosAdded, photosAlreadyHere };
}

class DryRun extends Error {
  constructor(readonly summary: ImportSummary) {
    super("dry run");
  }
}
