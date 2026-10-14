import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { resetRateLimits } from "@/server/auth/rate-limit";
import { getOptionalUser, requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { AuthError, ConflictError, ForbiddenError, RateLimitError, ValidationError } from "@/server/errors";
import * as users from "@/server/services/users";
import { browser } from "./fake-request";
import { createUser, GOOD_PASSWORD } from "./fixtures";
import { appClient } from "./helpers";

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

  it("parallel guesses still get only 5 password checks before the lock", async () => {
    const user = await createUser();
    const guesses = Array.from({ length: 12 }, (_, i) => users.signIn({ email: user.email, password: `parallel guess ${i}` }));
    const results = await Promise.allSettled(guesses);
    expect(results.every((r) => r.status === "rejected")).toBe(true);

    const entries = await db.auditLog.findMany({ where: { entityId: user.id, action: { in: ["auth.signin.failed", "auth.lockout"] } } });
    const checked = entries.filter((e) => (e.details as { reason?: string }).reason === "password");
    expect(checked).toHaveLength(users.MAX_FAILED_LOGINS);
    expect(entries.filter((e) => e.action === "auth.lockout")).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("a sign-in interrupted after its attempt was counted can't leave the account stuck", async () => {
    const user = await createUser();
    // As if the hub crashed after counting a 5th attempt, before checking the password.
    await db.$executeRaw`UPDATE "User" SET "failedLogins" = 5, "lockedUntil" = now() + interval '15 minutes' WHERE id = ${user.id}`;
    await expect(users.signIn({ email: user.email, password: user.password })).rejects.toMatchObject({ messageKey: "invalidCredentials" });
    // The lock is a real one with an end time, so admins see "Locked" and can unlock it.
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Once the lock runs out, the count starts again and the right password works.
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await expect(users.signIn({ email: user.email, password: user.password })).resolves.toEqual({ status: "ACTIVE" });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLogins: 0, lockedUntil: null });
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

describe("review fixes", () => {
  it("two admins disabling each other at once can't leave zero admins", async () => {
    // Make A and B the only active admins for this test (other tests create admins too).
    const others = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "DISABLED" } });
    const other = await appClient();
    try {
      const a = await createUser({ role: "ADMIN", specialty: null });
      const b = await createUser({ role: "ADMIN", specialty: null });
      await signInAs(a);

      // Admin B is halfway through disabling A in another connection: it has
      // taken the admin locks and updated A, but not committed yet.
      await other.query("BEGIN");
      await other.query(`SELECT "id" FROM "User" WHERE "role" = 'ADMIN' AND "status" = 'ACTIVE' ORDER BY "id" FOR UPDATE`);
      await other.query(`UPDATE "User" SET "status" = 'DISABLED' WHERE "id" = $1`, [a.id]);

      // Meanwhile A disables B. It must wait for B's transaction, then see that B is the last admin.
      const disableB = users.disableUser(b.id);
      const outcome = disableB.then(
        () => "done",
        (err: unknown) => err,
      );
      await new Promise((r) => setTimeout(r, 300));
      await other.query("COMMIT");

      expect(await outcome).toBeInstanceOf(ConflictError);
      expect(await db.user.count({ where: { id: { in: [a.id, b.id] }, status: "ACTIVE" } })).toBe(1);
    } finally {
      await other.query("ROLLBACK").catch(() => undefined);
      await other.end();
      await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "ACTIVE" } });
    }
  });

  it("an admin can unlock a locked account; a doctor can't", async () => {
    const locked = await createUser();
    await db.user.update({ where: { id: locked.id }, data: { lockedUntil: new Date(Date.now() + 10 * 60 * 1000), failedLogins: 0 } });

    await signInAs(await createUser());
    await expect(users.unlockUser(locked.id)).rejects.toBeInstanceOf(ForbiddenError);

    await signInAs(await createUser({ role: "ADMIN", specialty: null }));
    await users.unlockUser(locked.id);

    browser.reset();
    await expect(users.signIn({ email: locked.email, password: locked.password })).resolves.toEqual({ status: "ACTIVE" });
  });

  it("the devices list leaves out sessions that have timed out from idling", async () => {
    const user = await createUser();
    const stale = (await signInAs(user)).jar;
    browser.useCookies(stale);
    const staleId = (await requireUser()).sessionId;
    await signInAs(user);
    await db.session.update({ where: { id: staleId }, data: { updatedAt: new Date(Date.now() - 31 * 60 * 1000) } });

    const sessions = await users.listMySessions();
    expect(sessions.map((s) => s.id)).not.toContain(staleId);
    expect(sessions).toHaveLength(1);
  });

  it("limits password-change attempts per user", async () => {
    await signInAs(await createUser());
    for (let i = 0; i < 5; i++) {
      await expect(users.changePassword({ currentPassword: `wrong guess ${i}`, newPassword: "a brand new long passphrase" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(users.changePassword({ currentPassword: "another guess", newPassword: "a brand new long passphrase" })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("two simultaneous registrations with one email both get the normal answer", async () => {
    const email = `race-${crypto.randomUUID()}@example.org`;
    const form = { name: "Race", email, password: GOOD_PASSWORD, role: "STUDENT" };
    await expect(Promise.all([users.register(form), users.register(form)])).resolves.toEqual([{ status: "PENDING" }, { status: "PENDING" }]);
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("signing out clears the cookie as well as the session", async () => {
    await signInAs(await createUser());
    await users.signOut();
    expect([...browser.cookies().keys()].some((k) => k.includes("session_token"))).toBe(false);
  });
});
