import "server-only";
import { z } from "zod";
import { formatPatientLabel } from "@/lib/shared/patient-label";
import { SYNC_BUNDLE_MAX_BYTES, syncBundleSchema } from "@/lib/shared/schemas/sync";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { removePhoto, storePhoto } from "@/server/photo-store";
import { assertCan, can } from "@/server/rbac";
import { SealedFileError, unseal } from "@/server/sealed";
import { contentHash, contentOf, EDITABLE, toColumns, type Content, type SyncEntity } from "@/server/sync/fields";
import { importBundle, type StoredPhotos, type SyncImportSummary } from "@/server/sync/import";
import { parse } from "@/server/validation";

// Admin → Sync (spec: services/sync): import a fallback laptop's bundle, and
// work through the conflict queue field by field.

const SEAL_ERRORS = { notOurs: "syncNotOurs", wrongKind: "syncWrongKind", wrongKey: "syncWrongKey", damaged: "syncDamaged" } as const;

/** Called by the upload route before reading the (up to 200 MB) body. */
export async function assertCanImportSync(): Promise<void> {
  const actor = await requireUser();
  await assertCan(actor, "sync.import");
}

export async function importSyncFile(input: { dryRun: unknown }, file: Blob | null): Promise<SyncImportSummary & { dryRun: boolean }> {
  const actor = await requireUser();
  const { dryRun } = parse(z.object({ dryRun: z.stringbool().default(true) }), input);
  await assertCan(actor, "sync.import");
  if (!file || file.size === 0) throw new ValidationError({ file: ["required"] });
  if (file.size > SYNC_BUNDLE_MAX_BYTES) throw new ValidationError({ file: ["syncTooLarge"] });

  let raw: unknown;
  try {
    raw = JSON.parse(unseal("bundle", Buffer.from(await file.arrayBuffer())).toString("utf8"));
  } catch (err) {
    throw new ValidationError({ file: [err instanceof SealedFileError ? SEAL_ERRORS[err.reason] : "syncInvalid"] });
  }
  const parsed = syncBundleSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError({ file: ["syncInvalid"] });
  const bundle = parsed.data;
  if (bundle.sourceNodeId === env().NODE_ID) throw new ValidationError({ file: ["syncOwnNode"] });

  // Photo files are written before the transaction (like uploads) and removed if it fails.
  const stored: StoredPhotos = new Map();
  if (!dryRun) {
    const here = new Set((await db.photo.findMany({ where: { id: { in: bundle.records.photos.map((p) => p.id) } }, select: { id: true } })).map((p) => p.id));
    for (const ph of bundle.records.photos) {
      if (here.has(ph.id)) continue;
      const file = await storePhoto(Buffer.from(ph.data, "base64")).catch(() => null);
      if (file) stored.set(ph.id, file);
    }
  }
  const cleanUp = async (keep: Set<string>) => {
    for (const [, f] of stored) if (!keep.has(f.fileName)) await removePhoto(f.fileName);
  };

  try {
    const summary = await db.$transaction(
      async (tx) => {
        const result = await importBundle(tx, bundle, actor, dryRun ? "dryRun" : stored);
        if (dryRun) throw new DryRun(result);
        return result;
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    const used = new Set((await db.photo.findMany({ where: { filePath: { in: [...stored.values()].map((f) => f.fileName) } }, select: { filePath: true } })).map((p) => p.filePath));
    await cleanUp(used);
    return { ...summary, dryRun: false };
  } catch (err) {
    await cleanUp(new Set());
    if (err instanceof DryRun) return { ...err.summary, dryRun: true };
    throw err;
  }
}

class DryRun extends Error {
  constructor(readonly summary: SyncImportSummary) {
    super("dry run");
  }
}

/** Fallback laptops the hub has imported from. */
export async function listSyncNodes(): Promise<{ nodeId: string; lastImportAt: Date | null; imports: number }[]> {
  const actor = await requireUser();
  await assertCan(actor, "sync.import");
  return db.syncNode.findMany({ orderBy: { lastImportAt: "desc" }, select: { nodeId: true, lastImportAt: true, imports: true } });
}

/**
 * Fields a resolver may only take from the laptop with a further permission:
 * whether a patient is deleted is an admin decision (patient.delete), whichever
 * way it goes, so a conflict can't be used to delete or bring back a patient.
 */
const GUARDED_FIELDS: Partial<Record<SyncEntity, Record<string, "patient.delete">>> = { Patient: { deleted: "patient.delete" } };

async function lockedFields(actor: Awaited<ReturnType<typeof requireUser>>, entity: SyncEntity, tripId: string, client?: Tx): Promise<string[]> {
  const locked: string[] = [];
  for (const [field, permission] of Object.entries(GUARDED_FIELDS[entity] ?? {})) {
    if (!(await can(actor, permission, { tripId, client }))) locked.push(field);
  }
  return locked;
}

export type ConflictListItem = { id: string; entity: SyncEntity; sourceNodeId: string; createdAt: Date; patient: { id: string; label: string; name: string } | null; fields: string[] };

/**
 * Open conflicts, oldest first, with which fields differ. Only the ones this
 * person may resolve: a past trip's conflicts are for admins (past trips are
 * read-only for everyone else).
 */
export async function listConflicts(): Promise<ConflictListItem[]> {
  const actor = await requireUser();
  await assertCan(actor, "sync.resolve");
  const conflicts = await db.syncConflict.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 500 });
  const out: ConflictListItem[] = [];
  for (const c of conflicts) {
    const view = await conflictView(c.entity as SyncEntity, c.entityId, c.incoming as Content);
    if (view && !(await can(actor, "sync.resolve", { tripId: view.tripId }))) continue;
    out.push({ id: c.id, entity: c.entity as SyncEntity, sourceNodeId: c.sourceNodeId, createdAt: c.createdAt, patient: view?.patient ?? null, fields: view?.differing ?? [] });
  }
  return out;
}

