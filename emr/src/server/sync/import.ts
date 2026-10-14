import "server-only";
import { omit } from "@/lib/shared/omit";
import { formatPatientLabel } from "@/lib/shared/patient-label";
import type { SyncBundle } from "@/lib/shared/schemas/sync";
import { appendForeignEntry, audit, type AuditSubject } from "@/server/audit";
import type { Tx } from "@/server/db";
import { allocatePatientNumber } from "@/server/patient-number";
import { contentHash, contentOf, toColumns, type SyncEntity } from "@/server/sync/fields";

// Merging a fallback laptop's bundle into the hub (spec: "Import"):
// - New records are inserted as they are (UUIDs can't collide). New patients
//   get the hub's next number; the fallback's label stays on them as an alias.
// - A record the hub already has is compared by content with what the hub
//   last accepted from that laptop (SyncRecord):
//     same as the hub's copy         -> nothing to do
//     hub unchanged since last sync  -> the fallback's edit is applied
//     fallback unchanged since then  -> the hub's newer copy stays
//     both changed                   -> queued in SyncConflict for an admin
// - The laptop's audit entries are appended to the hub's chain, each once.
// Importing the same bundle again changes nothing.

export type SyncImportSummary = {
  sourceNodeId: string;
  tripsCreated: string[];
  patientsAdded: number;
  renumbered: { from: string; to: string }[];
  recordsAdded: { conditions: number; vitals: number; diabetic: number; visits: number; medications: number; photos: number };
  /** Edits made only on the fallback, applied to the hub's copy. */
  applied: number;
  /** Edited on both sides: waiting in the conflict queue. */
  conflicts: number;
  alreadyHere: number;
  auditAppended: number;
  skipped: string[];
};

export type StoredPhotos = Map<string, { fileName: string; sizeBytes: number }>;

