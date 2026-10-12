"use server";

import { revalidatePath } from "next/cache";
import { toActionResult, type ActionResult } from "@/server/errors";
import { createTrip, setTripActive } from "@/server/services/trips";

export async function createTripAction(_prev: unknown, form: FormData): Promise<ActionResult<{ code: string }>> {
  const result = await toActionResult(async () => {
    const trip = await createTrip({
      name: form.get("name"),
      location: form.get("location"),
      month: form.get("month"),
      year: form.get("year"),
      suffix: form.get("suffix") || undefined,
    });
    return { code: trip.code };
  });
  if (result.ok) revalidatePath("/trips");
  return result;
}

export async function setTripActiveAction(tripId: string, active: boolean): Promise<ActionResult> {
  const result = await toActionResult(() => setTripActive({ tripId, active }));
  if (result.ok) revalidatePath("/trips");
  return result;
}
