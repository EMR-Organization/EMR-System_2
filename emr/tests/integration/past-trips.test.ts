import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { roleHas, TRIP_WRITE_PERMISSIONS } from "@/lib/shared/permissions";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { assertCan } from "@/server/rbac";
import * as patients from "@/server/services/patients";
import * as trips from "@/server/services/trips";
import { myPermissions, signIn } from "@/server/services/users";
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

const patientInput = (tripId: string) => ({
  tripId,
  firstName: "Past",
  lastName: "Trip",
  ageValue: 40,
  ageUnit: "YEARS",
  gender: "MALE",
  assignedSpecialty: "PHYSICIAN",
});

describe("past trips are read-only except for admins", () => {
  it("blocks every clinical write for doctors and students, but not reads", async () => {
    const trip = await createTrip();
    const student = await createUser({ role: "STUDENT", specialty: null });
    await db.tripMember.create({ data: { tripId: trip.id, userId: student.id, enabled: true } });
    const doctor = await createUser();

    await signInAs(doctor);
    const { id } = await patients.registerPatient(patientInput(trip.id));
    await db.trip.update({ where: { id: trip.id }, data: { active: false } });

    for (const user of [doctor, student]) {
      await signInAs(user);
      const actor = await requireUser();
      for (const permission of TRIP_WRITE_PERMISSIONS) {
        // Permissions the role never has are refused as plain "forbidden"; the rest because the trip is past.
        await expect(assertCan(actor, permission, { tripId: trip.id }), `${user.role} ${permission}`).rejects.toMatchObject({
          messageKey: roleHas(actor.role, permission) ? "tripClosed" : "forbidden",
        });
      }
      await expect(assertCan(actor, "patient.read", { tripId: trip.id })).resolves.toBeUndefined();
      await expect(patients.getPatient(id)).resolves.toMatchObject({ tripActive: false });
      await expect(vitals.addVitals({ patientId: id, heartRate: 70 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(patients.registerPatient(patientInput(trip.id))).rejects.toBeInstanceOf(ForbiddenError);
      expect(await myPermissions({ tripId: trip.id })).not.toContain("vitals.write");
    }

    // Doctors can still manage students on a past trip (not a clinical record).
    await signInAs(doctor);
    await expect(trips.setStudentEnabled({ tripId: trip.id, userId: student.id, enabled: false })).resolves.toBeUndefined();
  });

  it("admins can still correct a past trip's records", async () => {
    const trip = await createTrip();
    await db.trip.update({ where: { id: trip.id }, data: { active: false } });
    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    const { id } = await patients.registerPatient(patientInput(trip.id));
    await expect(vitals.addVitals({ patientId: id, heartRate: 72 })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("re-opening a trip makes it writable again", async () => {
    const trip = await createTrip();
    await db.trip.update({ where: { id: trip.id }, data: { active: false } });
    await signInAs(await createUser());
    await expect(patients.registerPatient(patientInput(trip.id))).rejects.toBeInstanceOf(ForbiddenError);
    await db.trip.update({ where: { id: trip.id }, data: { active: true } });
    await expect(patients.registerPatient(patientInput(trip.id))).resolves.toMatchObject({ label: expect.stringMatching(/^001_/) });
  });
});
