"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/server/errors";
import { register } from "@/server/services/users";

export async function registerAction(_prev: unknown, form: FormData): Promise<ActionResult<never>> {
  const result = await toActionResult(() =>
    register({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role"),
    }),
  );
  if (!result.ok) return result;
  redirect("/pending?status=REGISTERED");
}
