"use server";

import { toActionResult } from "@/server/errors";
import { verifyAuditChain } from "@/server/services/audit";

export async function verifyChainAction(_prev: unknown, form: FormData) {
  return toActionResult(() => verifyAuditChain({ checkpointId: form.get("checkpointId"), checkpointHash: form.get("checkpointHash") }));
}
