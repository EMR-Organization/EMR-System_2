import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/shared/safe-next";

describe("safeNextPath", () => {
  it("allows same-site paths", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/trips/1?tab=x")).toBe("/trips/1?tab=x");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, 42]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
