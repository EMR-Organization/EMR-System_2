import { AuthError, ForbiddenError, NotFoundError } from "@/server/errors";
import { getPhoto } from "@/server/services/photos";

// Serves one photo after getPhoto() checks access and audits the view.
// Forbidden and missing look the same (404), as on pages.

export async function GET(_request: Request, { params }: RouteContext<"/api/photos/[photoId]">) {
  const { photoId } = await params;
  try {
    const { bytes, mimeType } = await getPhoto(photoId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.length),
        // Patient images must never sit in a shared or disk cache.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return new Response(null, { status: 401 });
    if (err instanceof ForbiddenError || err instanceof NotFoundError) return new Response(null, { status: 404 });
    throw err;
  }
}
