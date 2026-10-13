import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import * as conditions from "@/server/services/conditions";
import * as dashboard from "@/server/services/dashboard";
import * as diabetic from "@/server/services/diabetic";
import * as patients from "@/server/services/patients";
import * as vitals from "@/server/services/vitals";
import { signIn } from "@/server/services/users";
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

const basic = (tripId: string, extra: Record<string, unknown> = {}) => ({
  tripId,
  firstName: "Ana",
  lastName: "Pérez",
  dateOfBirth: "1990-04-02",
  gender: "FEMALE",
  assignedSpecialty: "PHYSICIAN",
  ...extra,
});

async function setup() {
  const trip = await createTrip();
  const otherTrip = await createTrip();
  const doctor = await createUser();
  const student = await createUser({ role: "STUDENT", specialty: null });
  await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });
  return { trip, otherTrip, doctor, student };
}

describe("registerPatient", () => {
  it("numbers patients per trip, creates the trip visit and conditions, and audits without values", async () => {
    const { trip, student } = await setup();
    await signInAs(student);
    const first = await patients.registerPatient(
      basic(trip.id, { conditions: [{ condition: "Asthma", severity: "MILD" }, { condition: "Other", otherName: "Gout" }] }),
    );
    const second = await patients.registerPatient(basic(trip.id, { firstName: "Luis", gender: "MALE" }));
    expect(first.label).toBe(`001_${trip.code}`);
    expect(second.label).toBe(`002_${trip.code}`);

    const stored = await db.patient.findUniqueOrThrow({
      where: { id: first.id },
      include: { visits: true, conditions: true },
    });
    expect(stored.visits).toHaveLength(1);
    expect(stored.visits[0]).toMatchObject({ tripVisit: true, visitType: "Trip Visit" });
    expect(stored.conditions.map((c) => c.condition).sort()).toEqual(["Asthma", "Gout"]);
    expect(stored.createdById).toBe(student.id);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "patient.create", entityId: first.id } });
    expect(JSON.stringify(entry.details)).not.toMatch(/Ana|Pérez|1990/);
  });

  it("accepts an age estimate instead of a date of birth", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const { id } = await patients.registerPatient(basic(trip.id, { dateOfBirth: "", ageValue: "8", ageUnit: "MONTHS", assignedSpecialty: "PEDIATRICIAN" }));
    expect(await db.patient.findUniqueOrThrow({ where: { id } })).toMatchObject({ dateOfBirth: null, ageValue: 8, ageUnit: "MONTHS" });
  });

  it("validates input", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const bad = [
      basic(trip.id, { firstName: "" }),
      basic(trip.id, { dateOfBirth: "", ageValue: "" }), // neither DOB nor age
      basic(trip.id, { dateOfBirth: "2999-01-01" }),
      basic(trip.id, { dateOfBirth: "", ageValue: 30, ageUnit: "MONTHS" }), // months only up to 24
      basic(trip.id, { gender: "X" }),
      basic(trip.id, { conditions: [{ condition: "Other" }] }), // "Other" needs a name
      basic(trip.id, { waterHistory: ["Not a real condition"] }),
    ];
    for (const input of bad) await expect(patients.registerPatient(input), JSON.stringify(input)).rejects.toBeInstanceOf(ValidationError);
  });

  it("students only on trips they're switched on for; nobody on a trip that doesn't exist", async () => {
    const { otherTrip, student, doctor } = await setup();
    await signInAs(student);
    await expect(patients.registerPatient(basic(otherTrip.id))).rejects.toBeInstanceOf(ForbiddenError);
    await signInAs(doctor);
    await expect(patients.registerPatient(basic(crypto.randomUUID()))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reading patients", () => {
  it("checks the patient's own trip, not one from the request", async () => {
    const { trip, otherTrip, student, doctor } = await setup();
    await signInAs(doctor);
    const mine = await patients.registerPatient(basic(trip.id));
    const elsewhere = await patients.registerPatient(basic(otherTrip.id));

    await signInAs(student);
    await expect(patients.getPatient(mine.id)).resolves.toMatchObject({ label: mine.label });
    for (const call of [
      () => patients.getPatient(elsewhere.id),
      () => vitals.listVitals(elsewhere.id),
      () => vitals.addVitals({ patientId: elsewhere.id, heartRate: 70 }),
      () => diabetic.addDiabeticEntry({ patientId: elsewhere.id, bloodGlucose: 100 }),
      () => conditions.addCondition({ patientId: elsewhere.id, condition: "Asthma" }),
      () => patients.updatePatient({ ...basic(otherTrip.id), patientId: elsewhere.id, version: 1 }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("audits every record view", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const { id } = await patients.registerPatient(basic(trip.id));
    await patients.getPatient(id);
    await patients.getPatient(id);
    expect(await db.auditLog.count({ where: { action: "patient.view", entityId: id, userId: doctor.id } })).toBe(2);
  });

  it("lists and searches by name or number", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    await patients.registerPatient(basic(trip.id, { firstName: "María", lastName: "López" }));
    await patients.registerPatient(basic(trip.id, { firstName: "José", lastName: "García", waterRiskRating: "HIGH" }));
    await patients.registerPatient(basic(trip.id, { firstName: "Ana", lastName: "López", assignedSpecialty: "DENTIST" }));

    const names = async (filter: Record<string, unknown>) =>
      (await patients.listPatients({ tripId: trip.id, ...filter })).patients.map((p) => p.firstName).sort();
    expect(await names({})).toEqual(["Ana", "José", "María"]);
    expect(await names({ q: "lópez" })).toEqual(["Ana", "María"]);
    expect(await names({ q: "maría lópez" })).toEqual(["María"]);
    expect(await names({ q: "2" })).toEqual(["José"]);
    expect(await names({ q: `003_${trip.code}` })).toEqual(["Ana"]);
    expect(await names({ risk: "HIGH" })).toEqual(["José"]);
    expect(await names({ specialty: "DENTIST" })).toEqual(["Ana"]);
    expect(await names({ q: "nobody" })).toEqual([]);
  });
});

describe("updatePatient", () => {
  it("saves with the right version and refuses a stale one", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const { id } = await patients.registerPatient(basic(trip.id));

    const saved = await patients.updatePatient({ ...basic(trip.id), patientId: id, version: 1, phone: "5555-0101" });
    expect(saved).toEqual({ version: 2 });
    // A second person still has version 1 open and saves: refused, nothing changes.
    await expect(patients.updatePatient({ ...basic(trip.id), patientId: id, version: 1, phone: "5555-9999" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await db.patient.findUniqueOrThrow({ where: { id } })).toMatchObject({ phone: "5555-0101", version: 2 });

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "patient.update", entityId: id } });
    expect(entry.details).toMatchObject({ fields: ["phone"], fromVersion: 1 });
  });

  it("of two simultaneous saves of the same version, exactly one wins", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const { id } = await patients.registerPatient(basic(trip.id));
    const results = await Promise.allSettled(
      ["111", "222", "333"].map((phone) => patients.updatePatient({ ...basic(trip.id), patientId: id, version: 1, phone })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.patient.findUniqueOrThrow({ where: { id } })).version).toBe(2);
  });
});

describe("softDeletePatient", () => {
  it("admin only, needs the label typed, hides the patient and never reuses the number", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const first = await patients.registerPatient(basic(trip.id));
    await expect(patients.softDeletePatient({ patientId: first.id, confirmLabel: first.label })).rejects.toBeInstanceOf(ForbiddenError);

    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    await expect(patients.softDeletePatient({ patientId: first.id, confirmLabel: "001" })).rejects.toBeInstanceOf(ValidationError);
    await patients.softDeletePatient({ patientId: first.id, confirmLabel: first.label });

    await expect(patients.getPatient(first.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await patients.listPatients({ tripId: trip.id })).total).toBe(0);
    expect(await db.patient.findUnique({ where: { id: first.id } })).not.toBeNull(); // still there

    const next = await patients.registerPatient(basic(trip.id));
    expect(next.label).toBe(`002_${trip.code}`);
  });
});

