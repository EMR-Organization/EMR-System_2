"use server";

import { toActionResult, ValidationError, type ActionResult } from "@/server/errors";
import { resetPasswordWithCode } from "@/server/services/users";

export async function resetAction(_prev: unknown, form: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      throw new ValidationError({ confirmPassword: ["mismatch"] });
    }
    await resetPasswordWithCode({ email: form.get("email"), code: form.get("code"), newPassword: form.get("newPassword") });
  });
}
