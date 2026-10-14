import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDay, localDayAsDate } from "@/lib/shared/dates";
import { visitSchema } from "@/lib/shared/schemas/doctor";

// 7:30 pm on 12 Oct in Guatemala (UTC-6) is already 13 Oct in UTC.
const EVENING_IN_GUATEMALA = new Date("2026-10-13T01:30:00Z");
const patientId = "00000000-0000-4000-8000-000000000000";

describe("the clinic's day", () => {
  const tz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "America/Guatemala";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_IN_GUATEMALA);
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = tz;
  });

  it("is the local date, not the UTC one", () => {
    expect(EVENING_IN_GUATEMALA.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect(localDay()).toBe("2026-10-12");
    expect(localDayAsDate()).toEqual(new Date("2026-10-12T00:00:00Z"));
  });

  it("defaults evening visits to today and accepts a follow-up today", () => {
    const visit = visitSchema.parse({ patientId, visitType: "Follow-up", followUpDate: "2026-10-12" });
    expect(visit.date).toEqual(new Date("2026-10-12T00:00:00Z"));
    expect(visit.followUpDate).toEqual(new Date("2026-10-12T00:00:00Z"));
    expect(visitSchema.safeParse({ patientId, visitType: "Follow-up", date: "2026-10-13" }).success).toBe(false);
  });
});
