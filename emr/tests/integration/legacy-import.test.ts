import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyChain } from "@/server/audit";
import { db } from "@/server/db";
import { importLegacyTrip, LEGACY_AUTHOR_ID, LEGACY_NODE_ID, readLegacyFolder } from "@/server/legacy-import";

// The old app's emr_data/ layout, with fake data covering every field
// (tests/fixtures/legacy-emr-data). Each run gets its own trip codes, so runs
// against the shared test database don't see each other's patients.

function fixtureCopy(): { dir: string; code: string; rootCode: string } {
  const suffix = `L${Math.random().toString(36).slice(2, 8)}`;
  const code = `03_2019_${suffix}`;
  const dir = mkdtempSync(path.join(tmpdir(), "emr-legacy-"));
  cpSync(path.join(__dirname, "../fixtures/legacy-emr-data"), dir, { recursive: true });
  renameSync(path.join(dir, "trip_03_2019"), path.join(dir, `trip_${code}`));
  for (const file of ["trips.json", `trip_${code}/patients.json`]) {
    const full = path.join(dir, file);
    writeFileSync(full, readFileSync(full, "utf8").replaceAll("03_2019", code));
  }
  return { dir, code, rootCode: `12_2018_${suffix}` };
}

describe("legacy import (emr_data/ from the Streamlit app)", () => {
  it("maps every field, skips 'None' conditions, and fixes the 1990-01-01 default", async () => {
    const { dir, code, rootCode } = fixtureCopy();
    const { trips, warnings } = await readLegacyFolder(dir, rootCode);
    expect(trips.map((t) => t.code).sort()).toEqual([code, rootCode].sort());
    expect(warnings.join("\n")).toMatch(/1990-01-01 looks like the old form's default/);
    expect(warnings.join("\n")).toMatch(/PT1001: no doctor type recorded; assigned to Physician/);

    const reports = [];
    for (const trip of trips) reports.push(await importLegacyTrip(trip));
    const main = reports.find((r) => r.trip === code)!;
    expect(main.summary).toMatchObject({ patientsAdded: 2, renumbered: [], skipped: [expect.stringMatching(/not a readable image/)] });
    expect(main.photosAdded).toBe(2); // profile + one medical; the broken one is reported, not imported

    const trip = await db.trip.findUniqueOrThrow({ where: { code } });
    expect(trip).toMatchObject({ name: "Fixture Trip", month: 3, year: 2019, location: "Fixtureville", active: false, nextPatientNumber: 3 });

    const p = await db.patient.findFirstOrThrow({
      where: { tripId: trip.id, displayNumber: 1 },
      include: { conditions: true, vitals: true, diabetic: true, visits: { orderBy: { date: "asc" } }, medications: { orderBy: { name: "asc" } }, photos: true },
    });
    expect(p).toMatchObject({
      firstName: "Fakefirst",
      lastName: "Fakelast",
      dateOfBirth: new Date("1975-06-15T00:00:00Z"),
      ageValue: null,
      gender: "FEMALE",
      phone: "555-0101",
      address: "1 Fixture Road",
      emergencyContact: "Fake Contact 555-0102",
      waterSource: "Well Water",
      waterRiskRating: "HIGH",
      waterHistory: ["Cholera", "Typhoid Fever"],
      waterNotes: "Boils water sometimes",
      assignedSpecialty: "PHYSICIAN",
      originNodeId: LEGACY_NODE_ID,
      createdById: LEGACY_AUTHOR_ID,
      originLabel: null,
    });
    expect(p.conditions).toEqual([expect.objectContaining({ condition: "Hypertension", severity: "MODERATE", notes: "On meds", diagnosisDate: new Date("2018-01-10T00:00:00Z") })]);
    expect(p.vitals).toEqual([
      expect.objectContaining({ bpSystolic: 150, bpDiastolic: 95, heartRate: 80, temperatureC: 37.2, weightKg: 68.5, heightCm: 160, bmi: 26.8, respiratoryRate: 16, oxygenSaturation: 97, notes: "Rested 5 min" }),
    ]);
    expect(p.diabetic).toEqual([
      expect.objectContaining({ bloodGlucose: 180, glucoseTiming: "Fasting", insulinDose: null, totalCholesterol: 210, ldl: null, hdl: 45, triglycerides: 160, hba1c: 7.4 }),
    ]);
    expect(p.visits).toEqual([
      expect.objectContaining({ tripVisit: true, visitType: "Trip Visit", chiefComplaint: "Headache", diagnosis: "Hypertension", treatment: "Lisinopril", specialty: "PHYSICIAN" }),
      expect.objectContaining({ tripVisit: null, visitType: "Follow-up", symptoms: "None", diagnosis: "Improving", followUpDate: new Date("2019-04-01T00:00:00Z"), notes: expect.stringContaining("Medications: Lisinopril 10 mg") }),
    ]);
    const tripVisit = p.visits[0];
    expect(p.medications).toEqual([
      expect.objectContaining({ name: "Ibuprofen", status: "DISCONTINUED", discontinueReason: "Entered in error", endDate: new Date("2019-03-03T00:00:00Z"), visitId: tripVisit.id }),
      expect.objectContaining({ name: "Lisinopril", status: "ACTIVE", dosage: "10 mg", frequency: "Once daily", route: "Oral", prescribedFor: "Hypertension", instructions: "With water", visitId: tripVisit.id }),
    ]);
    expect(p.photos.map((ph) => ph.kind).sort()).toEqual(["MEDICAL", "PROFILE"]);
    expect(p.photos.find((ph) => ph.kind === "MEDICAL")).toMatchObject({ description: "Left foot", category: "Wound/Injury", notes: "Healing" });
    for (const ph of p.photos) expect(readdirSync(process.env.PHOTOS_DIR!)).toContain(ph.filePath);

    const baby = await db.patient.findFirstOrThrow({ where: { tripId: trip.id, displayNumber: 2 } });
    expect(baby).toMatchObject({ dateOfBirth: null, ageValue: 8, ageUnit: "MONTHS", assignedSpecialty: "PEDIATRICIAN" });

    const rootTrip = await db.trip.findUniqueOrThrow({ where: { code: rootCode } });
    expect(await db.patient.findFirstOrThrow({ where: { tripId: rootTrip.id } })).toMatchObject({
      displayNumber: 1001,
      originLabel: "PT1001",
      gender: "OTHER",
      dateOfBirth: new Date("1960-02-29T00:00:00Z"),
      waterRiskRating: "MEDIUM",
    });

    expect((await verifyChain()).ok).toBe(true);
  });

  it("running it again adds nothing", async () => {
    const { dir, code } = fixtureCopy();
    for (const trip of (await readLegacyFolder(dir)).trips) await importLegacyTrip(trip);
    const trip = await db.trip.findUniqueOrThrow({ where: { code } });
    const before = await db.patient.count({ where: { tripId: trip.id } });
    const photos = await db.photo.count({ where: { patient: { tripId: trip.id } } });

    const again = await importLegacyTrip((await readLegacyFolder(dir)).trips.find((t) => t.code === code)!);
    expect(again).toMatchObject({ summary: { patientsAdded: 0, patientsAlreadyHere: 2 }, photosAdded: 0, photosAlreadyHere: 2 });
    expect(Object.values(again.summary.recordsAdded).every((n) => n === 0)).toBe(true);
    expect(await db.patient.count({ where: { tripId: trip.id } })).toBe(before);
    expect(await db.photo.count({ where: { patient: { tripId: trip.id } } })).toBe(photos);
  });

  it("dry run writes nothing", async () => {
    const { dir, code } = fixtureCopy();
    const [trip] = (await readLegacyFolder(dir)).trips;
    const report = await importLegacyTrip(trip, { dryRun: true });
    expect(report.summary.patientsAdded).toBe(2);
    expect(await db.trip.findUnique({ where: { code } })).toBeNull();
  });

  it("leaves root patients out unless a trip is named for them", async () => {
    const { dir } = fixtureCopy();
    const { trips, warnings } = await readLegacyFolder(dir);
    expect(trips).toHaveLength(1);
    expect(warnings.join("\n")).toMatch(/1 patient\(s\) from before trips existed were NOT imported/);
  });
});
