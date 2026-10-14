import "server-only";
import { formatPatientLabel } from "@/lib/shared/patient-label";
import { TRIP_DATA_FORMAT, TRIP_DATA_VERSION, type TripData, type TripDataPatient } from "@/lib/shared/schemas/trip-data";
import { audit, type AuditSubject } from "@/server/audit";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { allocatePatientNumber } from "@/server/patient-number";

// Builds and merges trip data files (spec: services/data). Used by the data
// service (export, admin import) and by scripts/import-legacy.ts.
//
// Import is MERGE ONLY and idempotent: a record whose ID is already here is
// left exactly as it is, so importing the same file twice changes nothing, and
// nothing that's already in the database is ever overwritten or deleted.

/** A copy without the given keys. */
function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const asDay = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

/** Every live patient on the trip with their records, as a trip data file. Photos aren't included. */
export async function buildTripData(tripId: string): Promise<TripData> {
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  const patients = await db.patient.findMany({
    where: { tripId, deletedAt: null },
    orderBy: { displayNumber: "asc" },
    include: {
      conditions: { orderBy: { createdAt: "asc" } },
      vitals: { orderBy: { takenAt: "asc" } },
      diabetic: { orderBy: { takenAt: "asc" } },
      visits: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
      medications: { orderBy: { createdAt: "asc" } },
    },
  });
  const origin = (r: { originNodeId: string; createdById: string; createdAt: Date }) => ({
    originNodeId: r.originNodeId,
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
  });

  return {
    format: TRIP_DATA_FORMAT,
    formatVersion: TRIP_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceNodeId: env().NODE_ID,
    trip: { code: trip.code, name: trip.name, month: trip.month, year: trip.year, location: trip.location },
    patients: patients.map((p) => ({
      id: p.id,
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
      ...origin(p),
      conditions: p.conditions.map((c) => ({
        id: c.id,
        condition: c.condition,
        diagnosisDate: isoDay(c.diagnosisDate),
        severity: c.severity,
        notes: c.notes,
        ...origin(c),
      })),
      vitals: p.vitals.map((v) => ({ ...omit(v, "patientId", "updatedAt"), takenAt: v.takenAt.toISOString(), ...origin(v) })),
      diabetic: p.diabetic.map((d) => ({ ...omit(d, "patientId", "updatedAt"), takenAt: d.takenAt.toISOString(), ...origin(d) })),
      visits: p.visits.map((v) => ({
        id: v.id,
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
        ...origin(v),
      })),
      medications: p.medications.map((m) => ({
        id: m.id,
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
        ...origin(m),
      })),
    })),
  };
}

type RecordKind = "conditions" | "vitals" | "diabetic" | "visits" | "medications";
const KINDS: RecordKind[] = ["conditions", "vitals", "diabetic", "visits", "medications"];

export type ImportSummary = {
  patientsAdded: number;
  patientsAlreadyHere: number;
  renumbered: { from: string; to: string }[];
  recordsAdded: Record<RecordKind, number>;
  recordsAlreadyHere: number;
  /** Things left out, with the reason (e.g. a patient ID that belongs to another trip). */
  skipped: string[];
};

/** Splits a list for `IN (...)` queries, keeping well under Postgres's parameter limit. */
function chunks<T>(items: T[], size = 5000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function existingIds(
  find: (ids: string[]) => Promise<{ id: string; patientId: string }[]>,
  ids: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const part of chunks(ids)) for (const row of await find(part)) found.set(row.id, row.patientId);
  return found;
}

/**
 * Merges a validated trip data file into `tripId`, inside the caller's
 * transaction. New patients keep their number when it's free on this trip;
 * otherwise they get the next number and keep the old label as originLabel.
 * Every patient that gains anything gets an audit entry listing the record IDs.
 */
