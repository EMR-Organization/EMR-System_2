import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import * as patients from "@/server/services/patients";
import { searchPatients } from "@/server/services/search";
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

// Unique per run, so earlier runs' patients in the shared test database don't match.
const tag = () => `Zq${Math.random().toString(36).slice(2, 8)}`;

describe("cross-trip search", async () => {
  const earlier = await createTrip();
  const current = await createTrip();
  const other = await createTrip();
  const doctor = await createUser();
  const student = await createUser({ role: "STUDENT", specialty: null });
  await db.tripMember.create({ data: { tripId: current.id, userId: student.id, enabled: true } });

  await signInAs(doctor);
  const surname = tag();
  const register = (tripId: string, extra: Record<string, unknown>) =>
    patients.registerPatient({ tripId, lastName: surname, gender: "FEMALE", assignedSpecialty: "PHYSICIAN", ageValue: 40, ageUnit: "YEARS", ...extra });
  // registerPatient refuses past trips for doctors, so the earlier-trip patient is created while it's active.
  await db.trip.update({ where: { id: earlier.id }, data: { active: true } });
  const returning = await register(earlier.id, { firstName: "José", phone: "+502 5555-0142", dateOfBirth: "1984-03-09", ageValue: undefined, ageUnit: undefined });
  await db.trip.update({ where: { id: earlier.id }, data: { active: false } });
  const today = await register(current.id, { firstName: "Maria" });
  const elsewhere = await register(other.id, { firstName: "Ana" });
  const deleted = await register(current.id, { firstName: "Gone" });
  await db.patient.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const ids = async (q: string) => (await searchPatients({ q })).results.map((r) => r.id).sort();

  it("finds patients across trips, accent- and case-insensitively, skipping deleted ones", async () => {
    await signInAs(doctor);
    expect(await ids(surname.toLowerCase())).toEqual([returning.id, today.id, elsewhere.id].sort());
    expect(await ids(`jose ${surname}`)).toEqual([returning.id]);
    expect(await ids(`JOSÉ ${surname}`)).toEqual([returning.id]);
  });

  it("matches phone digits, date of birth, and patient number", async () => {
    await signInAs(doctor);
    expect(await ids("5555 0142")).toContain(returning.id);
    expect(await ids("09/03/1984")).toContain(returning.id);
    expect(await ids("1984-03-09")).toContain(returning.id);
    const { results } = await searchPatients({ q: surname });
    const label = results.find((r) => r.id === elsewhere.id)!.label;
    expect(await ids(label)).toEqual([elsewhere.id]);
    expect(results.find((r) => r.id === returning.id)).toMatchObject({ trip: { id: earlier.id, active: false } });
  });

  it("treats LIKE wildcards literally", async () => {
    await signInAs(doctor);
    // As LIKE patterns these would match every name ("%a%" contains "a").
    expect(await ids(`${surname} %a`)).toEqual([]);
    expect(await ids(`${surname} _ar_`)).toEqual([]);
    expect(await ids(`${surname} ari`)).toEqual([today.id]);
  });

  it("only shows students the trips they're switched on for", async () => {
    await signInAs(student);
    expect(await ids(surname)).toEqual([today.id]);
    await db.tripMember.updateMany({ where: { userId: student.id }, data: { enabled: false } });
    expect(await ids(surname)).toEqual([]);
    await db.tripMember.updateMany({ where: { userId: student.id }, data: { enabled: true } });
  });

  it("is audited with IDs only, never the search text", async () => {
    await signInAs(doctor);
    await searchPatients({ q: `jose ${surname}` });
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "search.run" }, orderBy: { id: "desc" } });
    expect(entry.details).toMatchObject({ resultCount: 1, patientIds: [returning.id] });
    expect(JSON.stringify(entry.details)).not.toContain(surname);
  });

  it("needs at least 2 characters", async () => {
    await signInAs(doctor);
    await expect(searchPatients({ q: " a " })).rejects.toBeInstanceOf(ValidationError);
  });
});