/** One conflict: the hub's current value and the laptop's, for every field that differs. */
export async function getConflict(conflictId: unknown) {
  const actor = await requireUser();
  const id = parse(z.uuid(), conflictId);
  await assertCan(actor, "sync.resolve");
  const c = await db.syncConflict.findUnique({ where: { id } });
  if (!c) throw new NotFoundError();
  const view = await conflictView(c.entity as SyncEntity, c.entityId, c.incoming as Content);
  if (!view) throw new NotFoundError();
  // Doctors can read past trips, so they may look; resolving one is for admins.
  await assertCan(actor, "patient.read", { tripId: view.tripId });
  return {
    canResolve: await can(actor, "sync.resolve", { tripId: view.tripId }),
    /** Fields this person can only keep as the hub has them (see GUARDED_FIELDS). */
    lockedFields: await lockedFields(actor, c.entity as SyncEntity, view.tripId),
    id: c.id,
    entity: c.entity as SyncEntity,
    status: c.status,
    sourceNodeId: c.sourceNodeId,
    createdAt: c.createdAt,
    hubVersion: view.version,
    patient: view.patient,
    fields: view.differing.map((field) => ({ field, hub: view.hub[field], incoming: (c.incoming as Content)[field] ?? null })),
  };
}

const resolveSchema = z.object({
  conflictId: z.uuid(),
  /** The hub version shown on the screen: if someone saved since, the choice is refused. */
  hubVersion: z.coerce.number().int().min(1),
  choices: z.record(z.string(), z.enum(["hub", "incoming"])),
});

/**
 * Applies a doctor's or admin's pick for each differing field. Fields kept from the hub
 * stay as they are; the record is updated (version + 1) only if something
 * from the laptop was chosen. Either way the laptop's version is remembered,
 * so importing the same bundle again doesn't raise the same conflict.
 */
