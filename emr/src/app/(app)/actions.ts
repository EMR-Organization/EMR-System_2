"use server";

import { toActionResult, type ActionResult } from "@/server/errors";
import { me } from "@/server/services/users";

/** "Stay signed in": any authenticated request counts as activity. */
export async function touchSessionAction(): Promise<ActionResult> {
  return toActionResult(async () => {
    await me();
  });
}
