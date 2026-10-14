import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import type { TripData } from "@/lib/shared/schemas/trip-data";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { exportTrip, importTripFile } from "@/server/services/data";
import * as medications from "@/server/services/medications";
import * as patients from "@/server/services/patients";
import { signIn } from "@/server/services/users";
import * as visits from "@/server/services/visits";
import * as vitals from "@/server/services/vitals";
import { browser } from "./fake-request";
import { createTrip, createUser } from "./fixtures";

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

async function signInAs(user: { email: string; password: string }) {
  browser.reset();
  await signIn({ email: user.email, password: user.password });
}

const json = (data: unknown) => new Blob([JSON.stringify(data)], { type: "application/json" });
const counts = async (tripId: string) => ({
  patients: await db.patient.count({ where: { tripId } }),
  vitals: await db.vitals.count({ where: { patient: { tripId } } }),
  visits: await db.visit.count({ where: { patient: { tripId } } }),
  medications: await db.medication.count({ where: { patient: { tripId } } }),
});

describe("trip data export and import", async () => {
  const trip = await createTrip();
  const doctor = await createUser();
  const admin = await createUser({ role: "ADMIN", specialty: null });
  const student = await createUser({ role: "STUDENT", specialty: null });
  await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });

  await signInAs(doctor);
  const ana = await patients.registerPatient({
    tripId: trip.id,
    firstName: "José",
    lastName: "=HYPERLINK(\"http://evil.example\")",
    gender: "MALE",
    assignedSpecialty: "PHYSICIAN",
    dateOfBirth: "1980-01-02",
    phone: "+502 5555-0100",
  });
  await patients.registerPatient({ tripId: trip.id, firstName: "Ben", lastName: "Two", gender: "MALE", assignedSpecialty: "DENTIST", ageValue: 8, ageUnit: "MONTHS" });
  await vitals.addVitals({ patientId: ana.id, bpSystolic: 120, bpDiastolic: 80 });
  await visits.recordDiagnosis({ patientId: ana.id, version: 1, diagnosis: "Hypertension" });
  await medications.prescribe({ patientId: ana.id, name: "Lisinopril", dosage: "10 mg", frequency: "Once daily" });

  async function exportJson(): Promise<TripData> {
    await signInAs(doctor);
    return JSON.parse((await exportTrip({ tripId: trip.id, format: "json" })).body) as TripData;
  }

  it("exports CSV for spreadsheets, with formulas defused, and audits it", async () => {
    await signInAs(doctor);
    const csv = await exportTrip({ tripId: trip.id, format: "csv" });
    expect(csv.fileName).toMatch(/^emr_patients_.+\.csv$/);
    expect(csv.body.startsWith("﻿Patient ID,")).toBe(true);
    expect(csv.body).toContain("José");
    expect(csv.body).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv.body).toContain("Hypertension");
    expect(csv.body).toContain("Lisinopril 10 mg Once daily");
    expect(csv.body).toContain("8 months");
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "data.export", entityId: trip.id }, orderBy: { id: "desc" } });
    expect(entry.details).toMatchObject({ format: "csv", patients: 2 });
  });

  it("is for doctors and admins (export) and admins (import) only", async () => {
    await signInAs(student);
    await expect(exportTrip({ tripId: trip.id, format: "csv" })).rejects.toBeInstanceOf(ForbiddenError);
    const data = await exportJson();
    await expect(importTripFile({ tripId: trip.id, dryRun: "false" }, json(data))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("re-importing an export changes nothing", async () => {
    const data = await exportJson();
    expect(data.patients).toHaveLength(2);
    const before = await counts(trip.id);
    await signInAs(admin);
    const summary = await importTripFile({ tripId: trip.id, dryRun: "false" }, json(data));
    expect(summary).toMatchObject({ dryRun: false, patientsAdded: 0, patientsAlreadyHere: 2, skipped: [] });
    expect(summary.recordsAlreadyHere).toBeGreaterThanOrEqual(4);
    expect(await counts(trip.id)).toEqual(before);
  });

  it("merges new patients and records from another hub; dry run first, numbers kept or reassigned", async () => {
    const data = await exportJson();
    const [first] = data.patients;
    const node = "fallback-1";
    const stamp = new Date().toISOString();
    const visitId = randomUUID();
    // From a fallback laptop: one more vitals entry for an existing patient, and two new patients,
    // one whose number (1) is taken here and one whose number (900) is free.
    first.vitals.push({ ...first.vitals[0], id: randomUUID(), originNodeId: node, createdAt: stamp, bpSystolic: 130 });
    const newPatient = (displayNumber: number) => ({
      ...first,
      id: randomUUID(),
      displayNumber,
      originLabel: null,
      firstName: `New${displayNumber}`,
      originNodeId: node,
      conditions: [],
      vitals: [],
      diabetic: [],
      visits: [{ ...first.visits[0], id: visitId, originNodeId: node }],
      // Points at a visit of ANOTHER patient: must not be linked.
      medications: [{ ...first.medications[0], id: randomUUID(), visitId: first.visits[0].id, originNodeId: node }],
    });
    data.patients.push(newPatient(1), { ...newPatient(900), visits: [] , medications: [] });

    await signInAs(admin);
    const before = await counts(trip.id);
    const preview = await importTripFile({ tripId: trip.id, dryRun: "true" }, json(data));
    expect(preview).toMatchObject({ dryRun: true, patientsAdded: 2, patientsAlreadyHere: 2 });
    expect(preview.renumbered).toHaveLength(1);
    expect(preview.renumbered[0].from).toMatch(/^001_/);
    expect(await counts(trip.id)).toEqual(before); // the dry run was rolled back

    const done = await importTripFile({ tripId: trip.id, dryRun: "false" }, json(data));
    expect(done).toMatchObject({ dryRun: false, patientsAdded: 2, recordsAdded: { vitals: 1, visits: 1, medications: 1 } });
    expect(await counts(trip.id)).toEqual({
      patients: before.patients + 2,
      vitals: before.vitals + 1,
      visits: before.visits + 1,
      medications: before.medications + 1,
    });

    const moved = await db.patient.findFirstOrThrow({ where: { tripId: trip.id, firstName: "New1" } });
    expect(moved.displayNumber).toBe(901); // past 900, the highest number kept
    expect(moved.originLabel).toMatch(/^001_/);
    expect(moved.originNodeId).toBe(node);
    expect(await db.patient.findFirstOrThrow({ where: { tripId: trip.id, firstName: "New900" } })).toMatchObject({ displayNumber: 900, originLabel: null });
    const med = await db.medication.findFirstOrThrow({ where: { patientId: moved.id } });
    expect(med.visitId).toBeNull();
    // Registration continues after the highest number in use.
    await signInAs(doctor);
    const next = await patients.registerPatient({ tripId: trip.id, firstName: "After", lastName: "Import", gender: "FEMALE", assignedSpecialty: "PHYSICIAN", ageValue: 3, ageUnit: "YEARS" });
    expect(next.label).toMatch(/^902_/);

    // Every patient that gained something is audited, with record IDs only.
    const entries = await db.auditLog.findMany({ where: { action: "data.import.patient", tripId: trip.id }, orderBy: { id: "desc" }, take: 3 });
    expect(entries.map((e) => (e.details as { created: boolean }).created).sort()).toEqual([false, true, true]);
    expect(JSON.stringify(entries.map((e) => e.details))).not.toContain("New1");

    await signInAs(admin);
    const again = await importTripFile({ tripId: trip.id, dryRun: "false" }, json(data));
    expect(again).toMatchObject({ patientsAdded: 0, recordsAdded: { conditions: 0, vitals: 0, diabetic: 0, visits: 0, medications: 0 } });
  });

  it("refuses files for another trip, invalid files, and IDs that belong elsewhere", async () => {
    const data = await exportJson();
    await signInAs(admin);
    await expect(importTripFile({ tripId: trip.id, dryRun: "true" }, json({ ...data, trip: { ...data.trip, code: "02_2031" } }))).rejects.toMatchObject({
      fieldErrors: { file: ["importWrongTrip"] },
    });
    await expect(importTripFile({ tripId: trip.id, dryRun: "true" }, new Blob(["not json"]))).rejects.toMatchObject({ fieldErrors: { file: ["importNotJson"] } });
    const broken = structuredClone(data);
    (broken.patients[0] as { gender: string }).gender = "Robot";
    await expect(importTripFile({ tripId: trip.id, dryRun: "true" }, json(broken))).rejects.toMatchObject({ fieldErrors: { file: ["importInvalid"] } });

    // The same file imported into a different trip: those patient IDs already live in this one.
    const other = await createTrip();
    const summary = await importTripFile({ tripId: other.id, dryRun: "false" }, json({ ...data, trip: { ...data.trip, code: other.code } }));
    expect(summary.patientsAdded).toBe(0);
    expect(summary.skipped).toHaveLength(data.patients.length);
  });
});
