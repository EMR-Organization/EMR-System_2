import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Specialty, UserStatus } from "@/generated/prisma/client";
import { checkPassword } from "@/lib/shared/password-policy";
import {
  changePasswordSchema,
  registerSchema,
  RESET_CODE_ALPHABET,
  RESET_CODE_LENGTH,
  resetWithCodeSchema,
  signInSchema,
} from "@/lib/shared/schemas/auth";
import { audit, auditOnly } from "@/server/audit";
import { auth, SESSION_IDLE_MS } from "@/server/auth/auth";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/server/auth/password";
import { rateLimit } from "@/server/auth/rate-limit";
import { clientIp, requestHeaders } from "@/server/auth/request";
import { requireUser } from "@/server/auth/session";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Accounts and sessions (spec: "Authentication and sessions").
// Public functions (no session needed): register, signIn, resetPasswordWithCode.
// Everything else starts with requireUser().

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const RESET_CODE_TTL_MS = 30 * 60 * 1000;
export const MAX_RESET_CODE_ATTEMPTS = 5;

const CREDENTIAL_PROVIDER = "credential"; // Better Auth's provider ID for email/password

// ------------------------------------------------------------------ helpers

function assertPasswordOk(password: string, email: string, field = "password") {
  const problems = checkPassword(password, email);
  if (problems.length > 0) throw new ValidationError({ [field]: problems });
}

function emailDomainAllowed(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return env().ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/** Prisma's "unique constraint failed" error. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

async function setPassword(tx: Tx, userId: string, password: string) {
  const hashed = await hashPassword(password);
  const updated = await tx.account.updateMany({
    where: { userId, providerId: CREDENTIAL_PROVIDER },
    data: { password: hashed },
  });
  if (updated.count === 0) {
    await tx.account.create({
      data: { userId, accountId: userId, providerId: CREDENTIAL_PROVIDER, password: hashed },
    });
  }
}

// ------------------------------------------------------------------ public

export type RegisterResult = { status: "PENDING" };

/**
 * Self-registration. The account is always PENDING until an admin approves it,
 * and the role can only be DOCTOR or STUDENT. Doctors must use an allowed
 * email domain.
 *
 * If the email is already registered we return the same answer and create
 * nothing, so this form can't be used to find out who has an account.
 */
export async function register(input: unknown): Promise<RegisterResult> {
  const h = await requestHeaders();
  const ip = clientIp(h);
  rateLimit("register", ip);

  const data = parse(registerSchema, input);
  if (data.role === "DOCTOR" && !emailDomainAllowed(data.email)) {
    throw new ValidationError({ email: ["doctorDomain"] });
  }
  assertPasswordOk(data.password, data.email);

  const passwordHash = await hashPassword(data.password); // before the check, so timing is the same either way
  const existing = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) {
    await auditOnly({ userId: existing.id, ip }, { action: "user.register.duplicate", entity: "User", entityId: existing.id });
    return { status: "PENDING" };
  }

  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: data.email, name: data.name, role: data.role, status: "PENDING" },
      });
      await tx.account.create({
        data: { userId: user.id, accountId: user.id, providerId: CREDENTIAL_PROVIDER, password: passwordHash },
      });
      await audit(tx, { userId: user.id, ip }, {
        action: "user.register",
        entity: "User",
        entityId: user.id,
        details: { role: data.role },
      });
    });
  } catch (err) {
    // Someone registered the same email a moment ago: same answer as above.
    if (!isUniqueViolation(err)) throw err;
  }
  return { status: "PENDING" };
}

export type SignInResult = { status: "ACTIVE" } | { status: "PENDING" | "DISABLED" };

/**
 * Email + password sign-in.
 *
 * - Every failure (unknown email, wrong password, locked) throws the same
 *   "Email or password is incorrect" error and takes about the same time.
 * - 5 wrong passwords lock the account for 15 minutes.
 * - Pending/disabled accounts get their status only after a correct password,
 *   and never get a session.
 */