const chunks = <T>(items: T[], size = 5000): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export async function importBundle(tx: Tx, bundle: SyncBundle, subject: AuditSubject, photos: StoredPhotos | "dryRun"): Promise<SyncImportSummary> {
  const node = bundle.sourceNodeId;
  const summary: SyncImportSummary = {
    sourceNodeId: node,
    tripsCreated: [],
    patientsAdded: 0,
    renumbered: [],
    recordsAdded: { conditions: 0, vitals: 0, diabetic: 0, visits: 0, medications: 0, photos: 0 },
    applied: 0,
    conflicts: 0,
    alreadyHere: 0,
    auditAppended: 0,
    skipped: [],
  };
  const touched = new Map<string, { created: boolean; tripId: string; records: string[] }>();
  const touch = (patientId: string, tripId: string, recordId?: string, created = false) => {
    const t = touched.get(patientId) ?? { created, tripId, records: [] };
    if (recordId) t.records.push(recordId);
    touched.set(patientId, t);
  };

  // 1. Trips: the hub's, or created from the bundle (as past trips) if it has none with that ID.
  const tripCode = new Map<string, string>();
  for (const t of bundle.trips) {
    const byId = await tx.trip.findUnique({ where: { id: t.id }, select: { code: true } });
    if (byId) {
      tripCode.set(t.id, byId.code);
      continue;
    }
    if (await tx.trip.findUnique({ where: { code: t.code }, select: { id: true } })) {
      summary.skipped.push(`trip ${t.code}: the hub has a different trip with this code; its patients were left out`);
      continue;
    }
    await tx.trip.create({ data: { ...t, active: false } });
    tripCode.set(t.id, t.code);
    summary.tripsCreated.push(t.code);
    await audit(tx, subject, { action: "trip.create", entity: "Trip", entityId: t.id, tripId: t.id, details: { code: t.code, fromNode: node } });
  }

  // 2. Patients.
  const patientTrip = new Map<string, string>(); // patients we can place -> their hub trip
  for (const part of chunks(bundle.records.patients)) {
    const existing = new Map((await tx.patient.findMany({ where: { id: { in: part.map((p) => p.id) } } })).map((p) => [p.id, p]));
    for (const p of part) {
      const hub = existing.get(p.id);
      if (hub) {
        if (hub.tripId !== p.tripId) {
          summary.skipped.push(`patient ${p.id}: on a different trip here`);
          continue;
        }
        patientTrip.set(p.id, hub.tripId);
        await reconcile(tx, subject, "Patient", hub, p, node, summary, () => touch(p.id, hub.tripId));
        continue;
      }
      const code = tripCode.get(p.tripId);
      if (!code) continue; // its trip was skipped above
      const displayNumber = await allocatePatientNumber(tx, p.tripId);
      const alias = formatPatientLabel(p.displayNumber, code);
      await tx.patient.create({
        data: {
          ...omit(p, "deleted", "version", "originLabel", "displayNumber"),
          displayNumber,
          originLabel: alias,
          dateOfBirth: p.dateOfBirth ? new Date(`${p.dateOfBirth}T00:00:00Z`) : null,
          deletedAt: p.deleted ? new Date() : null,
          createdAt: new Date(p.createdAt),
        },
      });
      await remember(tx, "Patient", p.id, node, p.version, contentHash(contentOf("Patient", p)));
      patientTrip.set(p.id, p.tripId);
      summary.patientsAdded++;
      summary.renumbered.push({ from: alias, to: formatPatientLabel(displayNumber, code) });
      touch(p.id, p.tripId, undefined, true);
    }
  }

  // 3. Records that are only ever added (never edited): insert the new ones.
  const placeable = <T extends { patientId: string }>(list: T[]) => list.filter((r) => patientTrip.has(r.patientId));
  const fresh = async <T extends { id: string; patientId: string }>(
    list: T[],
    find: (ids: string[]) => Promise<{ id: string; patientId: string }[]>,
  ): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunks(placeable(list))) {
      const here = new Map((await find(part.map((r) => r.id))).map((r) => [r.id, r.patientId]));
      for (const r of part) {
        const owner = here.get(r.id);
        if (owner === undefined) out.push(r);
        else if (owner === r.patientId) summary.alreadyHere++;
        else summary.skipped.push(`record ${r.id}: belongs to another patient here`);
      }
    }
    return out;
  };
  const created = (r: { createdAt: string }) => new Date(r.createdAt);

  const conditions = await fresh(bundle.records.conditions, (ids) => tx.condition.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }));
  for (const part of chunks(conditions, 2000)) {
    await tx.condition.createMany({ data: part.map((c) => ({ ...c, createdAt: created(c), diagnosisDate: c.diagnosisDate ? new Date(`${c.diagnosisDate}T00:00:00Z`) : null })) });
  }
  const vitals = await fresh(bundle.records.vitals, (ids) => tx.vitals.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }));
  for (const part of chunks(vitals, 2000)) await tx.vitals.createMany({ data: part.map((v) => ({ ...v, createdAt: created(v), takenAt: new Date(v.takenAt) })) });
  const diabetic = await fresh(bundle.records.diabetic, (ids) => tx.diabeticEntry.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }));
  for (const part of chunks(diabetic, 2000)) await tx.diabeticEntry.createMany({ data: part.map((d) => ({ ...d, createdAt: created(d), takenAt: new Date(d.takenAt) })) });
  summary.recordsAdded.conditions = conditions.length;
  summary.recordsAdded.vitals = vitals.length;
  summary.recordsAdded.diabetic = diabetic.length;
  for (const r of [...conditions, ...vitals, ...diabetic]) touch(r.patientId, patientTrip.get(r.patientId)!, r.id);

  // 4. Visits and medications: new ones inserted, known ones reconciled like patients.
  const day = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
  const visitsHere = new Map(
    (await tx.visit.findMany({ where: { id: { in: placeable(bundle.records.visits).map((v) => v.id) } } })).map((v) => [v.id, v]),
  );
  const withTripVisit = new Set(
    (await tx.visit.findMany({ where: { patientId: { in: [...patientTrip.keys()] }, tripVisit: true }, select: { patientId: true } })).map((v) => v.patientId),
  );
  for (const v of placeable(bundle.records.visits)) {
    const hub = visitsHere.get(v.id);
    if (hub) {
      if (hub.patientId !== v.patientId) summary.skipped.push(`visit ${v.id}: belongs to another patient here`);
      else await reconcile(tx, subject, "Visit", hub, v, node, summary, () => touch(v.patientId, patientTrip.get(v.patientId)!, v.id));
      continue;
    }
    const keepTripVisit = v.tripVisit && !withTripVisit.has(v.patientId);
    if (keepTripVisit) withTripVisit.add(v.patientId);
    await tx.visit.create({
      data: {
        ...omit(v, "version", "tripVisit", "date", "followUpDate"),
        tripVisit: keepTripVisit ? true : null,
        date: day(v.date)!,
        followUpDate: day(v.followUpDate),
        createdAt: created(v),
      },
    });
    await remember(tx, "Visit", v.id, node, v.version, contentHash(contentOf("Visit", v)));
    summary.recordsAdded.visits++;
    touch(v.patientId, patientTrip.get(v.patientId)!, v.id);
  }

  const medsHere = new Map(
    (await tx.medication.findMany({ where: { id: { in: placeable(bundle.records.medications).map((m) => m.id) } } })).map((m) => [m.id, m]),
  );
  for (const m of placeable(bundle.records.medications)) {
    const hub = medsHere.get(m.id);
    if (hub) {
      if (hub.patientId !== m.patientId) summary.skipped.push(`medication ${m.id}: belongs to another patient here`);
      else await reconcile(tx, subject, "Medication", hub, m, node, summary, () => touch(m.patientId, patientTrip.get(m.patientId)!, m.id));
      continue;
    }
    // Its visit must be one of the same patient's on the hub.
    const visit = m.visitId ? await tx.visit.findUnique({ where: { id: m.visitId }, select: { patientId: true } }) : null;
    await tx.medication.create({
      data: {
        ...omit(m, "version", "visitId", "startDate", "endDate"),
        visitId: visit?.patientId === m.patientId ? m.visitId : null,
        startDate: day(m.startDate),
        endDate: day(m.endDate),
        createdAt: created(m),
      },
    });
    await remember(tx, "Medication", m.id, node, m.version, contentHash(contentOf("Medication", m)));
    summary.recordsAdded.medications++;
    touch(m.patientId, patientTrip.get(m.patientId)!, m.id);
  }

  // 5. Photos (files were stored by the caller before this transaction).
  const photosToAdd = await fresh(bundle.records.photos, (ids) => tx.photo.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }));
  for (const ph of photosToAdd) {
    if (photos !== "dryRun") {
      const stored = photos.get(ph.id);
      if (!stored) {
        summary.skipped.push(`photo ${ph.id}: not a readable image`);
        continue;
      }
      await tx.photo.create({
        data: {
          ...omit(ph, "data", "takenOn"),
          takenOn: day(ph.takenOn),
          filePath: stored.fileName,
          mimeType: "image/jpeg",
          sizeBytes: stored.sizeBytes,
          createdAt: created(ph),
        },
      });
    }
    summary.recordsAdded.photos++;
    touch(ph.patientId, patientTrip.get(ph.patientId)!, ph.id);
  }

  // 6. The laptop's audit entries, appended once each, with their original time and node.
  //    Marks are kept per chain (named by its first entry), because a reinstalled
  //    laptop with the same NODE_ID starts again at ID 1.
  const entries = [...bundle.audit].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const chain = entries[0]?.hash ?? null;
  const state = await tx.syncNode.findUnique({ where: { nodeId: node } });
  const marks = (state?.auditMarks ?? {}) as Record<string, string>;
  const after = chain && marks[chain] ? BigInt(marks[chain]) : BigInt(0);
  if (chain && state && Object.keys(marks).length > 0 && !marks[chain]) {
    summary.skipped.push(`note: ${node}'s audit log starts over (was the laptop reinstalled?); its new entries were added as a separate run`);
  }
  const newEntries = entries.filter((e) => BigInt(e.id) > after);
  for (const e of newEntries) {
    await appendForeignEntry(tx, {
      ts: new Date(e.ts),
      userId: e.userId,
      sessionId: e.sessionId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      tripId: e.tripId,
      ip: e.ip,
      details: e.details ?? null,
      originNodeId: e.originNodeId,
    });
  }
  summary.auditAppended = newEntries.length;
  if (chain && newEntries.length) marks[chain] = newEntries[newEntries.length - 1].id;
  await tx.syncNode.upsert({
    where: { nodeId: node },
    create: { nodeId: node, auditMarks: marks, lastImportAt: new Date(), imports: 1 },
    update: { auditMarks: marks, lastImportAt: new Date(), imports: { increment: 1 } },
  });

  // 7. The hub's own entries: one per patient that changed (IDs only), then the summary.
  for (const [patientId, t] of touched) {
    await audit(tx, subject, {
      action: "sync.import.patient",
      entity: "Patient",
      entityId: patientId,
      tripId: t.tripId,
      details: { fromNode: node, created: t.created, records: t.records },
    });
  }
  await audit(tx, subject, {
    action: "sync.import",
    entity: "Node",
    entityId: node,
    details: {
      bundleCreatedAt: bundle.createdAt,
      patientsAdded: summary.patientsAdded,
      applied: summary.applied,
      conflicts: summary.conflicts,
      auditAppended: summary.auditAppended,
      skipped: summary.skipped.length,
      ...summary.recordsAdded,
    },
  });
  return summary;
}

