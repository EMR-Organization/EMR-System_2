import { IMPORT_MAX_BYTES } from "@/lib/shared/schemas/trip-data";
import { toActionResult } from "@/server/errors";
import { isSameOrigin } from "@/server/http";
import { assertCanImportTrip, importTripFile } from "@/server/services/data";

// Trip data import (admins; merge only). A route handler so that only this
// endpoint accepts files this large; server actions keep the 1 MB limit.

const MAX_REQUEST_BYTES = IMPORT_MAX_BYTES + 64 * 1024;

const STATUS = { AUTH: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, RATE_LIMIT: 429, INTERNAL: 500 } as const;

export async function POST(request: Request, { params }: RouteContext<"/api/trips/[tripId]/import">) {
  if (!isSameOrigin(request)) return Response.json({ ok: false, code: "FORBIDDEN", messageKey: "forbidden" }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_REQUEST_BYTES) {
    return Response.json({ ok: false, code: "VALIDATION", messageKey: "validation", fieldErrors: { file: ["importTooLarge"] } }, { status: 413 });
  }

  const { tripId } = await params;
  // Who's asking is checked before the body is read: an unauthenticated device
  // must not be able to make the hub buffer a large upload.
  const allowed = await toActionResult(() => assertCanImportTrip(tripId));
  if (!allowed.ok) return Response.json(allowed, { status: STATUS[allowed.code] });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, code: "VALIDATION", messageKey: "validation", fieldErrors: { file: ["required"] } }, { status: 400 });
  }
  const file = form.get("file");
  const result = await toActionResult(() => importTripFile({ tripId, dryRun: form.get("dryRun") ?? "true" }, file instanceof Blob ? file : null));
  const status = result.ok ? 200 : STATUS[result.code];
  return Response.json(result, { status });
}