export async function signIn(input: unknown): Promise<SignInResult> {
  const h = await requestHeaders();
  const ip = clientIp(h);
  rateLimit("signIn", ip);

  const { email, password } = parse(signInSchema, input);
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      status: true,
      lockedUntil: true,
      accounts: { where: { providerId: CREDENTIAL_PROVIDER }, select: { password: true } },
    },
  });
  const passwordHash = user?.accounts[0]?.password;

  if (!user || !passwordHash) {
    await burnPasswordCheck(password);
    await auditOnly({ userId: null, ip }, { action: "auth.signin.failed", entity: "User", details: { reason: "unknown" } });
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await burnPasswordCheck(password);
    await auditOnly({ userId: user.id, ip }, { action: "auth.signin.failed", entity: "User", entityId: user.id, details: { reason: "locked" } });
    throw invalidCredentials();
  }

  if (!(await verifyPassword(passwordHash, password))) {
    await recordFailedLogin(user.id, ip);
    throw invalidCredentials();
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

  if (user.status !== "ACTIVE") {
    await auditOnly({ userId: user.id, ip }, { action: "auth.signin.blocked", entity: "User", entityId: user.id, details: { status: user.status } });
    return { status: user.status };
  }

  // Better Auth creates the session row and sets the cookie (via nextCookies()).
  const result = await auth().api.signInEmail({ body: { email, password }, headers: h });
  const session = await db.session.findUnique({ where: { token: result.token }, select: { id: true } });
  await auditOnly({ userId: user.id, ip }, {
    action: "auth.signin",
    entity: "Session",
    entityId: session?.id ?? null,
  });
  return { status: "ACTIVE" };
}

function invalidCredentials() {
  return new ValidationError({ form: ["invalidCredentials"] }, "invalidCredentials");
}

