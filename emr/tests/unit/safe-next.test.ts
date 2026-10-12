import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/shared/safe-next";

describe("safeNextPath", () => {
  it("allows same-site paths", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/trips/1?tab=x#vitals")).toBe("/trips/1?tab=x#vitals");
  });

  it("rejects anything that could leave the site", () => {
    const bad = [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example", // browsers drop the tab -> //evil.example
      "/\n/evil.example",
      "/\r\n/evil.example",
      "/\u0000/evil.example",
      "/%09/evil.example".replace("%09", decodeURIComponent("%09")), // as Next decodes ?next=%09...
      "\\/evil.example",
      "javascript:alert(1)",
      "",
      null,
      42,
    ];
    for (const value of bad) expect(safeNextPath(value), JSON.stringify(value)).toBe("/");
  });
});
