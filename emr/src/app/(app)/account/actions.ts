"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { toActionResult, ValidationError, type ActionResult } from "@/server/errors";
import { changePassword, revokeMySession, signOut } from "@/server/services/users";

export async function changePasswordAction(_prev: unknown, form: FormData): Promise<ActionResult> {
  const result = await toActionResult(async () => {
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      throw new ValidationError({ confirmPassword: ["mismatch"] });
    }
    await changePassword({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") });
  });
  if (result.ok) revalidatePath("/account");
  return result;
}

export async function revokeSessionAction(_prev: unknown, form: FormData): Promise<ActionResult> {
  const result = await toActionResult(() => revokeMySession(form.get("sessionId")));
  if (result.ok) revalidatePath("/account");
  return result;
}

export async function signOutAction(): Promise<void> {
  await toActionResult(() => signOut());
  redirect("/login");
}
