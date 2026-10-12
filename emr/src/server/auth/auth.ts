import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { hashPassword, verifyPassword } from "./password";

// Better Auth handles sessions: creating them at sign-in, the signed cookie,
// and looking them up. Everything else (registration, lockout, status checks,
// audit) is in src/server/services/users.ts, so it happens in our own
// transactions.
//
// There is deliberately NO /api/auth route: Better Auth's HTTP endpoints are
// not mounted, so its sign-up and other endpoints can't be called from outside.
// The server calls auth.api.* directly from services.

export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
export const SESSION_IDLE_MS = 30 * 60 * 1000;

function createAuth() {
  const { BETTER_AUTH_SECRET } = env();
  const secure = process.env.NODE_ENV === "production";

  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // Accounts are created by users.register(), never by Better Auth's sign-up.
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: SESSION_ABSOLUTE_SECONDS,
      // Never extend a session: 12 hours after sign-in it ends, however active.
      // The 30-minute idle timeout is enforced in requireUser().
      disableSessionRefresh: true,
      // Always read the session from the database, so revoking it takes effect immediately.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        role: { type: "string", input: false },
        status: { type: "string", input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Defense in depth: even if a code path forgets the status check,
          // no session is ever created for a pending or disabled account.
          before: async (session) => {
            const user = await db.user.findUnique({ where: { id: session.userId }, select: { status: true } });
            return user?.status === "ACTIVE";
          },
        },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict", secure, path: "/" },
      // Caddy (the only thing that can reach the app in the field) sets this to
      // the real client address and drops any value the client sent.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    // Same-origin only. Next.js also checks Origin on every server action.
    trustedOrigins: async (request) => {
      const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
      const proto = request?.headers.get("x-forwarded-proto") ?? (secure ? "https" : "http");
      return host ? [`${proto}://${host}`] : [];
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Created on first use, so a build without secrets still works. */
export function auth(): Auth {
  instance ??= createAuth();
  return instance;
}