export async function importTripData(tx: Tx, data: TripData, tripId: string, subject: AuditSubject): Promise<ImportSummary> {
  const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { code: true } });
  // Serialize imports and registrations on this trip (numbers are decided below).
  await tx.$queryRaw`SELECT 1 FROM "Trip" WHERE "id" = ${tripId}::uuid FOR UPDATE`;

  const summary: ImportSummary = {
    patientsAdded: 0,
    patientsAlreadyHere: 0,
    renumbered: [],
    recordsAdded: { conditions: 0, vitals: 0, diabetic: 0, visits: 0, medications: 0 },
    recordsAlreadyHere: 0,
    skipped: [],
  };
  const fileLabel = (p: TripDataPatient) => formatPatientLabel(p.displayNumber, data.trip.code);

  // 1. Which patients are new, already here, or belong to another trip.
  const present = new Map<string, string>();
  for (const part of chunks(data.patients.map((p) => p.id))) {
    for (const row of await tx.patient.findMany({ where: { id: { in: part } }, select: { id: true, tripId: true } })) present.set(row.id, row.tripId);
  }
  const incoming: TripDataPatient[] = [];
  const fresh: TripDataPatient[] = [];
  for (const p of data.patients) {
    const at = present.get(p.id);
    if (at && at !== tripId) summary.skipped.push(`${fileLabel(p)}: this patient ID already belongs to another trip`);
    else if (at) {
      summary.patientsAlreadyHere++;
      incoming.push(p);
    } else {
      fresh.push(p);
      incoming.push(p);
    }
  }

  // 2. Numbers: keep each free number; the counter then moves past every number in use.
  const used = new Set((await tx.patient.findMany({ where: { tripId }, select: { displayNumber: true } })).map((r) => r.displayNumber));
  const numbers = new Map<string, { displayNumber: number; originLabel: string | null }>();
  const clashing: TripDataPatient[] = [];
  for (const p of [...fresh].sort((a, b) => a.displayNumber - b.displayNumber)) {
    if (used.has(p.displayNumber)) clashing.push(p);
    else {
      used.add(p.displayNumber);
      numbers.set(p.id, { displayNumber: p.displayNumber, originLabel: p.originLabel });
    }
  }
  const highest = Math.max(0, ...used);
  await tx.$executeRaw`UPDATE "Trip" SET "nextPatientNumber" = GREATEST("nextPatientNumber", ${highest + 1}) WHERE "id" = ${tripId}::uuid`;
  for (const p of clashing) {
    const displayNumber = await allocatePatientNumber(tx, tripId);
    numbers.set(p.id, { displayNumber, originLabel: p.originLabel ?? fileLabel(p) });
    summary.renumbered.push({ from: fileLabel(p), to: formatPatientLabel(displayNumber, trip.code) });
  }

  for (const part of chunks(fresh, 1000)) {
    await tx.patient.createMany({
      data: part.map((p) => ({
        ...omit(p, "conditions", "vitals", "diabetic", "visits", "medications"),
        ...numbers.get(p.id)!,
        tripId,
        dateOfBirth: asDay(p.dateOfBirth),
        createdAt: new Date(p.createdAt),
      })),
    });
  }
  summary.patientsAdded = fresh.length;

  // 3. Their records: add the ones not here yet.
  const owner = new Map<string, string>(); // record id -> patient id, for everything in the file
  const all = <K extends RecordKind>(kind: K) => incoming.flatMap((p) => p[kind].map((r) => ({ ...r, patientId: p.id }) as TripDataPatient[K][number] & { patientId: string }));
  const lists = Object.fromEntries(KINDS.map((k) => [k, all(k)])) as { [K in RecordKind]: ReturnType<typeof all<K>> };
  for (const k of KINDS) for (const r of lists[k]) owner.set(r.id, r.patientId);

  const here: Record<RecordKind, Map<string, string>> = {
    conditions: await existingIds((ids) => tx.condition.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }), lists.conditions.map((r) => r.id)),
    vitals: await existingIds((ids) => tx.vitals.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }), lists.vitals.map((r) => r.id)),
    diabetic: await existingIds((ids) => tx.diabeticEntry.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }), lists.diabetic.map((r) => r.id)),
    visits: await existingIds((ids) => tx.visit.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }), lists.visits.map((r) => r.id)),
    medications: await existingIds((ids) => tx.medication.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true } }), lists.medications.map((r) => r.id)),
  };
  const added = new Map<string, Record<RecordKind, string[]>>();
  const toAdd = <K extends RecordKind>(kind: K) =>
    lists[kind].filter((r) => {
      const at = here[kind].get(r.id);
      if (at === undefined) {
        const mine = added.get(r.patientId) ?? { conditions: [], vitals: [], diabetic: [], visits: [], medications: [] };
        mine[kind].push(r.id);
        added.set(r.patientId, mine);
        return true;
      }
      if (at === r.patientId) summary.recordsAlreadyHere++;
      else summary.skipped.push(`${kind} ${r.id}: this ID already belongs to another patient`);
      return false;
    });

  const origin = (r: { originNodeId: string; createdById: string; createdAt: string }) => ({
    originNodeId: r.originNodeId,
    createdById: r.createdById,
    createdAt: new Date(r.createdAt),
  });

  for (const part of chunks(toAdd("conditions"), 2000)) {
    await tx.condition.createMany({ data: part.map((c) => ({ ...c, ...origin(c), diagnosisDate: asDay(c.diagnosisDate) })) });
  }
  for (const part of chunks(toAdd("vitals"), 2000)) {
    await tx.vitals.createMany({ data: part.map((v) => ({ ...v, ...origin(v), takenAt: new Date(v.takenAt) })) });
  }
  for (const part of chunks(toAdd("diabetic"), 2000)) {
    await tx.diabeticEntry.createMany({ data: part.map((d) => ({ ...d, ...origin(d), takenAt: new Date(d.takenAt) })) });
  }

  // A patient has at most one trip visit: one arriving for a patient who already has another becomes an ordinary visit.
  const newVisits = toAdd("visits");
  const withTripVisit = new Set(
    (await tx.visit.findMany({ where: { patientId: { in: incoming.map((p) => p.id) }, tripVisit: true }, select: { patientId: true } })).map(
      (v) => v.patientId,
    ),
  );
  for (const part of chunks(newVisits, 2000)) {
    await tx.visit.createMany({
      data: part.map(({ tripVisit, date, followUpDate, ...v }) => {
        const keep = tripVisit && !withTripVisit.has(v.patientId);
        if (keep) withTripVisit.add(v.patientId);
        return { ...v, ...origin(v), tripVisit: keep ? true : null, date: asDay(date)!, followUpDate: asDay(followUpDate) };
      }),
    });
  }

  // A medication's visit must be one of the same patient's.
  const visitOwner = new Map(owner);
  for (const [visitId, patientId] of here.visits) visitOwner.set(visitId, patientId);
  for (const part of chunks(toAdd("medications"), 2000)) {
    await tx.medication.createMany({
      data: part.map(({ visitId, startDate, endDate, ...m }) => ({
        ...m,
        ...origin(m),
        visitId: visitId && visitOwner.get(visitId) === m.patientId ? visitId : null,
        startDate: asDay(startDate),
        endDate: asDay(endDate),
      })),
    });
  }
  for (const [, ids] of added) for (const k of KINDS) summary.recordsAdded[k] += ids[k].length;

  // 4. Audit: one entry per patient that gained anything (IDs only), then the summary.
  const freshIds = new Set(fresh.map((p) => p.id));
  for (const p of incoming) {
    const records = added.get(p.id);
    if (!freshIds.has(p.id) && !records) continue;
    const number = numbers.get(p.id);
    await audit(tx, subject, {
      action: "data.import.patient",
      entity: "Patient",
      entityId: p.id,
      tripId,
      details: {
        created: freshIds.has(p.id),
        displayNumber: number?.displayNumber ?? p.displayNumber,
        renumberedFrom: number && number.displayNumber !== p.displayNumber ? fileLabel(p) : null,
        ...(records ?? { conditions: [], vitals: [], diabetic: [], visits: [], medications: [] }),
      },
    });
  }
  await audit(tx, subject, {
    action: "data.import",
    entity: "Trip",
    entityId: tripId,
    tripId,
    details: {
      sourceNodeId: data.sourceNodeId,
      exportedAt: data.exportedAt,
      patientsAdded: summary.patientsAdded,
      patientsAlreadyHere: summary.patientsAlreadyHere,
      renumbered: summary.renumbered.length,
      skipped: summary.skipped.length,
      ...summary.recordsAdded,
    },
  });
  return summary;
}
