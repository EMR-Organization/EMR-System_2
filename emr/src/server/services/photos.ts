import "server-only";
import { z } from "zod";
import { PHOTO_MAX_BYTES, photoMetaSchema } from "@/lib/shared/schemas/doctor";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { NotFoundError, ValidationError } from "@/server/errors";
import { patientForAccess } from "@/server/patient-access";
import { readPhoto, removePhoto, storePhoto } from "@/server/photo-store";
import { parse } from "@/server/validation";

// Patient photos (spec: services/photos). Uploads arrive through the route
// handler at /api/patients/[id]/photos and are served only by
// /api/photos/[id], which calls getPhoto: permission-checked and audited.

export async function uploadPhoto(meta: unknown, file: Blob | null): Promise<{ id: string }> {
  const actor = await requireUser();
  const data = parse(photoMetaSchema, meta);
  if (!file || file.size === 0) throw new ValidationError({ photo: ["required"] });
  if (file.size > PHOTO_MAX_BYTES) throw new ValidationError({ photo: ["photoTooLarge"] });

  // Check access before doing any image work.
  await patientForAccess(actor, data.patientId, "photo.write");
  const stored = await storePhoto(new Uint8Array(await file.arrayBuffer()));

  try {
    return await db.$transaction(async (tx) => {
      const { tripId } = await patientForAccess(actor, data.patientId, "photo.write", tx);
      const row = await tx.photo.create({
        data: {
          ...data,
          filePath: stored.fileName,
          mimeType: "image/jpeg",
          sizeBytes: stored.sizeBytes,
          originNodeId: env().NODE_ID,
          createdById: actor.id,
        },
        select: { id: true },
      });
      await audit(tx, actor, {
        action: "photo.create",
        entity: "Photo",
        entityId: row.id,
        tripId,
        details: { patientId: data.patientId, kind: data.kind },
      });
      return row;
    });
  } catch (err) {
    await removePhoto(stored.fileName);
    throw err;
  }
}

/** One photo's bytes. Every view is audited. */
export async function getPhoto(photoId: unknown): Promise<{ bytes: Buffer; mimeType: string }> {
  const actor = await requireUser();
  const id = parse(z.uuid(), photoId);
  return db.$transaction(async (tx) => {
    const photo = await tx.photo.findUnique({ where: { id }, select: { patientId: true, filePath: true, mimeType: true } });
    if (!photo) throw new NotFoundError();
    const { tripId } = await patientForAccess(actor, photo.patientId, "patient.read", tx);
    const bytes = await readPhoto(photo.filePath).catch(() => {
      throw new NotFoundError("photo file missing");
    });
    await audit(tx, actor, { action: "photo.view", entity: "Photo", entityId: id, tripId, details: { patientId: photo.patientId } });
    return { bytes, mimeType: photo.mimeType };
  });
}

/** Photo details (no bytes) for the Photos tab, newest first. */
export async function listPhotos(patientId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), patientId);
  await patientForAccess(actor, id, "patient.read");
  return db.photo.findMany({
    where: { patientId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, category: true, description: true, notes: true, takenOn: true, createdAt: true },
  });
}
