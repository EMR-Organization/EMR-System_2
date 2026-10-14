import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { latestCheckpoint } from "@/server/audit";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { listAudit, verifyAuditChain } from "@/server/services/audit";
import * as patients from "@/server/services/patients";
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

describe("audit viewer", async () => {
  const trip = await createTrip();
  const doctor = await createUser();
  const admin = await createUser({ role: "ADMIN", specialty: null });
  await signInAs(doctor);
  const patient = await patients.registerPatient({
    tripId: trip.id,
    firstName: "Audit",
    lastName: "Trail",
    gender: "MALE",
    assignedSpecialty: "PHYSICIAN",
    ageValue: 30,
    ageUnit: "YEARS",
  });
  await patients.getPatient(patient.id);

  it("is admin-only", async () => {
    await signInAs(doctor);
    await expect(listAudit({})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(verifyAuditChain({})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters by patient (ID or label), user, and action prefix, and logs the look", async () => {
    await signInAs(admin);
    const { label } = (await patients.listPatients({ tripId: trip.id })).patients[0];
    const byLabel = await listAudit({ patient: label });
    expect(byLabel.rows.map((r) => r.action).sort()).toEqual(["patient.create", "patient.view"]);
    expect(byLabel.rows.every((r) => r.user?.id === doctor.id)).toBe(true);
    // Looking at a patient's trail is itself on that patient's trail.
    expect((await listAudit({ patient: patient.id })).rows.map((r) => r.action)).toEqual(["audit.view", "patient.view", "patient.create"]);
    expect((await listAudit({ patient: "999_01_1999" })).patientNotFound).toBe(true);

    const views = await listAudit({ userId: doctor.id, action: "patient.view" });
    expect(views.rows.map((r) => r.entityId)).toEqual([patient.id]);
    expect((await listAudit({ userId: doctor.id, action: "patient." })).rows).toHaveLength(2);

    const look = await db.auditLog.findFirstOrThrow({ where: { action: "audit.view", userId: admin.id }, orderBy: { id: "desc" } });
    expect(look.details).toMatchObject({ userId: doctor.id, action: "patient." });
  });

  it("pages backwards through the log", async () => {
    await signInAs(admin);
    const first = await listAudit({});
    expect(first.rows).toHaveLength(50);
    const next = await listAudit({ before: first.nextBefore });
    expect(BigInt(next.rows[0].id)).toBeLessThan(BigInt(first.rows[49].id));
  });

  it("verifies the chain, against a checkpoint too, and records the result", async () => {
    await signInAs(admin);
    const checkpoint = (await latestCheckpoint())!;
    await expect(verifyAuditChain({})).resolves.toMatchObject({ ok: true });
    await expect(verifyAuditChain({ checkpointId: checkpoint.id, checkpointHash: checkpoint.hash.toUpperCase() })).resolves.toMatchObject({ ok: true });
    await expect(verifyAuditChain({ checkpointId: checkpoint.id, checkpointHash: "0".repeat(64) })).resolves.toMatchObject({
      ok: false,
      reason: "checkpoint",
    });
    await expect(verifyAuditChain({ checkpointId: checkpoint.id })).rejects.toBeInstanceOf(ValidationError);
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "audit.verify" }, orderBy: { id: "desc" } });
    expect(entry.details).toMatchObject({ ok: false, reason: "checkpoint" });
  });

  it("the audit log can be filtered by camelCase actions", async () => {
    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    await expect(listAudit({ action: "trip.setActive" })).resolves.toBeTruthy();
    await expect(listAudit({ action: "user.resetCode." })).resolves.toBeTruthy();
  });
});
