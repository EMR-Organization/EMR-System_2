"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/server/errors";
import {
  approveUser,
  disableUser,
  enableUser,
  issueResetCode,
  rejectUser,
  revokeUserSessions,
  unlockUser,
} from "@/server/services/users";

// Thin wrappers: each service checks user.manage itself.

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  const result = await toActionResult(fn);
  if (result.ok) revalidatePath("/admin/users");
  return result;
}

export async function approveAction(userId: string, specialty: string | null) {
  return run(() => approveUser({ userId, specialty: specialty || undefined }));
}
export async function rejectAction(userId: string) {
  return run(() => rejectUser(userId));
}
export async function disableAction(userId: string) {
  return run(() => disableUser(userId));
}
export async function enableAction(userId: string) {
  return run(() => enableUser(userId));
}
export async function unlockAction(userId: string) {
  return run(() => unlockUser(userId));
}
export async function revokeAllAction(userId: string) {
  return run(() => revokeUserSessions(userId));
}
/** The plain code is returned once, to be read aloud; only its hash is stored. */
export async function issueResetCodeAction(userId: string): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  const result = await toActionResult(() => issueResetCode(userId));
  return result.ok ? { ok: true, data: { code: result.data.code, expiresAt: result.data.expiresAt.toISOString() } } : result;
}
