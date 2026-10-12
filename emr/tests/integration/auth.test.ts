import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { getOptionalUser, requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { AuthError, ForbiddenError, RateLimitError, ValidationError } from "@/server/errors";
import * as users from "@/server/services/users";
import { browser } from "./fake-request";
import { createUser, GOOD_PASSWORD } from "./fixtures";

// requireUser() is wrapped in React's cache(), which only memoizes inside a
// React server request. In tests every call is a fresh lookup, like a new click.

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

async function signInAs(user: { email: string; password: string }) {
  browser.reset();
  const result = await users.signIn({ email: user.email, password: user.password });
  return { result, jar: browser.cookies() };
}

async function expectSignedOut() {
  await expect(requireUser()).rejects.toBeInstanceOf(AuthError);
}

describe("register", () => {
  it("creates a pending account", async () => {
    const email = `new-${crypto.randomUUID()}@example.org`;
    await expect(users.register({ name: "New Doctor", email, password: GOOD_PASSWORD, role: "DOCTOR" })).resolves.toEqual({
      status: "PENDING",
    });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("PENDING");
    expect(user.role).toBe("DOCTOR");
  });

  it("lowercases the email", async () => {
    const local = `Mixed-${crypto.randomUUID()}`;
    await users.register({ name: "Student", email: `${local}@Gmail.com`, password: GOOD_PASSWORD, role: "STUDENT" });
    expect(await db.user.findUnique({ where: { email: `${local.toLowerCase()}@gmail.com` } })).not.toBeNull();
  });

  it("only lets doctors register with an allowed domain", async () => {
    const attempt = users.register({ name: "Dr X", email: `x-${crypto.randomUUID()}@gmail.com`, password: GOOD_PASSWORD, role: "DOCTOR" });
    await expect(attempt).rejects.toMatchObject({ fieldErrors: { email: ["doctorDomain"] } });
  });

  it("never creates admins", async () => {
    const attempt = users.register({ name: "Sneaky", email: `a-${crypto.randomUUID()}@example.org`, password: GOOD_PASSWORD, role: "ADMIN" });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
  });

  it("ignores extra fields like status", async () => {
    const email = `s-${crypto.randomUUID()}@example.org`;
    await users.register({ name: "Student", email, password: GOOD_PASSWORD, role: "STUDENT", status: "ACTIVE" });
    expect((await db.user.findUniqueOrThrow({ where: { email } })).status).toBe("PENDING");
  });

  it("rejects weak passwords", async () => {
    const email = `weak-${crypto.randomUUID()}@example.org`;
    for (const password of ["short", "password1234", "qwertyqwerty!", "aaaaaaaaaaaaaaaa", `${email.split("@")[0]}!!`]) {
      await expect(users.register({ name: "Weak", email, password, role: "STUDENT" })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("gives the same answer for an existing email and changes nothing", async () => {
    const existing = await createUser({ role: "STUDENT" });
    await expect(
      users.register({ name: "Impostor", email: existing.email, password: "another long passphrase", role: "STUDENT" }),
    ).resolves.toEqual({ status: "PENDING" });
    const after = await db.user.findUniqueOrThrow({ where: { email: existing.email } });
    expect(after.name).toBe(existing.name);
    expect(after.status).toBe("ACTIVE");
  });
});

describe("signIn", () => {
  it("creates a session and sets a cookie", async () => {
    const user = await createUser();
    const { result, jar } = await signInAs(user);
    expect(result).toEqual({ status: "ACTIVE" });
    expect([...jar.keys()].some((k) => k.includes("session_token"))).toBe(true);
    const actor = await requireUser();
    expect(actor.id).toBe(user.id);
    expect(actor.ip).toBe("10.0.0.1");
  });

  it("is case-insensitive on email", async () => {
    const user = await createUser();
    await expect(users.signIn({ email: user.email.toUpperCase(), password: user.password })).resolves.toEqual({ status: "ACTIVE" });
  });

  it("uses one message for unknown email and wrong password", async () => {
    const user = await createUser();
    const wrong = users.signIn({ email: user.email, password: "wrong password here" });
    const unknown = users.signIn({ email: `nobody-${crypto.randomUUID()}@example.org`, password: "whatever passw0rd" });
    await expect(wrong).rejects.toMatchObject({ messageKey: "invalidCredentials" });
    await expect(unknown).rejects.toMatchObject({ messageKey: "invalidCredentials" });
  });

  it("tells pending and disabled users their status only after a correct password, with no session", async () => {
    const pending = await createUser({ status: "PENDING" });
    const disabled = await createUser({ status: "DISABLED" });
    await expect(users.signIn({ email: pending.email, password: "wrong password here" })).rejects.toMatchObject({
      messageKey: "invalidCredentials",
    });
    expect(await users.signIn({ email: pending.email, password: pending.password })).toEqual({ status: "PENDING" });
    expect(await users.signIn({ email: disabled.email, password: disabled.password })).toEqual({ status: "DISABLED" });
    expect(await db.session.count({ where: { userId: { in: [pending.id, disabled.id] } } })).toBe(0);
    await expectSignedOut();
  });

  it("locks the account for 15 minutes after 5 wrong passwords", async () => {
    const user = await createUser();
    for (let i = 0; i < users.MAX_FAILED_LOGINS; i++) {
      await expect(users.signIn({ email: user.email, password: `wrong password ${i}` })).rejects.toBeInstanceOf(ValidationError);
    }
    const locked = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    // Even the right password fails while locked, with the same message.
    await expect(users.signIn({ email: user.email, password: user.password })).rejects.toMatchObject({
      messageKey: "invalidCredentials",
    });

    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await expect(users.signIn({ email: user.email, password: user.password })).resolves.toEqual({ status: "ACTIVE" });
  });

  it("rate-limits by IP", async () => {
    browser.setIp("10.9.9.9");
    const email = `nobody-${crypto.randomUUID()}@example.org`;
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      try {
        await users.signIn({ email, password: "wrong password here" });
      } catch (err) {
        if (err instanceof RateLimitError) limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("sessions", () => {
  it("ends after 30 minutes idle", async () => {
    const user = await createUser();
    await signInAs(user);
    const actor = await requireUser();
    await db.session.update({ where: { id: actor.sessionId }, data: { updatedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    await expectSignedOut();
    expect(await db.session.findUnique({ where: { id: actor.sessionId } })).toBeNull();
  });

  it("ends 12 hours after sign-in however active", async () => {
    const user = await createUser();
    await signInAs(user);
    const actor = await requireUser();
    const session = await db.session.findUniqueOrThrow({ where: { id: actor.sessionId } });
    const lifetime = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(lifetime - 12 * 3600 * 1000)).toBeLessThan(5000);

    await db.session.update({ where: { id: actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectSignedOut();
  });

  it("allows several devices at once, each revocable", async () => {
    const user = await createUser();
    const laptop = (await signInAs(user)).jar;
    const tablet = (await signInAs(user)).jar;

    browser.useCookies(laptop);
    const sessions = await users.listMySessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toMatch(/token/i);

    const tabletSession = sessions.find((s) => !s.current)!;
    await users.revokeMySession(tabletSession.id);

    browser.useCookies(tablet);
    await expectSignedOut();
    browser.useCookies(laptop);
    await expect(requireUser()).resolves.toMatchObject({ id: user.id });
  });

  it("can't revoke someone else's session", async () => {
    const victim = await createUser();
    await signInAs(victim);
    const victimSession = (await requireUser()).sessionId;

    await signInAs(await createUser());
    await expect(users.revokeMySession(victimSession)).rejects.toThrow();
    expect(await db.session.findUnique({ where: { id: victimSession } })).not.toBeNull();
  });

  it("sign out removes the session", async () => {
    const user = await createUser();
    const { jar } = await signInAs(user);
    await users.signOut();
    browser.useCookies(jar); // even if the browser kept the old cookie
    await expectSignedOut();
  });

  it("rejects a forged cookie", async () => {
    const user = await createUser();
    const { jar } = await signInAs(user);
    const forged = new Map([...jar].map(([k, v]) => [k, k.includes("session_token") ? `${v.slice(0, -4)}AAAA` : v]));
    browser.useCookies(forged);
    expect(await getOptionalUser()).toBeNull();
  });
});

describe("admin account management", () => {
  it("disabling a user signs them out on their very next request", async () => {
    const admin = await createUser({ role: "ADMIN", specialty: null });
    const doctor = await createUser();
    const doctorJar = (await signInAs(doctor)).jar;

    await signInAs(admin);
    await users.disableUser(doctor.id);

    browser.useCookies(doctorJar);
    await expectSignedOut();
    expect(await db.session.count({ where: { userId: doctor.id } })).toBe(0);
  });

  it("a status change takes effect even if a session row survived", async () => {
    const doctor = await createUser();
    await signInAs(doctor);
    await db.user.update({ where: { id: doctor.id }, data: { status: "DISABLED" } });
    await expectSignedOut();
  });

  it("approves pending accounts; doctors need a specialty", async () => {
    const admin = await createUser({ role: "ADMIN", specialty: null });
    const pendingDoctor = await createUser({ status: "PENDING", specialty: null });
    await signInAs(admin);
    await expect(users.approveUser({ userId: pendingDoctor.id })).rejects.toBeInstanceOf(ValidationError);
    await users.approveUser({ userId: pendingDoctor.id, specialty: "DENTIST" });
    const approved = await db.user.findUniqueOrThrow({ where: { id: pendingDoctor.id } });
    expect(approved).toMatchObject({ status: "ACTIVE", specialty: "DENTIST", approvedById: admin.id });
  });

  it("only admins can manage users", async () => {
    const doctor = await createUser();
    const pending = await createUser({ status: "PENDING", role: "STUDENT" });
    await signInAs(doctor);
    await expect(users.approveUser({ userId: pending.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(users.listUsers()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(users.issueResetCode(pending.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an admin can't disable themselves", async () => {
    const admin = await createUser({ role: "ADMIN", specialty: null });
    await signInAs(admin);
    await expect(users.disableUser(admin.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reset codes", () => {
  async function issueFor(target: { id: string }) {
    const admin = await createUser({ role: "ADMIN", specialty: null });
    await signInAs(admin);
    const { code } = await users.issueResetCode(target.id);
    browser.reset();
    return code;
  }

  it("works once, then the new password works and the old one doesn't", async () => {
    const user = await createUser();
    const otherDevice = (await signInAs(user)).jar;
    const code = await issueFor(user);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const newPassword = "a brand new long passphrase";
    await users.resetPasswordWithCode({ email: user.email, code: code.toLowerCase(), newPassword });
    await expect(users.resetPasswordWithCode({ email: user.email, code, newPassword: "yet another passphrase" })).rejects.toMatchObject({
      messageKey: "resetCodeInvalid",
    });

    await expect(users.signIn({ email: user.email, password: user.password })).rejects.toBeInstanceOf(ValidationError);
    await expect(users.signIn({ email: user.email, password: newPassword })).resolves.toEqual({ status: "ACTIVE" });

    browser.useCookies(otherDevice); // reset signs out every device
    await expectSignedOut();
  });

  it("stores only a hash", async () => {
    const user = await createUser();
    const code = await issueFor(user);
    const row = await db.resetCode.findFirstOrThrow({ where: { userId: user.id, usedAt: null } });
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expires after 30 minutes", async () => {
    const user = await createUser();
    const code = await issueFor(user);
    await db.resetCode.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(users.resetPasswordWithCode({ email: user.email, code, newPassword: "a brand new long passphrase" })).rejects.toMatchObject({
      messageKey: "resetCodeInvalid",
    });
  });

  it("stops working after 5 wrong guesses", async () => {
    const user = await createUser();
    const code = await issueFor(user);
    for (let i = 0; i < users.MAX_RESET_CODE_ATTEMPTS; i++) {
      browser.setIp(`10.1.0.${i}`);
      await expect(
        users.resetPasswordWithCode({ email: user.email, code: "ZZZZZZZZ", newPassword: "a brand new long passphrase" }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(users.resetPasswordWithCode({ email: user.email, code, newPassword: "a brand new long passphrase" })).rejects.toMatchObject({
      messageKey: "resetCodeInvalid",
    });
  });

  it("a newer code replaces older ones", async () => {
    const user = await createUser();
    const first = await issueFor(user);
    await issueFor(user);
    await expect(users.resetPasswordWithCode({ email: user.email, code: first, newPassword: "a brand new long passphrase" })).rejects.toMatchObject({
      messageKey: "resetCodeInvalid",
    });
  });
});

describe("changePassword", () => {
  it("needs the current password and signs out other devices", async () => {
    const user = await createUser();
    const other = (await signInAs(user)).jar;
    const current = (await signInAs(user)).jar;

    await expect(users.changePassword({ currentPassword: "not my password", newPassword: "a brand new long passphrase" })).rejects.toMatchObject({
      fieldErrors: { currentPassword: ["wrongPassword"] },
    });
    await users.changePassword({ currentPassword: user.password, newPassword: "a brand new long passphrase" });

    await expect(requireUser()).resolves.toMatchObject({ id: user.id });
    browser.useCookies(other);
    await expectSignedOut();
    browser.useCookies(current);
  });
});
