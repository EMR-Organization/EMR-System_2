import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { exportTrip } from "@/server/services/data";

// Trip export as a file download (doctors and admins; audited).

export async function GET(request: Request, { params }: RouteContext<"/api/trips/[tripId]/export">) {
  const { tripId } = await params;
  const format = new URL(request.url).searchParams.get("format");
  try {
    const file = await exportTrip({ tripId, format });
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        // Patient data: never kept in a shared or disk cache.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return new Response(null, { status: 401 });
    if (err instanceof ValidationError) return new Response(null, { status: 400 });
    if (err instanceof ForbiddenError || err instanceof NotFoundError) return new Response(null, { status: 404 });
    throw err;
  }
}
