import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { MATRIX, PERMISSIONS, type RoleName } from "@/lib/shared/permissions";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { requireUser, type Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { accessibleTripIds, assertCan } from "@/server/rbac";
import { signIn } from "@/server/services/users";
import { browser } from "./fake-request";
import { createTrip, createUser } from "./fixtures";

// The permission-matrix harness: every cell of the spec's table, for a trip the
// student is switched on for, one they're switched off for, and one they're not
// a member of.

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

function actorFor(user: { id: string; name: string; email: string; role: RoleName }): Actor {
  return { ...user, specialty: null, sessionId: crypto.randomUUID(), ip: "test", userAgent: null };
}

describe("permission matrix", async () => {
  const enabledTrip = await createTrip();
  const disabledTrip = await createTrip();
  const otherTrip = await createTrip();
  const student = await createUser({ role: "STUDENT", specialty: null });
  await db.tripMember.createMany({
    data: [
      { tripId: enabledTrip.id, userId: student.id, enabled: true },
      { tripId: disabledTrip.id, userId: student.id, enabled: false },
    ],
  });
  const doctor = await createUser({ role: "DOCTOR" });
  const admin = await createUser({ role: "ADMIN", specialty: null });
  const actors: Record<RoleName, Actor> = {
    STUDENT: actorFor(student),
    DOCTOR: actorFor(doctor),
    ADMIN: actorFor(admin),
  };

  for (const permission of PERMISSIONS) {
    for (const role of ["STUDENT", "DOCTOR", "ADMIN"] as const) {
      const grant = MATRIX[permission][role];
      it(`${role} ${permission}: ${grant}`, async () => {
        const actor = actors[role];
        const check = (tripId?: string) => assertCan(actor, permission, tripId ? { tripId } : {});
        if (grant === "none") {
          for (const tripId of [enabledTrip.id, otherTrip.id, undefined]) {
            await expect(check(tripId)).rejects.toBeInstanceOf(ForbiddenError);
          }
        } else if (grant === "all") {
          for (const tripId of [enabledTrip.id, otherTrip.id, undefined]) await expect(check(tripId)).resolves.toBeUndefined();
        } else {
          await expect(check(enabledTrip.id)).resolves.toBeUndefined();
          await expect(check(disabledTrip.id)).rejects.toBeInstanceOf(ForbiddenError);
          await expect(check(otherTrip.id)).rejects.toBeInstanceOf(ForbiddenError);
          await expect(check()).rejects.toBeInstanceOf(ForbiddenError);
        }
      });
    }
  }

  it("matches the spec's table exactly", () => {
    const studentTrip = PERMISSIONS.filter((p) => MATRIX[p].STUDENT === "trip").sort();
    const doctorAll = PERMISSIONS.filter((p) => MATRIX[p].DOCTOR === "all").sort();
    const adminOnly = PERMISSIONS.filter((p) => MATRIX[p].DOCTOR === "none").sort();
    expect(studentTrip).toEqual(
      ["condition.write", "diabetic.write", "patient.read", "patient.register", "photo.write", "search.crossTrip", "vitals.write"].sort(),
    );
    expect(adminOnly).toEqual(["audit.read", "data.import", "patient.delete", "sync.import", "trip.create", "user.manage"].sort());
    expect(doctorAll).toHaveLength(PERMISSIONS.length - adminOnly.length);
    expect(PERMISSIONS.every((p) => MATRIX[p].ADMIN === "all")).toBe(true);
    expect(PERMISSIONS.every((p) => MATRIX[p].STUDENT !== "all")).toBe(true);
  });

  it("scopes a student's trips to enabled memberships", async () => {
    expect(await accessibleTripIds(actors.STUDENT)).toEqual([enabledTrip.id]);
    expect(await accessibleTripIds(actors.DOCTOR)).toBe("all");
  });
});

describe("switching a student off", () => {
  it("blocks them on their next request, while still signed in", async () => {
    const trip = await createTrip();
    const student = await createUser({ role: "STUDENT", specialty: null });
    await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });

    await signIn({ email: student.email, password: student.password });
    await expect(assertCan(await requireUser(), "patient.read", { tripId: trip.id })).resolves.toBeUndefined();

    await db.tripMember.update({ where: { tripId_userId: { tripId: trip.id, userId: student.id } }, data: { enabled: false } });
    const actor = await requireUser(); // still signed in...
    await expect(assertCan(actor, "patient.read", { tripId: trip.id })).rejects.toBeInstanceOf(ForbiddenError); // ...but sees nothing
  });
});
