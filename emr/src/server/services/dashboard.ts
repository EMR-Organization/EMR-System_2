import "server-only";
import { z } from "zod";
import type { Specialty } from "@/generated/prisma/client";
import { formatPatientLabel } from "@/lib/shared/patient-label";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Aggregates only (counts), so these aren't audited as record views.

export type TripStats = {
  total: number;
  registeredToday: number;
  /** seen: by the specialty that saw them; waiting: not seen yet, by the specialty they were sent to. */
  bySpecialty: Record<Specialty, { assigned: number; seen: number; waiting: number }>;
  waterRisk: { LOW: number; MEDIUM: number; HIGH: number; unknown: number };
};

/**
 * The trip dashboard (get_trip_stats in app.py). "Seen" means a doctor saved a
 * diagnosis on the trip visit or prescribed an active medication
 * (patient_seen_by_doctor); the specialty is the trip visit's, falling back to
 * the one the patient was assigned to (get_doctor_type_for_patient).
 */
export async function tripStats(tripId: unknown): Promise<TripStats> {
  const actor = await requireUser();
  const id = parse(z.uuid(), tripId);
  await assertCan(actor, "patient.read", { tripId: id });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const live = { tripId: id, deletedAt: null };

  const [total, registeredToday, assigned, risk, seenRows] = await Promise.all([
    db.patient.count({ where: live }),
    db.patient.count({ where: { ...live, createdAt: { gte: startOfDay } } }),
    db.patient.groupBy({ by: ["assignedSpecialty"], where: live, _count: true }),
    db.patient.groupBy({ by: ["waterRiskRating"], where: live, _count: true }),
    // One row per patient: who they were sent to, who saw them (if anyone).
    db.$queryRaw<{ assigned: Specialty; seenBy: Specialty | null; seen: boolean }[]>`
      SELECT p."assignedSpecialty" AS assigned,
             COALESCE(v."specialty", p."assignedSpecialty") AS "seenBy",
             (COALESCE(v."diagnosis", '') <> ''
               OR EXISTS (SELECT 1 FROM "Medication" m WHERE m."patientId" = p."id" AND m."status" = 'ACTIVE')) AS seen
      FROM "Patient" p
      LEFT JOIN "Visit" v ON v."patientId" = p."id" AND v."tripVisit" = TRUE
      WHERE p."tripId" = ${id}::uuid AND p."deletedAt" IS NULL
    `,
  ]);

  const bySpecialty = Object.fromEntries(
    (["DENTIST", "PHYSICIAN", "PEDIATRICIAN"] as const).map((s) => [
      s,
      {
        assigned: assigned.find((a) => a.assignedSpecialty === s)?._count ?? 0,
        seen: seenRows.filter((r) => r.seen && r.seenBy === s).length,
        waiting: seenRows.filter((r) => !r.seen && r.assigned === s).length,
      },
    ]),
  ) as TripStats["bySpecialty"];

  const riskCount = (r: "LOW" | "MEDIUM" | "HIGH" | null) => risk.find((x) => x.waterRiskRating === r)?._count ?? 0;
  return {
    total,
    registeredToday,
    bySpecialty,
    waterRisk: { LOW: riskCount("LOW"), MEDIUM: riskCount("MEDIUM"), HIGH: riskCount("HIGH"), unknown: riskCount(null) },
  };
}

export type QueueItem = {
  id: string;
  displayNumber: number;
  label: string;
  firstName: string;
  lastName: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  dateOfBirth: Date | null;
  ageValue: number | null;
  ageUnit: "YEARS" | "MONTHS" | null;
  hasDiagnosis: boolean;
  activeMedications: number;
};

/**
 * "My Patients" (render_doctor_patient_list in the old app): this trip's
 * patients sent to the doctor's specialty, not-yet-seen first. Specialty only
 * sorts the work; any doctor can still open any patient. Admins pick a
 * specialty to look at.
 */
export async function doctorQueue(input: unknown): Promise<{ specialty: Specialty | null; patients: QueueItem[] }> {
  const actor = await requireUser();
  const { tripId, specialty: requested } = parse(
    z.object({ tripId: z.uuid(), specialty: z.enum(["DENTIST", "PHYSICIAN", "PEDIATRICIAN"]).optional() }),
    input,
  );
  await assertCan(actor, "visit.read", { tripId });
  const specialty = actor.role === "DOCTOR" ? actor.specialty : (requested ?? null);
  if (!specialty) return { specialty: null, patients: [] };

  const rows = await db.patient.findMany({
    where: { tripId, deletedAt: null, assignedSpecialty: specialty },
    orderBy: { displayNumber: "asc" },
    select: {
      id: true,
      displayNumber: true,
      firstName: true,
      lastName: true,
      gender: true,
      dateOfBirth: true,
      ageValue: true,
      ageUnit: true,
      trip: { select: { code: true } },
      visits: { where: { tripVisit: true }, select: { diagnosis: true } },
      _count: { select: { medications: { where: { status: "ACTIVE" } } } },
    },
  });
  const patients = rows.map(({ trip, visits, _count, ...p }) => ({
    ...p,
    label: formatPatientLabel(p.displayNumber, trip.code),
    hasDiagnosis: Boolean(visits[0]?.diagnosis),
    activeMedications: _count.medications,
  }));
  // Waiting patients first (patient_seen_by_doctor), each group in arrival order.
  const seen = (q: QueueItem) => q.hasDiagnosis || q.activeMedications > 0;
  patients.sort((a, b) => Number(seen(a)) - Number(seen(b)) || a.displayNumber - b.displayNumber);
  return { specialty, patients };
}
