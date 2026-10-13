import { randomUUID } from "node:crypto";
import type { Role, Specialty, UserStatus } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";

export const GOOD_PASSWORD = "correct horse battery staple";

/** Creates a user with a password directly in the database (bypassing registration). */
export async function createUser(opts: {
  role?: Role;
  status?: UserStatus;
  specialty?: Specialty | null;
  password?: string;
  email?: string;
} = {}) {
  const role = opts.role ?? "DOCTOR";
  const email = opts.email ?? `${role.toLowerCase()}-${randomUUID()}@example.org`;
  const user = await db.user.create({
    data: {
      email,
      name: `Test ${role}`,
      role,
      status: opts.status ?? "ACTIVE",
      specialty: opts.specialty === undefined ? (role === "DOCTOR" ? "PHYSICIAN" : null) : opts.specialty,
      approvedAt: opts.status === "PENDING" ? null : new Date(),
    },
  });
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(opts.password ?? GOOD_PASSWORD),
    },
  });
  return { ...user, password: opts.password ?? GOOD_PASSWORD };
}

export async function createTrip() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  return db.trip.create({
    data: { code: `01_2099_T${suffix}`, name: "Test trip", month: 1, year: 2099, location: "Testland" },
  });
}
