import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { formatPatientLabel, parsePatientLabel } from "@/lib/shared/patient-label";
import { auditOnly } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { accessibleTripIds, assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Cross-trip patient search (render_cross_trip_search in app.py), for finding a
// returning patient from an earlier trip. Scoped to the trips the user can
// reach: every trip for doctors and admins, switched-on trips for students.
//
// Matches names (accent- and case-insensitive, every word must match), the
// patient number (12, 012 or 012_05_2026), phone digits, and date of birth.
// Diagnoses aren't searched: students can't read them.

export const SEARCH_LIMIT = 50;

const searchSchema = z.object({
  q: z.string().trim().min(2, { error: "searchTooShort" }).max(100, { error: "tooLongText" }),
});

export type SearchResult = {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  dateOfBirth: Date | null;
  ageValue: number | null;
  ageUnit: "YEARS" | "MONTHS" | null;
  phone: string | null;
  trip: { id: string; code: string; name: string; active: boolean };
};

export async function searchPatients(input: unknown): Promise<{ results: SearchResult[]; truncated: boolean }> {
  const actor = await requireUser();
  const { q } = parse(searchSchema, input);
  const scope = await accessibleTripIds(actor);
  if (scope === "all") await assertCan(actor, "search.crossTrip");
  else if (scope.length === 0) return { results: [], truncated: false };
  // (A student's list is already only trips they're switched on for, which is what search.crossTrip "trip" means.)

  const tripFilter = scope === "all" ? Prisma.sql`TRUE` : Prisma.sql`p."tripId" IN (${Prisma.join(scope.map((id) => Prisma.sql`${id}::uuid`))})`;
  const matches = matchConditions(q);

  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT p."id"
    FROM "Patient" p JOIN "Trip" t ON t."id" = p."tripId"
    WHERE p."deletedAt" IS NULL AND ${tripFilter} AND (${Prisma.join(matches, " OR ")})
    ORDER BY t."year" DESC, t."month" DESC, t."code", p."displayNumber"
    LIMIT ${SEARCH_LIMIT + 1}
  `;
  const truncated = ids.length > SEARCH_LIMIT;
  const order = ids.slice(0, SEARCH_LIMIT).map((r) => r.id);

  const rows = await db.patient.findMany({
    where: { id: { in: order } },
    select: {
      id: true,
      displayNumber: true,
      firstName: true,
      lastName: true,
      gender: true,
      dateOfBirth: true,
      ageValue: true,
      ageUnit: true,
      phone: true,
      trip: { select: { id: true, code: true, name: true, active: true } },
    },
  });
  const byId = new Map(rows.map(({ displayNumber, ...p }) => [p.id, { ...p, label: formatPatientLabel(displayNumber, p.trip.code) }]));
  const results = order.flatMap((id) => byId.get(id) ?? []);

  // IDs only, never the search text: it's usually a patient's name.
  await auditOnly(actor, {
    action: "search.run",
    entity: "Patient",
    details: { queryLength: q.length, resultCount: results.length, patientIds: results.map((r) => r.id) },
  });
  return { results, truncated };
}

function matchConditions(q: string): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  const label = parsePatientLabel(q);
  if (label) {
    conditions.push(Prisma.sql`(p."displayNumber" = ${label.displayNumber} AND t."code" = ${label.tripCode})`);
    return conditions;
  }
  if (/^\d{1,6}$/.test(q) && Number(q) > 0) conditions.push(Prisma.sql`p."displayNumber" = ${Number(q)}`);

  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && /^[\d\s()+.-]+$/.test(q)) {
    conditions.push(Prisma.sql`regexp_replace(coalesce(p."phone", ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`);
  }

  const dob = parseDate(q);
  if (dob) conditions.push(Prisma.sql`p."dateOfBirth" = ${dob}::date`);

  const words = q.split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(0, 4);
  if (words.length > 0) {
    const name = Prisma.sql`unaccent(lower(p."firstName" || ' ' || p."lastName"))`;
    conditions.push(
      Prisma.sql`(${Prisma.join(
        words.map((w) => Prisma.sql`${name} LIKE '%' || unaccent(lower(${escapeLike(w)})) || '%'`),
        " AND ",
      )})`,
    );
  }
  return conditions.length > 0 ? conditions : [Prisma.sql`FALSE`];
}

/** 2026-05-07, 07/05/2026 or 7-5-2026 (day first, as written in Latin America). */
function parseDate(q: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  let [y, mo, d] = m ? [m[1], m[2], m[3]] : [];
  if (!m) {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(q);
    if (!m) return null;
    [d, mo, y] = [m[1].padStart(2, "0"), m[2].padStart(2, "0"), m[3]];
  }
  const iso = `${y}-${mo}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/** A search word is matched literally: %, _ and \ lose their LIKE meaning. */
function escapeLike(word: string): string {
  return word.replace(/[\\%_]/g, (c) => `\\${c}`);
}
