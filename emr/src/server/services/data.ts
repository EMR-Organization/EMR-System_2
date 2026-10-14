import "server-only";
import { z } from "zod";
import { csvCell } from "@/lib/shared/csv";
import { localDay } from "@/lib/shared/dates";
import { formatPatientLabel } from "@/lib/shared/patient-label";
import { IMPORT_MAX_BYTES, tripDataSchema } from "@/lib/shared/schemas/trip-data";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertCan } from "@/server/rbac";
import { buildTripData, importTripData, type ImportSummary } from "@/server/trip-data";
import { parse } from "@/server/validation";

// Trip data export and import (spec: services/data; render_data_management in
// app.py). Export: doctors and admins, CSV (one row per patient, for
// spreadsheets) or JSON (everything, re-importable). Import: admins only,
// merge only ("Replace all" from the old app is gone on purpose).

const exportSchema = z.object({ tripId: z.uuid(), format: z.enum(["csv", "json"]) });

export async function exportTrip(input: unknown): Promise<{ fileName: string; contentType: string; body: string }> {
  const actor = await requireUser();
  const { tripId, format } = parse(exportSchema, input);
  await assertCan(actor, "data.export", { tripId });
  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { code: true } });
  if (!trip) throw new NotFoundError();

  const data = await buildTripData(tripId);
  const stamp = new Date().toISOString().slice(0, 10);
  const body = format === "json" ? JSON.stringify(data, null, 2) : toCsv(data);
  await db.$transaction((tx) =>
    audit(tx, actor, {
      action: "data.export",
      entity: "Trip",
      entityId: tripId,
      tripId,
      details: { format, patients: data.patients.length },
    }),
  );
  return format === "json"
    ? { fileName: `emr_trip_${trip.code}_${stamp}.json`, contentType: "application/json; charset=utf-8", body }
    : { fileName: `emr_patients_${trip.code}_${stamp}.csv`, contentType: "text/csv; charset=utf-8", body };
}

/** Called by the upload route before reading the body. */
export async function assertCanImportTrip(tripId: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "data.import", { tripId: parse(z.uuid(), tripId) });
}

/**
 * Validates a trip data file and merges it into this trip. With dryRun, does
 * everything inside a transaction that is then rolled back, so the admin sees
 * exactly what would happen first.
 */
export async function importTripFile(input: { tripId: unknown; dryRun: unknown }, file: Blob | null): Promise<ImportSummary & { dryRun: boolean }> {
  const actor = await requireUser();
  const { tripId, dryRun } = parse(z.object({ tripId: z.uuid(), dryRun: z.stringbool().default(true) }), input);
  await assertCan(actor, "data.import", { tripId });
  if (!file || file.size === 0) throw new ValidationError({ file: ["required"] });
  if (file.size > IMPORT_MAX_BYTES) throw new ValidationError({ file: ["importTooLarge"] });

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new ValidationError({ file: ["importNotJson"] });
  }
  const parsed = tripDataSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError({ file: ["importInvalid"] });
  const data = parsed.data;

  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { code: true } });
  if (!trip) throw new NotFoundError();
  if (data.trip.code !== trip.code) throw new ValidationError({ file: ["importWrongTrip"] });

  try {
    return await db.$transaction(
      async (tx) => {
        const summary = await importTripData(tx, data, tripId, actor);
        if (dryRun) throw new DryRun(summary);
        return { ...summary, dryRun: false };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof DryRun) return { ...err.summary, dryRun: true };
    throw err;
  }
}

/** Thrown to roll back a dry run's transaction while keeping what it found. */
class DryRun extends Error {
  constructor(readonly summary: ImportSummary) {
    super("dry run");
  }
}

// ---------- CSV ----------

const CSV_COLUMNS = [
  "Patient ID",
  "First Name",
  "Last Name",
  "DOB",
  "Age",
  "Gender",
  "Phone",
  "Address",
  "Emergency Contact",
  "Water Source",
  "Water Risk",
  "Water History",
  "Conditions",
  "Assigned To",
  "Seen By",
  "Chief Complaint",
  "Diagnosis",
  "Active Medications",
  "Registration Date",
] as const;

function toCsv(data: Awaited<ReturnType<typeof buildTripData>>): string {
  const today = new Date();
  const rows = data.patients.map((p) => {
    const tripVisit = p.visits.find((v) => v.tripVisit);
    const age = p.dateOfBirth ? ageYears(p.dateOfBirth, today) : p.ageValue != null ? `${p.ageValue}${p.ageUnit === "MONTHS" ? " months" : ""}` : "";
    return [
      formatPatientLabel(p.displayNumber, data.trip.code),
      p.firstName,
      p.lastName,
      p.dateOfBirth ?? "",
      age,
      p.gender,
      p.phone ?? "",
      p.address ?? "",
      p.emergencyContact ?? "",
      p.waterSource ?? "",
      p.waterRiskRating ?? "",
      p.waterHistory.join("; "),
      p.conditions.map((c) => c.condition).join("; "),
      p.assignedSpecialty,
      tripVisit?.specialty ?? "",
      tripVisit?.chiefComplaint ?? "",
      tripVisit?.diagnosis ?? "",
      p.medications
        .filter((m) => m.status === "ACTIVE")
        .map((m) => [m.name, m.dosage, m.frequency].filter(Boolean).join(" "))
        .join("; "),
      localDay(new Date(p.createdAt)),
    ];
  });
  // A byte-order mark so Excel reads accents (José) correctly.
  return "﻿" + [CSV_COLUMNS as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function ageYears(dob: string, today: Date): string {
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return String(Math.max(0, age));
}
