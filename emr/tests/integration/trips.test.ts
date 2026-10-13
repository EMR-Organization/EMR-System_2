import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import * as trips from "@/server/services/trips";
import * as users from "@/server/services/users";
import { browser } from "./fake-request";
import { createTrip, createUser } from "./fixtures";

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

async function signInAs(user: { email: string; password: string }) {
  browser.reset();
  await users.signIn({ email: user.email, password: user.password });
}

const uniqueYear = () => 2001 + Math.floor(Math.random() * 99);

describe("trips", () => {
  it("admins create trips with the MM_YYYY code; a second trip that month needs a suffix", async () => {
    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    // A month no earlier run has used (trip codes are unique and the test DB keeps them).
    let month = 1;
    let year = 2000;
    for (;;) {
      year = uniqueYear();
      month = 1 + Math.floor(Math.random() * 12);
      if (!(await db.trip.findUnique({ where: { code: `${String(month).padStart(2, "0")}_${year}` } }))) break;
    }
    const code = `${String(month).padStart(2, "0")}_${year}`;
    const base = { name: "Test trip", location: "Testland", month, year };

    expect(await trips.createTrip(base)).toMatchObject({ code, active: true, patientCount: 0 });
    await expect(trips.createTrip(base)).rejects.toMatchObject({ fieldErrors: { suffix: ["tripCodeTaken"] } });
    const suffix = `S${Math.floor(Math.random() * 1e6)}`;
    expect((await trips.createTrip({ ...base, suffix: suffix.toLowerCase() })).code).toBe(`${code}_${suffix}`);
  });

  it("validates trip input", async () => {
    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    await expect(trips.createTrip({ name: "X", location: "", month: 13, year: 99 })).rejects.toBeInstanceOf(ValidationError);
    await expect(trips.createTrip({ name: "Bad suffix", location: "Here", month: 1, year: 2090, suffix: "../x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only admins create trips or mark them past", async () => {
    const trip = await createTrip();
    await signInAs(await createUser());
    await expect(trips.createTrip({ name: "Doctor trip", location: "Here", month: 1, year: 2091 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(trips.setTripActive({ tripId: trip.id, active: false })).rejects.toBeInstanceOf(ForbiddenError);

    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    await trips.setTripActive({ tripId: trip.id, active: false });
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).active).toBe(false);
  });

  it("students see only trips they're switched on for", async () => {
    const [on, off, other] = await Promise.all([createTrip(), createTrip(), createTrip()]);
    const student = await createUser({ role: "STUDENT", specialty: null });
    await db.tripMember.createMany({
      data: [
        { tripId: on.id, userId: student.id, enabled: true },
        { tripId: off.id, userId: student.id, enabled: false },
      ],
    });
    await signInAs(student);
    expect((await trips.listTrips()).map((t) => t.id)).toEqual([on.id]);
    await expect(trips.getTrip(on.id)).resolves.toMatchObject({ id: on.id });
    await expect(trips.getTrip(off.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(trips.getTrip(other.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("doctors see every trip", async () => {
    const trip = await createTrip();
    await signInAs(await createUser());
    expect((await trips.listTrips()).map((t) => t.id)).toContain(trip.id);
  });
});

describe("student switch", () => {
  it("a doctor switches a student on and off; it takes effect on the student's next request", async () => {
    const trip = await createTrip();
    const student = await createUser({ role: "STUDENT", specialty: null });
    const doctor = await createUser();

    await signInAs(doctor);
    const before = await trips.listMembers(trip.id);
    expect(before.find((m) => m.userId === student.id)).toMatchObject({ enabled: false });
    await trips.setStudentEnabled({ tripId: trip.id, userId: student.id, enabled: true });
    expect((await trips.listMembers(trip.id)).find((m) => m.userId === student.id)).toMatchObject({
      enabled: true,
      enabledByName: doctor.name,
    });

    await signInAs(student);
    await expect(trips.getTrip(trip.id)).resolves.toMatchObject({ id: trip.id });
    const studentJar = browser.cookies();

    await signInAs(doctor);
    await trips.setStudentEnabled({ tripId: trip.id, userId: student.id, enabled: false });

    browser.useCookies(studentJar);
    await expect(trips.getTrip(trip.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await trips.listTrips()).not.toContainEqual(expect.objectContaining({ id: trip.id }));
  });

  it("is audited", async () => {
    const trip = await createTrip();
    const student = await createUser({ role: "STUDENT", specialty: null });
    await signInAs(await createUser());
    await trips.setStudentEnabled({ tripId: trip.id, userId: student.id, enabled: true });
    const entry = await db.auditLog.findFirst({ where: { action: "member.toggle", tripId: trip.id }, orderBy: { id: "desc" } });
    expect(entry).toMatchObject({ entityId: student.id, details: { enabled: true } });
  });

  it("students can't flip switches, even their own", async () => {
    const trip = await createTrip();
    const student = await createUser({ role: "STUDENT", specialty: null });
    await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });
    await signInAs(student);
    await expect(trips.listMembers(trip.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(trips.setStudentEnabled({ tripId: trip.id, userId: student.id, enabled: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only applies to active students", async () => {
    const trip = await createTrip();
    const doctor2 = await createUser();
    const pendingStudent = await createUser({ role: "STUDENT", specialty: null, status: "PENDING" });
    await signInAs(await createUser());
    await expect(trips.setStudentEnabled({ tripId: trip.id, userId: doctor2.id, enabled: true })).rejects.toMatchObject({
      messageKey: "notActiveStudent",
    });
    await expect(trips.setStudentEnabled({ tripId: trip.id, userId: pendingStudent.id, enabled: true })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await trips.listMembers(trip.id)).map((m) => m.userId)).not.toContain(pendingStudent.id);
  });
});

describe("myPermissions", () => {
  it("reflects role and trip switch", async () => {
    const trip = await createTrip();
    const student = await createUser({ role: "STUDENT", specialty: null });
    await signInAs(student);
    expect(await users.myPermissions({ tripId: trip.id })).toEqual([]);
    await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });
    expect(await users.myPermissions({ tripId: trip.id })).toEqual(
      expect.arrayContaining(["patient.register", "patient.read", "vitals.write"]),
    );
    expect(await users.myPermissions({ tripId: trip.id })).not.toContain("diagnosis.write");
  });
});

describe("listUsers", () => {
  it("reports whether an account is locked right now", async () => {
    const locked = await createUser();
    const expired = await createUser();
    await db.user.update({ where: { id: locked.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    await db.user.update({ where: { id: expired.id }, data: { lockedUntil: new Date(Date.now() - 60_000) } });
    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    const list = await users.listUsers();
    expect(list.find((u) => u.id === locked.id)?.locked).toBe(true);
    expect(list.find((u) => u.id === expired.id)?.locked).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/password|token|lockedUntil/);
  });
});
