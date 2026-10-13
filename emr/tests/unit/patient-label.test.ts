import { describe, expect, it } from "vitest";
import { formatPatientLabel, parsePatientLabel, tripCodeFor } from "@/lib/shared/patient-label";

describe("formatPatientLabel", () => {
  it("matches the old app's format", () => {
    expect(formatPatientLabel(1, "05_2026")).toBe("001_05_2026");
    expect(formatPatientLabel(42, "05_2026")).toBe("042_05_2026");
    expect(formatPatientLabel(999, "05_2026")).toBe("999_05_2026");
  });

  it("grows past 999 instead of wrapping", () => {
    expect(formatPatientLabel(1000, "05_2026")).toBe("1000_05_2026");
  });

  it("rejects numbers that can't exist", () => {
    expect(() => formatPatientLabel(0, "05_2026")).toThrow(RangeError);
    expect(() => formatPatientLabel(1.5, "05_2026")).toThrow(RangeError);
  });
});

describe("parsePatientLabel", () => {
  it("round-trips", () => {
    expect(parsePatientLabel(formatPatientLabel(7, "11_2025"))).toEqual({ displayNumber: 7, tripCode: "11_2025" });
    expect(parsePatientLabel(" 012_05_2026_B ")).toEqual({ displayNumber: 12, tripCode: "05_2026_B" });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "1_05_2026", "000_05_2026", "001-05-2026", "abc_05_2026", "001_5_2026"]) {
      expect(parsePatientLabel(bad)).toBeNull();
    }
  });
});

describe("tripCodeFor", () => {
  it("zero-pads the month", () => {
    expect(tripCodeFor(5, 2026)).toBe("05_2026");
    expect(tripCodeFor(12, 2025)).toBe("12_2025");
  });
});
