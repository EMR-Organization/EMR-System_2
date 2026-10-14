"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/server/errors";
import { resolveConflict } from "@/server/services/sync";

export async function resolveConflictAction(conflictId: string, hubVersion: number, fields: string[], _prev: unknown, form: FormData): Promise<ActionResult<never>> {
  const choices = Object.fromEntries(fields.map((f) => [f, form.get(`choice:${f}`) === "incoming" ? "incoming" : "hub"]));
  const result = await toActionResult(() => resolveConflict({ conflictId, hubVersion, choices }));
  if (!result.ok) return result;
  // Redirect from the server: re-rendering this page as "resolved" would unmount the form first.
  revalidatePath("/conflicts");
  redirect("/conflicts?resolved=1");
}
