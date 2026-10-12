import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { allocatePatientNumber } from "@/server/patient-number";
import { uniqueTripCode } from "./helpers";

afterAll(async () => {
  await db.$disconnect();
});

async function createTrip() {
  return db.trip.create({
    data: { code: uniqueTripCode(), name: "Number test", month: 1, year: 2099, location: "Testland" },
  });
}

describe("allocatePatientNumber", () => {
  it("hands out 1, 2, 3... per trip", async () => {
    const a = await createTrip();
    const b = await createTrip();
    const next = (tripId: string) => db.$transaction((tx) => allocatePatientNumber(tx, tripId));
    expect(await next(a.id)).toBe(1);
    expect(await next(a.id)).toBe(2);
    expect(await next(b.id)).toBe(1);
    expect(await next(a.id)).toBe(3);
  });

  it("never hands out the same number twice under concurrent registrations", async () => {
    const trip = await createTrip();
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => db.$transaction((tx) => allocatePatientNumber(tx, trip.id))),
    );
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("doesn't reuse a number when the registration rolls back", async () => {
    const trip = await createTrip();
    await expect(
      db.$transaction(async (tx) => {
        await allocatePatientNumber(tx, trip.id);
        throw new Error("registration failed");
      }),
    ).rejects.toThrow("registration failed");
    // The rollback undid the increment too, so the next number is still 1 and nothing was skipped or duplicated.
    expect(await db.$transaction((tx) => allocatePatientNumber(tx, trip.id))).toBe(1);
  });

  it("fails for an unknown trip", async () => {
    await expect(db.$transaction((tx) => allocatePatientNumber(tx, randomUUID()))).rejects.toThrow(/not found/);
  });
});
