import { PHOTO_MAX_BYTES } from "@/lib/shared/schemas/doctor";
import { toActionResult } from "@/server/errors";
import { isSameOrigin } from "@/server/http";
import { assertCanUploadPhoto, uploadPhoto } from "@/server/services/photos";

// Photo upload. A route handler rather than a server action so that only this
// endpoint accepts a few megabytes; every server action keeps the 1 MB limit.

const MAX_REQUEST_BYTES = PHOTO_MAX_BYTES + 64 * 1024; // the photo plus the form fields

const STATUS = { AUTH: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, RATE_LIMIT: 429, INTERNAL: 500 } as const;

export async function POST(request: Request, { params }: RouteContext<"/api/patients/[patientId]/photos">) {
  if (!isSameOrigin(request)) return Response.json({ ok: false, code: "FORBIDDEN", messageKey: "forbidden" }, { status: 403 });

  // Refuse oversized bodies before reading them into memory.
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_REQUEST_BYTES) {
    return Response.json({ ok: false, code: "VALIDATION", messageKey: "validation", fieldErrors: { photo: ["photoTooLarge"] } }, { status: 413 });
  }

  const { patientId } = await params;
  // Who's asking is checked before the body is read: an unauthenticated device
  // must not be able to make the hub buffer a large upload.
  const allowed = await toActionResult(() => assertCanUploadPhoto(patientId));
  if (!allowed.ok) return Response.json(allowed, { status: STATUS[allowed.code] });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, code: "VALIDATION", messageKey: "validation", fieldErrors: { photo: ["required"] } }, { status: 400 });
  }
  const file = form.get("photo");
  const field = (k: string) => form.get(k) ?? undefined;

  const result = await toActionResult(() =>
    uploadPhoto(
      {
        patientId,
        kind: field("kind"),
        category: field("category"),
        description: field("description"),
        takenOn: field("takenOn"),
        notes: field("notes"),
      },
      file instanceof Blob ? file : null,
    ),
  );
  const status = result.ok ? 201 : STATUS[result.code];
  return Response.json(result, { status });
}
