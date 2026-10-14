import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { verifyChain } from "@/server/audit";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ConflictError } from "@/server/errors";
import * as patients from "@/server/services/patients";
import * as vitals from "@/server/services/vitals";
import { signIn } from "@/server/services/users";
import { browser } from "./fake-request";
import { createTrip, createUser } from "./fixtures";

// A busy clinic morning: many devices saving at the same moment. Nothing may be
// lost silently, numbered twice, or break the audit chain.
const N = 20;

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

async function doctorOnTrip() {
  const trip = await createTrip();
  const doctor = await createUser();
  browser.reset();
  await signIn({ email: doctor.email, password: doctor.password });
  return trip;
}

const form = (tripId: string, extra: Record<string, unknown> = {}) => ({
  tripId,
  firstName: "Ana",
  lastName: "Concurrent",
  dateOfBirth: "1990-04-02",
  gender: "FEMALE",
  assignedSpecialty: "PHYSICIAN",
  ...extra,
});

describe(`${N} devices at once`, () => {
  it("editing one patient: exactly one save wins, the rest are told it changed, nothing half-written", async () => {
    const trip = await doctorOnTrip();
    const { id } = await patients.registerPatient(form(trip.id));

    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => patients.updatePatient({ ...form(trip.id), patientId: id, version: 1, phone: `5555-${1000 + i}` })),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(N - 1);
    for (const r of refused) expect(r.reason).toBeInstanceOf(ConflictError);

    const stored = await db.patient.findUniqueOrThrow({ where: { id } });
    expect(stored.version).toBe(2);
    expect(await db.auditLog.count({ where: { action: "patient.update", entityId: id } })).toBe(1);

    // The winner's phone is the one stored.
    const winningPhone = results.findIndex((r) => r.status === "fulfilled");
    expect(stored.phone).toBe(`5555-${1000 + winningPhone}`);
  });

  it("registering patients: every one gets its own number, none skipped, each audited", async () => {
    const trip = await doctorOnTrip();
    const registered = await Promise.all(Array.from({ length: N }, (_, i) => patients.registerPatient(form(trip.id, { firstName: `P${i}` }))));
    const labels = registered.map((r) => r.label).sort();
    expect(labels).toEqual(Array.from({ length: N }, (_, i) => `${String(i + 1).padStart(3, "0")}_${trip.code}`));
    expect(await db.auditLog.count({ where: { action: "patient.create", entityId: { in: registered.map((r) => r.id) } } })).toBe(N);
  });

  it("recording vitals on one patient: all kept, and the audit chain stays intact", async () => {
    const trip = await doctorOnTrip();
    const { id } = await patients.registerPatient(form(trip.id));
    await Promise.all(Array.from({ length: N }, (_, i) => vitals.addVitals({ patientId: id, bpSystolic: String(100 + i), bpDiastolic: "70" })));
    expect(await vitals.listVitals(id)).toHaveLength(N);
    await expect(verifyChain()).resolves.toMatchObject({ ok: true });
  });
});
