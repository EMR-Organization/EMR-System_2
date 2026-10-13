import { describe, expect, it } from "vitest";
import { checkPassword } from "@/lib/shared/password-policy";

describe("checkPassword", () => {
  it("accepts long passphrases", () => {
    expect(checkPassword("correct horse battery staple", "ana@example.org")).toEqual([]);
    expect(checkPassword("Volcán de Agua 2026!", "ana@example.org")).toEqual([]);
  });

  it("enforces 12-128 characters", () => {
    expect(checkPassword("Short1!", "")).toContain("tooShort");
    expect(checkPassword("x".repeat(60) + "abcdefghij".repeat(7), "")).toContain("tooLong");
  });

  it("counts characters, not bytes", () => {
    expect(checkPassword("ñandúñandú12", "")).not.toContain("tooShort");
  });

  it("rejects common passwords and common words with digits", () => {
    for (const pw of ["password1234", "Password123!", "qwertyuiop12", "iloveyou2026!!", "Guatemala2026!", "humanityfirst1", "QwertyQwerty"]) {
      expect(checkPassword(pw, ""), pw).toContain("common");
    }
  });

  it("rejects passwords containing the email name", () => {
    expect(checkPassword("maria.lopez-is-great", "maria.lopez@example.org")).toContain("containsEmail");
    expect(checkPassword("lopez and some words", "maria.lopez@example.org")).toContain("containsEmail");
  });

  it("rejects repetitive passwords", () => {
    expect(checkPassword("aaaaaaaaaaaaaa", "")).toContain("tooSimple");
    expect(checkPassword("121212121212", "")).toContain("tooSimple");
  });
});