async function recordFailedLogin(userId: string, ip: string) {
  await db.$transaction(async (tx) => {
    const { failedLogins } = await tx.user.update({
      where: { id: userId },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    const locked = failedLogins >= MAX_FAILED_LOGINS;
    if (locked) {
      await tx.user.update({
        where: { id: userId },
        data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
      });
    }
    await audit(tx, { userId, ip }, {
      action: locked ? "auth.lockout" : "auth.signin.failed",
      entity: "User",
      entityId: userId,
      details: { reason: "password", failedLogins },
    });
  });
}

/**
 * Sets a new password with an admin-issued reset code. Signs out every device
 * and clears any lockout. Wrong codes count against the code and the IP.
 */
export async function resetPasswordWithCode(input: unknown): Promise<void> {
  const h = await requestHeaders();
  const ip = clientIp(h);
  rateLimit("resetCode", ip);

  const data = parse(resetWithCodeSchema, input);
  const user = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  const now = new Date();
  const codes = user
    ? await db.resetCode.findMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_RESET_CODE_ATTEMPTS } },
        select: { id: true, codeHash: true },
      })
    : [];

  const presented = Buffer.from(hashResetCode(data.code), "hex");
  const match = codes.find((c) => timingSafeEqual(Buffer.from(c.codeHash, "hex"), presented));

  if (!user || !match) {
    if (codes.length > 0) {
      await db.resetCode.updateMany({ where: { id: { in: codes.map((c) => c.id) } }, data: { attempts: { increment: 1 } } });
    }
    await auditOnly({ userId: user?.id ?? null, ip }, { action: "user.resetCode.failed", entity: "User", entityId: user?.id ?? null });
    throw new ValidationError({ code: ["resetCodeInvalid"] }, "resetCodeInvalid");
  }

  assertPasswordOk(data.newPassword, data.email, "newPassword");

  await db.$transaction(async (tx) => {
    // Claim the code atomically so it can't be used twice in a race.
    const claimed = await tx.resetCode.updateMany({ where: { id: match.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new ValidationError({ code: ["resetCodeInvalid"] }, "resetCodeInvalid");
    await setPassword(tx, user.id, data.newPassword);
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await audit(tx, { userId: user.id, ip }, { action: "user.password.reset", entity: "User", entityId: user.id });
  });
}

// --------------------------------------------------------------- signed in

export type Me = { id: string; name: string; email: string; role: "ADMIN" | "DOCTOR" | "STUDENT"; specialty: Specialty | null };

/** The signed-in user, for showing who you are. */
export async function me(): Promise<Me> {
  const actor = await requireUser();
  return { id: actor.id, name: actor.name, email: actor.email, role: actor.role, specialty: actor.specialty };
}

export async function signOut(): Promise<void> {
  const actor = await requireUser();
  const h = await requestHeaders();
  // Better Auth deletes the session row and clears the cookie. It runs first,
  // while the session still exists, so the cookie is reliably cleared.
  await auth()
    .api.signOut({ headers: h })
    .catch((err: unknown) => console.error("Better Auth signOut failed; removing the session directly", err));
  await db.$transaction(async (tx) => {
    // Safety net in case the call above failed: the session must end regardless.
    await tx.session.deleteMany({ where: { id: actor.sessionId } });
    await audit(tx, actor, { action: "auth.signout", entity: "Session", entityId: actor.sessionId });
  });
}

/** Changes your own password. Other devices are signed out; this one stays signed in. */
export async function changePassword(input: unknown): Promise<void> {
  const actor = await requireUser();
  // Keyed by user: a stolen session can't be used to guess the current password at speed.
  rateLimit("changePassword", actor.id);
  const data = parse(changePasswordSchema, input);
  const account = await db.account.findFirst({
    where: { userId: actor.id, providerId: CREDENTIAL_PROVIDER },
    select: { password: true },
  });
  if (!account?.password || !(await verifyPassword(account.password, data.currentPassword))) {
    throw new ValidationError({ currentPassword: ["wrongPassword"] });
  }
  assertPasswordOk(data.newPassword, actor.email, "newPassword");

  await db.$transaction(async (tx) => {
    await setPassword(tx, actor.id, data.newPassword);
    const { count } = await tx.session.deleteMany({ where: { userId: actor.id, id: { not: actor.sessionId } } });
    await audit(tx, actor, {
      action: "user.password.change",
      entity: "User",
      entityId: actor.id,
      details: { otherSessionsRevoked: count },
    });
  });
}

export type SessionInfo = {
  id: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
};

async function sessionsFor(userId: string, currentSessionId: string | null): Promise<SessionInfo[]> {
  const rows = await db.session.findMany({
    // Only sessions that still work: not past 12 hours, and not idle past 30 minutes.
    where: { userId, expiresAt: { gt: new Date() }, updatedAt: { gt: new Date(Date.now() - SESSION_IDLE_MS) } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, ipAddress: true, userAgent: true },
  });
  return rows.map(({ updatedAt, ...row }) => ({ ...row, lastActiveAt: updatedAt, current: row.id === currentSessionId }));
}

/** Your signed-in devices. Never includes session tokens. */
export async function listMySessions(): Promise<SessionInfo[]> {
  const actor = await requireUser();
  return sessionsFor(actor.id, actor.sessionId);
}

/** Signs out one of your devices. */
export async function revokeMySession(sessionId: unknown): Promise<void> {
  const actor = await requireUser();
  const id = parse(z.uuid(), sessionId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { id, userId: actor.id } });
    if (count === 0) throw new NotFoundError();
    await audit(tx, actor, { action: "session.revoke", entity: "Session", entityId: id });
  });
}

// ------------------------------------------------------------------- admin

export type UserSummary = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "DOCTOR" | "STUDENT";
  specialty: Specialty | null;
  status: UserStatus;
  createdAt: Date;
  approvedAt: Date | null;
  lockedUntil: Date | null;
};

export async function listUsers(filter: unknown = {}): Promise<UserSummary[]> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const { status } = parse(z.object({ status: z.enum(["PENDING", "ACTIVE", "DISABLED"]).optional() }), filter);
  return db.user.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      specialty: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      lockedUntil: true,
    },
  });
}

const approveSchema = z.object({
  userId: z.uuid(),
  specialty: z.enum(["DENTIST", "PHYSICIAN", "PEDIATRICIAN"]).optional(),
});

/** Approves a pending account. Doctors need a specialty. */
export async function approveUser(input: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const { userId, specialty } = parse(approveSchema, input);

  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
    if (!user) throw new NotFoundError();
    if (user.status !== "PENDING") throw new ConflictError("not pending");
    if (user.role === "DOCTOR" && !specialty) throw new ValidationError({ specialty: ["required"] });

    await tx.user.update({
      where: { id: userId },
      data: {
        status: "ACTIVE",
        specialty: user.role === "DOCTOR" ? specialty : null,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "user.approve",
      entity: "User",
      entityId: userId,
      details: { role: user.role, specialty: specialty ?? null },
    });
  });
}

