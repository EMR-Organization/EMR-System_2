import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AuthError, ForbiddenError, NotFoundError } from "@/server/errors";
import { backupForDownload } from "@/server/services/backups";

// Downloads one encrypted backup (admins only, audited), e.g. to copy it to a
// USB stick from another laptop. The file is useless without BACKUP_KEY.

export async function GET(_request: Request, { params }: RouteContext<"/api/backups/[name]">) {
  const { name } = await params;
  try {
    const file = await backupForDownload(name);
    return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return new Response(null, { status: 401 });
    if (err instanceof ForbiddenError || err instanceof NotFoundError) return new Response(null, { status: 404 });
    throw err;
  }
}