describe("vitals", () => {
  it("computes BMI on the server and converts pounds", async () => {
    const { trip, student } = await setup();
    await signInAs(student);
    const { id } = await patients.registerPatient(basic(trip.id));
    const r = await vitals.addVitals({ patientId: id, weight: "154", weightUnit: "LB", heightCm: "170", bpSystolic: "120", bpDiastolic: "80" });
    expect(r.bmi).toBe(24.2);
    const [row] = await vitals.listVitals(id);
    expect(row).toMatchObject({ weightKg: 69.9, heightCm: 170, bmi: 24.2, bpSystolic: 120 });
  });

  it("ignores a BMI sent by the client", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const { id } = await patients.registerPatient(basic(trip.id));
    await vitals.addVitals({ patientId: id, weight: 70, heightCm: 175, bmi: 99 });
    expect((await vitals.listVitals(id))[0].bmi).toBe(22.9);
  });

  it("rejects empty, out-of-range or inconsistent readings", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const { id } = await patients.registerPatient(basic(trip.id));
    for (const bad of [
      {},
      { heartRate: 500 },
      { bpSystolic: 120 }, // diastolic missing
      { bpSystolic: 80, bpDiastolic: 120 }, // reversed
      { temperatureC: "hot" },
      { heartRate: 70, takenAt: "2999-01-01T00:00:00Z" },
    ]) {
      await expect(vitals.addVitals({ patientId: id, ...bad }), JSON.stringify(bad)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("diabetic entries and conditions", () => {
  it("records and lists them", async () => {
    const { trip, student } = await setup();
    await signInAs(student);
    const { id } = await patients.registerPatient(basic(trip.id));
    await diabetic.addDiabeticEntry({ patientId: id, bloodGlucose: "180", glucoseTiming: "Fasting", insulinType: "Long-acting", insulinDose: "10" });
    await conditions.addCondition({ patientId: id, condition: "Hypertension", severity: "MODERATE", diagnosisDate: "2020-01-15" });
    expect(await diabetic.listDiabeticEntries(id)).toMatchObject([{ bloodGlucose: 180, glucoseTiming: "Fasting", insulinDose: 10 }]);
    expect(await conditions.listConditions(id)).toMatchObject([{ condition: "Hypertension", severity: "MODERATE" }]);
    await expect(diabetic.addDiabeticEntry({ patientId: id, glucoseTiming: "Whenever" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("tripStats", () => {
  it("counts patients by specialty, seen status and water risk", async () => {
    const { trip, doctor } = await setup();
    await signInAs(doctor);
    const a = await patients.registerPatient(basic(trip.id, { waterRiskRating: "HIGH" }));
    await patients.registerPatient(basic(trip.id, { assignedSpecialty: "DENTIST" }));
    await patients.registerPatient(basic(trip.id, { assignedSpecialty: "DENTIST", waterRiskRating: "LOW" }));
    // Phase 5 records diagnoses; simulate one on patient a's trip visit.
    await db.visit.updateMany({ where: { patientId: a.id, tripVisit: true }, data: { diagnosis: "Common cold", specialty: "PHYSICIAN" } });

    const stats = await dashboard.tripStats(trip.id);
    expect(stats).toMatchObject({
      total: 3,
      registeredToday: 3,
      bySpecialty: { PHYSICIAN: { assigned: 1, seen: 1 }, DENTIST: { assigned: 2, seen: 0 }, PEDIATRICIAN: { assigned: 0, seen: 0 } },
      waterRisk: { HIGH: 1, LOW: 1, MEDIUM: 0, unknown: 1 },
    });
  });
});
