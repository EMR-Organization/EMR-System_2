import "server-only";
import { z } from "zod";
import type { Specialty } from "@/generated/prisma/client";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Aggregates only (counts), so these aren't audited as record views.

export type TripStats = {
  total: number;
  registeredToday: number;
  bySpecialty: Record<Specialty, { assigned: number; seen: number }>;
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

  const [total, registeredToday, assigned, risk, seen] = await Promise.all([
    db.patient.count({ where: live }),
    db.patient.count({ where: { ...live, createdAt: { gte: startOfDay } } }),
    db.patient.groupBy({ by: ["assignedSpecialty"], where: live, _count: true }),
    db.patient.groupBy({ by: ["waterRiskRating"], where: live, _count: true }),
    db.$queryRaw<{ specialty: Specialty; n: bigint }[]>`
      SELECT COALESCE(v."specialty", p."assignedSpecialty") AS specialty, COUNT(*) AS n
      FROM "Patient" p
      LEFT JOIN "Visit" v ON v."patientId" = p."id" AND v."tripVisit" = TRUE
      WHERE p."tripId" = ${id}::uuid AND p."deletedAt" IS NULL
        AND (
          COALESCE(v."diagnosis", '') <> ''
          OR EXISTS (SELECT 1 FROM "Medication" m WHERE m."patientId" = p."id" AND m."status" = 'ACTIVE')
        )
      GROUP BY 1
    `,
  ]);

  const bySpecialty = Object.fromEntries(
    (["DENTIST", "PHYSICIAN", "PEDIATRICIAN"] as const).map((s) => [
      s,
      {
        assigned: assigned.find((a) => a.assignedSpecialty === s)?._count ?? 0,
        seen: Number(seen.find((r) => r.specialty === s)?.n ?? 0),
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