/** Records what the hub has accepted from a node: its content, and the highest version seen. */
async function remember(tx: Tx, entity: SyncEntity, entityId: string, sourceNodeId: string, version: number, hash: string) {
  const key = { entity_entityId_sourceNodeId: { entity, entityId, sourceNodeId } };
  const last = await tx.syncRecord.findUnique({ where: key });
  await tx.syncRecord.upsert({
    where: key,
    create: { entity, entityId, sourceNodeId, version, contentHash: hash },
    update: { version: Math.max(version, last?.version ?? 0), contentHash: hash },
  });
}

type HubRow = { id: string; version: number; deletedAt?: Date | null } & Record<string, unknown>;

async function reconcile(
  tx: Tx,
  subject: AuditSubject,
  entity: SyncEntity,
  hub: HubRow,
  incoming: Record<string, unknown> & { version: number },
  node: string,
  summary: SyncImportSummary,
  onChange: () => void,
) {
  const hubContent = contentOf(entity, hub);
  const incomingContent = contentOf(entity, incoming);
  const hubHash = contentHash(hubContent);
  const incomingHash = contentHash(incomingContent);
  const last = await tx.syncRecord.findUnique({ where: { entity_entityId_sourceNodeId: { entity, entityId: hub.id, sourceNodeId: node } } });

  if (hubHash === incomingHash) {
    await remember(tx, entity, hub.id, node, incoming.version, incomingHash);
    summary.alreadyHere++;
    return;
  }
  // Versions only go up on the laptop: an older one is from a stale bundle (an
  // earlier USB stick imported after a newer one), already superseded.
  if (last && incoming.version < last.version) {
    summary.alreadyHere++;
    return;
  }
  if (last && last.contentHash === incomingHash) {
    summary.alreadyHere++; // the fallback hasn't changed it since; the hub's newer copy stays
    return;
  }
  if (last && last.contentHash === hubHash) {
    // Only the fallback changed it: apply, with the hub's own version moving on.
    const data = { ...toColumns(entity, incomingContent, hub), version: { increment: 1 } };
    const { count } =
      entity === "Patient"
        ? await tx.patient.updateMany({ where: { id: hub.id, version: hub.version }, data })
        : entity === "Visit"
          ? await tx.visit.updateMany({ where: { id: hub.id, version: hub.version }, data })
          : await tx.medication.updateMany({ where: { id: hub.id, version: hub.version }, data });
    if (count === 1) {
      await remember(tx, entity, hub.id, node, incoming.version, incomingHash);
      summary.applied++;
      onChange();
      return;
    }
    // Someone saved on the hub this very moment: treat it as a conflict.
  }
  const { count } = await tx.syncConflict.createMany({
    data: [{ entity, entityId: hub.id, hubVersion: hub.version, incoming: incomingContent, incomingHash, sourceNodeId: node }],
    skipDuplicates: true,
  });
  // Seen, though not accepted: older versions from this laptop are stale from now on.
  if (last && incoming.version > last.version) {
    await tx.syncRecord.update({ where: { entity_entityId_sourceNodeId: { entity, entityId: hub.id, sourceNodeId: node } }, data: { version: incoming.version } });
  }
  if (count === 1) {
    summary.conflicts++;
    await audit(tx, subject, { action: "sync.conflict", entity, entityId: hub.id, details: { fromNode: node, hubVersion: hub.version } });
  } else summary.alreadyHere++; // already queued by an earlier import of this bundle
}
