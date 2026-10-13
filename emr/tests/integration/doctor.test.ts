import { readdirSync } from "node:fs";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { sniffImage } from "@/server/photo-store";
import * as dashboard from "@/server/services/dashboard";
import * as medications from "@/server/services/medications";
import * as patients from "@/server/services/patients";
import * as photos from "@/server/services/photos";
import { signIn } from "@/server/services/users";
import * as visits from "@/server/services/visits";
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

async function setup(assignedSpecialty = "PHYSICIAN") {
  const trip = await createTrip();
  const doctor = await createUser({ specialty: "PHYSICIAN" });
  const dentist = await createUser({ specialty: "DENTIST" });
  const student = await createUser({ role: "STUDENT", specialty: null });
  await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });
  await signInAs(doctor);
  const patient = await patients.registerPatient({
    tripId: trip.id,
    firstName: "Doc",
    lastName: "Flow",
    ageValue: 50,
    ageUnit: "YEARS",
    gender: "MALE",
    assignedSpecialty,
  });
  return { trip, doctor, dentist, student, patient };
}

describe("diagnosis", () => {
  it("is saved on the trip visit with the doctor's specialty, with optimistic locking", async () => {
    const { patient, dentist } = await setup();
    const visit = await visits.getTripVisit(patient.id);
    expect(visit).toMatchObject({ tripVisit: true, diagnosis: null, version: 1 });

    await expect(
      visits.recordDiagnosis({ patientId: patient.id, version: 1, chiefComplaint: "Cough", diagnosis: "Bronchitis", treatment: "Rest" }),
    ).resolves.toEqual({ version: 2 });
    expect(await visits.getTripVisit(patient.id)).toMatchObject({ diagnosis: "Bronchitis", specialty: "PHYSICIAN", version: 2 });

    // A second doctor who opened version 1 can't overwrite it.
    await signInAs(dentist);
    await expect(visits.recordDiagnosis({ patientId: patient.id, version: 1, diagnosis: "Something else" })).rejects.toMatchObject({
      messageKey: "patientConflict",
    });
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "diagnosis.save" }, orderBy: { id: "desc" } });
    expect(JSON.stringify(entry.details)).not.toMatch(/Bronchitis|Cough/);
  });

  it("students can't diagnose or read visit history", async () => {
    const { patient, student } = await setup();
    await signInAs(student);
    await expect(visits.recordDiagnosis({ patientId: patient.id, version: 1, diagnosis: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(visits.getTripVisit(patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(visits.listVisits(patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(visits.addVisit({ patientId: patient.id, visitType: "Follow-up" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("recreates a missing trip visit (older records)", async () => {
    const { patient } = await setup();
    await db.visit.deleteMany({ where: { patientId: patient.id } });
    await visits.recordDiagnosis({ patientId: patient.id, version: 1, diagnosis: "Flu" });
    expect(await db.visit.count({ where: { patientId: patient.id, tripVisit: true } })).toBe(1);
  });
});

describe("visits", () => {
  it("adds visits and lists the trip visit first", async () => {
    const { patient } = await setup();
    await visits.addVisit({ patientId: patient.id, visitType: "Follow-up", diagnosis: "Improving", followUpDate: "2999-01-01" });
    const list = await visits.listVisits(patient.id);
    expect(list.map((v) => v.visitType)).toEqual(["Trip Visit", "Follow-up"]);
    expect(list[1]).toMatchObject({ specialty: "PHYSICIAN", tripVisit: null });
    await expect(visits.addVisit({ patientId: patient.id, visitType: "Party" })).rejects.toBeInstanceOf(ValidationError);
    await expect(visits.addVisit({ patientId: patient.id, visitType: "Follow-up", date: "2999-01-01" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("medications", () => {
  it("prescribes on the trip visit, marks who saw the patient, and discontinues with a reason", async () => {
    const { patient, trip, student } = await setup("DENTIST");
    const med = await medications.prescribe({ patientId: patient.id, name: "Amoxicillin", dosage: "500mg", frequency: "Three times daily", route: "Oral" });
    const tripVisit = await db.visit.findFirstOrThrow({ where: { patientId: patient.id, tripVisit: true } });
    expect(await db.medication.findUniqueOrThrow({ where: { id: med.id } })).toMatchObject({ visitId: tripVisit.id, status: "ACTIVE" });
    expect(tripVisit.specialty).toBe("PHYSICIAN"); // a physician saw this dentist-assigned patient

    // Seen by a physician: no longer waiting for the dentist.
    const stats = await dashboard.tripStats(trip.id);
    expect(stats.bySpecialty.DENTIST.waiting).toBe(0);
    expect(stats.bySpecialty.PHYSICIAN.seen).toBe(1);

    await expect(medications.discontinue({ medicationId: med.id, version: 1, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await medications.discontinue({ medicationId: med.id, version: 1, reason: "Entered in error" });
    await expect(medications.discontinue({ medicationId: med.id, version: 2, reason: "again" })).rejects.toMatchObject({
      messageKey: "medicationConflict",
    });
    expect(await medications.listMedications(patient.id)).toMatchObject([{ status: "DISCONTINUED", discontinueReason: "Entered in error" }]);

    // Students see medications but can't prescribe.
    await signInAs(student);
    await expect(medications.listMedications(patient.id)).resolves.toHaveLength(1);
    await expect(
      medications.prescribe({ patientId: patient.id, name: "Ibuprofen", dosage: "200mg", frequency: "As needed" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates prescriptions, including named 'Other' medications", async () => {
    const { patient } = await setup();
    await expect(medications.prescribe({ patientId: patient.id, name: "Other", dosage: "1 tab", frequency: "Once daily" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const { id } = await medications.prescribe({ patientId: patient.id, name: "Other", otherName: "Albendazole", dosage: "400mg", frequency: "Once daily" });
    expect((await db.medication.findUniqueOrThrow({ where: { id } })).name).toBe("Albendazole");
    await expect(medications.prescribe({ patientId: patient.id, name: "Aspirin", dosage: "", frequency: "Once daily" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("doctorQueue", () => {
  it("lists my specialty's patients, waiting first", async () => {
    const { trip, patient, dentist } = await setup();
    const second = await patients.registerPatient({
      tripId: trip.id,
      firstName: "Second",
      lastName: "Patient",
      ageValue: 20,
      ageUnit: "YEARS",
      gender: "FEMALE",
      assignedSpecialty: "PHYSICIAN",
    });
    await patients.registerPatient({ tripId: trip.id, firstName: "Tooth", lastName: "Ache", ageValue: 9, ageUnit: "YEARS", gender: "MALE", assignedSpecialty: "DENTIST" });
    await visits.recordDiagnosis({ patientId: patient.id, version: 1, diagnosis: "Done" });

    const q = await dashboard.doctorQueue({ tripId: trip.id });
    expect(q.specialty).toBe("PHYSICIAN");
    expect(q.patients.map((p) => p.id)).toEqual([second.id, patient.id]);
    expect(q.patients[1]).toMatchObject({ hasDiagnosis: true });

    await signInAs(dentist);
    expect((await dashboard.doctorQueue({ tripId: trip.id, specialty: "PHYSICIAN" })).patients.map((p) => p.firstName)).toEqual(["Tooth"]);

    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    expect((await dashboard.doctorQueue({ tripId: trip.id })).patients).toEqual([]);
    expect((await dashboard.doctorQueue({ tripId: trip.id, specialty: "PHYSICIAN" })).patients).toHaveLength(2);
  });
});

describe("photos", () => {
  async function jpegWithGps() {
    return sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-camera-owner" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "14/1 38/1 0/1" } })
      .toBuffer();
  }

  it("stores a re-encoded JPEG without metadata, and audits every view", async () => {
    const { patient, student } = await setup();
    await signInAs(student);
    const original = await jpegWithGps();
    expect(original.includes(Buffer.from("secret-camera-owner"))).toBe(true);

    const { id } = await photos.uploadPhoto({ patientId: patient.id, kind: "MEDICAL", category: "Wound/Injury", description: "Left arm" }, new Blob([new Uint8Array(original)]));
    const { bytes, mimeType } = await photos.getPhoto(id);
    expect(mimeType).toBe("image/jpeg");
    expect(sniffImage(bytes)).toBe("jpeg");
    expect(bytes.includes(Buffer.from("secret-camera-owner"))).toBe(false);
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();

    const row = await db.photo.findUniqueOrThrow({ where: { id } });
    expect(row.filePath).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(readdirSync(process.env.PHOTOS_DIR!)).toContain(row.filePath);
    expect(await db.auditLog.count({ where: { action: "photo.view", entityId: id } })).toBe(1);
    expect(await photos.listPhotos(patient.id)).toMatchObject([{ id, kind: "MEDICAL", category: "Wound/Injury" }]);
  });

  it("rejects files that aren't images, whatever they're called", async () => {
    const { patient } = await setup();
    const html = new Blob(["<script>alert(1)</script>"], { type: "image/jpeg" });
    await expect(photos.uploadPhoto({ patientId: patient.id }, html)).rejects.toMatchObject({ fieldErrors: { photo: ["photoType"] } });
    const fakeJpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])]);
    await expect(photos.uploadPhoto({ patientId: patient.id }, fakeJpeg)).rejects.toMatchObject({ fieldErrors: { photo: ["photoUnreadable"] } });
    await expect(photos.uploadPhoto({ patientId: patient.id }, new Blob([new Uint8Array(6 * 1024 * 1024)]))).rejects.toMatchObject({
      fieldErrors: { photo: ["photoTooLarge"] },
    });
    expect(await db.photo.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it("checks the patient's trip for upload and view", async () => {
    const { patient } = await setup();
    const { id } = await photos.uploadPhoto({ patientId: patient.id }, new Blob([new Uint8Array(await jpegWithGps())]));
    const outsider = await createUser({ role: "STUDENT", specialty: null });
    await signInAs(outsider);
    await expect(photos.getPhoto(id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(photos.uploadPhoto({ patientId: patient.id }, new Blob([new Uint8Array(await jpegWithGps())]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(photos.getPhoto(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
