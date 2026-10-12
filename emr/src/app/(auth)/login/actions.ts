"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/shared/safe-next";
import { toActionResult, type ActionResult } from "@/server/errors";
import { signIn } from "@/server/services/users";

export async function signInAction(_prev: unknown, form: FormData): Promise<ActionResult<never>> {
  const result = await toActionResult(() => signIn({ email: form.get("email"), password: form.get("password") }));
  if (!result.ok) return result;
  if (result.data.status !== "ACTIVE") redirect(`/pending?status=${result.data.status}`);
  redirect(safeNextPath(form.get("next")));
}
