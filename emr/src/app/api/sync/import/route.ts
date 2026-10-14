import { SYNC_BUNDLE_MAX_BYTES } from "@/lib/shared/schemas/sync";
import { toActionResult } from "@/server/errors";
import { isSameOrigin } from "@/server/http";
import { importSyncFile } from "@/server/services/sync";

// Fallback bundle import (admins). A route handler so only this endpoint takes
// files this large (bundles carry photos); server actions keep the 1 MB limit.

const MAX_REQUEST_BYTES = SYNC_BUNDLE_MAX_BYTES + 64 * 1024;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ ok: false, code: "FORBIDDEN", messageKey: "forbidden" }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_REQUEST_BYTES) {
    return Response.json({ ok: false, code: "VALIDATION", messageKey: "validation", fieldErrors: { file: ["syncTooLarge"] } }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, code: "VALIDATION", messageKey: "validation", fieldErrors: { file: ["required"] } }, { status: 400 });
  }
  const file = form.get("file");
  const result = await toActionResult(() => importSyncFile({ dryRun: form.get("dryRun") ?? "true" }, file instanceof Blob ? file : null));
  const status = result.ok ? 200 : { AUTH: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, RATE_LIMIT: 429, INTERNAL: 500 }[result.code];
  return Response.json(result, { status });
}
