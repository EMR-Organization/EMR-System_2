import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { omit } from "@/lib/shared/omit";
import type { SyncBundle } from "@/lib/shared/schemas/sync";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { seal } from "@/server/sealed";

// On a fallback laptop, once the hub is back (scripts/export-bundle.ts): every
// record created or changed since `since` (default: everything), each one's
// patient, the photos, and this laptop's audit entries, encrypted for the hub.
// Exporting overlapping periods is fine: the hub skips what it already has.

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const origin = (r: { originNodeId: string; createdById: string; createdAt: Date }) => ({
  originNodeId: r.originNodeId,
  createdById: r.createdById,
  createdAt: r.createdAt.toISOString(),
});

export async function buildBundleFile(options: { since?: Date | null } = {}): Promise<{ file: Buffer; bundle: SyncBundle; missingPhotos: string[] }> {
  const since = options.since ?? null;
  const changed = since ? { updatedAt: { gte: since } } : {};

  const [conditions, vitals, diabetic, visits, medications, photos, changedPatients] = await Promise.all([
    db.condition.findMany({ where: changed }),
    db.vitals.findMany({ where: changed }),
    db.diabeticEntry.findMany({ where: changed }),
    db.visit.findMany({ where: changed }),
    db.medication.findMany({ where: changed }),
    db.photo.findMany({ where: changed }),
    db.patient.findMany({ where: changed, select: { id: true } }),
  ]);
  // A changed record always travels with its patient, so the hub can place it.
  const patientIds = new Set([...changedPatients.map((p) => p.id), ...[conditions, vitals, diabetic, visits, medications, photos].flat().map((r) => r.patientId)]);
  const patients = await db.patient.findMany({ where: { id: { in: [...patientIds] } }, orderBy: { displayNumber: "asc" } });
  const trips = await db.trip.findMany({ where: { id: { in: [...new Set(patients.map((p) => p.tripId))] } } });
  const auditRows = await db.auditLog.findMany({ where: { originNodeId: env().NODE_ID }, orderBy: { id: "asc" } });
  const photosDir = path.resolve(env().PHOTOS_DIR);
  // A photo whose file is gone (disk trouble) is left out and reported, not fatal.
  const missingPhotos: string[] = [];
  const photoRecords = (
    await Promise.all(
      photos.map(async (ph) => {
        const data = await readFile(path.join(photosDir, path.basename(ph.filePath))).catch(() => null);
        if (!data) {
          missingPhotos.push(ph.id);
          return null;
        }
        return {
          id: ph.id,
          patientId: ph.patientId,
          kind: ph.kind,
          category: ph.category,
          description: ph.description,
          notes: ph.notes,
          takenOn: isoDay(ph.takenOn),
          ...origin(ph),
          data: data.toString("base64"),
        };
      }),
    )
  ).flatMap((r) => (r ? [r] : []));

  const bundle: SyncBundle = {
    format: "hf-emr-sync",
    formatVersion: 1,
    sourceNodeId: env().NODE_ID,
    createdAt: new Date().toISOString(),
    since: since?.toISOString() ?? null,
    trips: trips.map(({ id, code, name, month, year, location }) => ({ id, code, name, month, year, location })),
    records: {
      patients: patients.map((p) => ({
        id: p.id,
        tripId: p.tripId,
        displayNumber: p.displayNumber,
        originLabel: p.originLabel,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: isoDay(p.dateOfBirth),
        ageValue: p.ageValue,
        ageUnit: p.ageUnit,
        gender: p.gender,
        phone: p.phone,
        address: p.address,
        emergencyContact: p.emergencyContact,
        waterSource: p.waterSource,
        waterRiskRating: p.waterRiskRating,
        waterHistory: p.waterHistory,
        waterNotes: p.waterNotes,
        assignedSpecialty: p.assignedSpecialty,
        version: p.version,
        deleted: p.deletedAt != null,
        ...origin(p),
      })),
      conditions: conditions.map((c) => ({
        id: c.id,
        patientId: c.patientId,
        condition: c.condition,
        diagnosisDate: isoDay(c.diagnosisDate),
        severity: c.severity,
        notes: c.notes,
        ...origin(c),
      })),
      vitals: vitals.map((v) => ({ ...omit(v, "updatedAt"), takenAt: v.takenAt.toISOString(), ...origin(v) })),
      diabetic: diabetic.map((d) => ({ ...omit(d, "updatedAt"), takenAt: d.takenAt.toISOString(), ...origin(d) })),
      visits: visits.map((v) => ({
        id: v.id,
        patientId: v.patientId,
        tripVisit: v.tripVisit === true,
        visitType: v.visitType,
        date: isoDay(v.date)!,
        chiefComplaint: v.chiefComplaint,
        symptoms: v.symptoms,
        diagnosis: v.diagnosis,
        treatment: v.treatment,
        specialty: v.specialty,
        followUpDate: isoDay(v.followUpDate),
        notes: v.notes,
        version: v.version,
        ...origin(v),
      })),
      medications: medications.map((m) => ({
        id: m.id,
        patientId: m.patientId,
        visitId: m.visitId,
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        route: m.route,
        startDate: isoDay(m.startDate),
        endDate: isoDay(m.endDate),
        prescribedFor: m.prescribedFor,
        instructions: m.instructions,
        notes: m.notes,
        status: m.status,
        discontinueReason: m.discontinueReason,
        version: m.version,
        ...origin(m),
      })),
      photos: photoRecords,
    },
    audit: auditRows.map((a) => ({
      id: a.id.toString(),
      ts: a.ts.toISOString(),
      userId: a.userId,
      sessionId: a.sessionId,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      tripId: a.tripId,
      ip: a.ip,
      details: a.details,
      originNodeId: a.originNodeId,
      hash: a.hash,
    })),
  };

  await db.$transaction((tx) =>
    audit(tx, null, {
      action: "sync.bundle.export",
      entity: "Node",
      details: { since: bundle.since, patients: patients.length, photos: photoRecords.length, missingPhotos, auditEntries: auditRows.length },
    }),
  );
  return { file: seal("bundle", Buffer.from(JSON.stringify(bundle))), bundle, missingPhotos };
}
