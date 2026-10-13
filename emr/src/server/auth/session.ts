import "server-only";
import { cache } from "react";
import type { Role, Specialty } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { AuthError } from "@/server/errors";
import { auth, SESSION_IDLE_MS } from "./auth";
import { clientIp, requestHeaders, userAgent } from "./request";

/** Who is making this request. Passed to assertCan() and audit(). */
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  specialty: Specialty | null;
  sessionId: string;
  ip: string;
  userAgent: string | null;
};

// Only bump the session's last-activity time this often, to avoid a write per click.
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * Every service starts with this. It re-reads the session AND the user from the
 * database on every request, so signing someone out, disabling them, or the
 * idle timeout takes effect on their very next click.
 *
 * Throws AuthError when signed out, expired, idle too long, or not ACTIVE.
 */
export const requireUser = cache(async (): Promise<Actor> => {
  const actor = await loadActor();
  if (!actor) throw new AuthError();
  return actor;
});

/** Like requireUser(), but returns null instead of throwing (for pages that show sign-in state). */
export const getOptionalUser = cache(async (): Promise<Actor | null> => loadActor());

async function loadActor(): Promise<Actor | null> {
  const h = await requestHeaders();
  const result = await auth().api.getSession({ headers: h });
  if (!result) return null;

  // Re-read from our own tables rather than trusting anything Better Auth cached.
  const session = await db.session.findUnique({
    where: { id: result.session.id },
    select: { id: true, userId: true, expiresAt: true, updatedAt: true },
  });
  const now = Date.now();
  if (!session || session.expiresAt.getTime() <= now) return null;

  if (now - session.updatedAt.getTime() > SESSION_IDLE_MS) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, specialty: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    await db.session.deleteMany({ where: { userId: session.userId } });
    return null;
  }

  if (now - session.updatedAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
    await db.session.updateMany({ where: { id: session.id }, data: { updatedAt: new Date(now) } });
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    specialty: user.specialty,
    sessionId: session.id,
    ip: clientIp(h),
    userAgent: userAgent(h),
  };
}