/** Rejects a pending account. The row is kept (disabled) so the audit trail stays readable. */
export async function rejectUser(userId: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const id = parse(z.uuid(), userId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id, status: "PENDING" }, data: { status: "DISABLED" } });
    if (count === 0) throw new ConflictError("not pending");
    await audit(tx, actor, { action: "user.reject", entity: "User", entityId: id });
  });
}

/** Disables an account and signs out all its devices immediately. */
export async function disableUser(userId: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const id = parse(z.uuid(), userId);
  if (id === actor.id) throw new ForbiddenError("cannot disable yourself");

  await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) throw new NotFoundError();
    if (target.role === "ADMIN") await assertAnotherActiveAdmin(tx, id);

    // Read the status after any lock above, so it reflects concurrent changes.
    const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (user.status === "DISABLED") return;

    await tx.user.update({ where: { id }, data: { status: "DISABLED" } });
    const { count } = await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, actor, { action: "user.disable", entity: "User", entityId: id, details: { sessionsRevoked: count } });
  });
}

export async function enableUser(userId: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const id = parse(z.uuid(), userId);
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { status: true, approvedAt: true } });
    if (!user) throw new NotFoundError();
    // A rejected registration was never approved; it has to be approved, not just enabled.
    if (user.status !== "DISABLED" || !user.approvedAt) throw new ConflictError("not disabled");
    await tx.user.update({ where: { id }, data: { status: "ACTIVE", failedLogins: 0, lockedUntil: null } });
    await audit(tx, actor, { action: "user.enable", entity: "User", entityId: id });
  });
}

/**
 * Refuses if exceptUserId is the only active admin. Locks every active admin
 * row first (in id order, so concurrent callers can't deadlock): two admins
 * disabling each other at the same moment then run one after the other, and
 * the second sees the first's change instead of both succeeding.
 */
/** Clears a sign-in lockout (5 wrong passwords) without waiting 15 minutes. */
export async function unlockUser(userId: unknown): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const id = parse(z.uuid(), userId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    if (count === 0) throw new NotFoundError();
    await audit(tx, actor, { action: "user.unlock", entity: "User", entityId: id });
  });
}

async function assertAnotherActiveAdmin(tx: Tx, exceptUserId: string) {
  const active = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User" WHERE "role" = 'ADMIN' AND "status" = 'ACTIVE' ORDER BY "id" FOR UPDATE
  `;
  if (!active.some((admin) => admin.id !== exceptUserId)) throw new ConflictError("last admin");
}

/**
 * Issues a one-time reset code for someone who forgot their password. The admin
 * reads it to them; it works once, for 30 minutes. Only its hash is stored, and
 * any older unused codes for that user stop working.
 */
export async function issueResetCode(userId: unknown): Promise<{ code: string; expiresAt: Date }> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const id = parse(z.uuid(), userId);

  const code = Array.from({ length: RESET_CODE_LENGTH }, () => RESET_CODE_ALPHABET[randomInt(RESET_CODE_ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);

  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError();
    await tx.resetCode.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.resetCode.create({ data: { userId: id, codeHash: hashResetCode(code), expiresAt, issuedById: actor.id } });
    await audit(tx, actor, { action: "user.resetCode.issue", entity: "User", entityId: id });
  });
  return { code, expiresAt };
}

// Keyed with the server secret: a stolen database alone isn't enough to brute-force
// the short codes offline. Codes also expire in 30 minutes and allow 5 guesses.
function hashResetCode(code: string): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`reset-code:${code}`).digest("hex");
}

/** An admin's view of someone's devices. */
export async function listUserSessions(userId: unknown): Promise<SessionInfo[]> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  return sessionsFor(parse(z.uuid(), userId), actor.sessionId);
}

/** Signs a user out everywhere (admin). */
export async function revokeUserSessions(userId: unknown): Promise<{ revoked: number }> {
  const actor = await requireUser();
  await assertCan(actor, "user.manage");
  const id = parse(z.uuid(), userId);
  return db.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, actor, { action: "session.revokeAll", entity: "User", entityId: id, details: { revoked: count } });
    return { revoked: count };
  });
}