export async function resolveConflict(input: unknown): Promise<{ status: "KEPT_HUB" | "TOOK_INCOMING" }> {
  const actor = await requireUser();
  const { conflictId, hubVersion, choices } = parse(resolveSchema, input);
  await assertCan(actor, "sync.resolve");

  return db.$transaction(async (tx) => {
    const c = await tx.syncConflict.findUnique({ where: { id: conflictId } });
    if (!c) throw new NotFoundError();
    if (c.status !== "OPEN") throw new ConflictError("already resolved", "syncResolved");
    const entity = c.entity as SyncEntity;
    const row = await findRow(tx, entity, c.entityId);
    if (!row) throw new NotFoundError();
    // The record's own trip decides: past trips are admin-only.
    await assertCan(actor, "sync.resolve", { tripId: row.tripId, client: tx });
    if (row.version !== hubVersion) throw new ConflictError("hub changed", "syncChanged");

    const hub = contentOf(entity, row);
    const incoming = c.incoming as Content;
    for (const field of await lockedFields(actor, entity, row.tripId, tx)) {
      const differs = JSON.stringify(hub[field]) !== JSON.stringify(incoming[field] ?? null);
      if (differs && choices[field] === "incoming") throw new ForbiddenError(`${actor.role} can't take ${entity}.${field} from a laptop`, "syncAdminField");
    }
    const merged: Content = {};
    const taken: string[] = [];
    const kept: string[] = [];
    for (const field of EDITABLE[entity]) {
      const differs = JSON.stringify(hub[field]) !== JSON.stringify(incoming[field] ?? null);
      if (differs && choices[field] === "incoming") {
        merged[field] = incoming[field] ?? null;
        taken.push(field);
      } else {
        merged[field] = hub[field];
        if (differs) kept.push(field);
      }
    }
    if (taken.length > 0) {
      const data = { ...toColumns(entity, merged, row), version: { increment: 1 }, updatedById: actor.id };
      const where = { id: row.id, version: hubVersion };
      const { count } =
        entity === "Patient"
          ? await tx.patient.updateMany({ where, data })
          : entity === "Visit"
            ? await tx.visit.updateMany({ where, data })
            : await tx.medication.updateMany({ where, data });
      if (count === 0) throw new ConflictError("hub changed", "syncChanged");
    }
    const prior = await tx.syncRecord.findUnique({ where: { entity_entityId_sourceNodeId: { entity, entityId: row.id, sourceNodeId: c.sourceNodeId } } });
    await tx.syncRecord.upsert({
      where: { entity_entityId_sourceNodeId: { entity, entityId: row.id, sourceNodeId: c.sourceNodeId } },
      create: { entity, entityId: row.id, sourceNodeId: c.sourceNodeId, version: prior?.version ?? 1, contentHash: c.incomingHash },
      update: { contentHash: c.incomingHash },
    });
    const status = taken.length > 0 ? "TOOK_INCOMING" : "KEPT_HUB";
    await tx.syncConflict.update({ where: { id: c.id }, data: { status, resolvedById: actor.id, resolvedAt: new Date() } });
    await audit(tx, actor, {
      action: "sync.resolve",
      entity,
      entityId: row.id,
      tripId: row.tripId,
      details: { conflictId: c.id, fromNode: c.sourceNodeId, tookFromLaptop: taken, keptFromHub: kept, ...(entity === "Patient" ? {} : { patientId: row.patientId }) },
    });
    return { status };
  });
}

type Row = Record<string, unknown> & { id: string; version: number; deletedAt?: Date | null; tripId: string; patientId: string };

async function findRow(client: Pick<typeof db, "patient" | "visit" | "medication">, entity: SyncEntity, id: string): Promise<Row | null> {
  if (entity === "Patient") {
    const p = await client.patient.findUnique({ where: { id } });
    return p ? { ...p, patientId: p.id } : null;
  }
  const r = entity === "Visit" ? await client.visit.findUnique({ where: { id }, include: { patient: { select: { tripId: true } } } }) : await client.medication.findUnique({ where: { id }, include: { patient: { select: { tripId: true } } } });
  return r ? { ...r, tripId: r.patient.tripId } : null;
}

async function conflictView(entity: SyncEntity, id: string, incoming: Content) {
  const row = await findRow(db, entity, id);
  if (!row) return null;
  const hub = contentOf(entity, row);
  const patient = await db.patient.findUnique({ where: { id: row.patientId }, select: { id: true, displayNumber: true, firstName: true, lastName: true, trip: { select: { code: true } } } });
  return {
    tripId: row.tripId,
    version: row.version,
    hub,
    hubHash: contentHash(hub),
    differing: EDITABLE[entity].filter((f) => JSON.stringify(hub[f]) !== JSON.stringify(incoming[f] ?? null)),
    patient: patient ? { id: patient.id, label: formatPatientLabel(patient.displayNumber, patient.trip.code), name: `${patient.lastName}, ${patient.firstName}` } : null,
  };
}
