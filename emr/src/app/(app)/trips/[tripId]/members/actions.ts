"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/server/errors";
import { setStudentEnabled } from "@/server/services/trips";

export async function setStudentEnabledAction(tripId: string, userId: string, enabled: boolean): Promise<ActionResult> {
  const result = await toActionResult(() => setStudentEnabled({ tripId, userId, enabled }));
  if (result.ok) revalidatePath(`/trips/${tripId}/members`);
  return result;
}
