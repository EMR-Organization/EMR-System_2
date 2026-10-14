import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { parsePatientLabel } from "@/lib/shared/patient-label";
import { audit, auditOnly, verifyChain, type ChainResult } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { assertCan } from "@/server/rbac";
import { parse } from "@/server/validation";

// Admin → Audit (spec: services/audit): a filterable view of the log and the
// Verify chain button. Looking at the log is itself logged.

export const AUDIT_PAGE_SIZE = 50;

const day = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.iso.date({ error: "date" }).optional());

const listAuditSchema = z.object({
  userId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  /** A patient's ID or label (012_05_2026). */
  patient: z.string().trim().max(100).optional().transform((v) => v || undefined),
  /** "patient.view", or a prefix such as "patient." */
  action: z.string().trim().max(60).regex(/^[a-z.]*$/, { error: "invalid" }).optional().transform((v) => v || undefined),
  from: day,
  to: day,
  /** Show entries older than this id (the next page). */
  before: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{1,19}$/).optional()),
});

export type AuditRow = {
  id: string;
  ts: Date;
  action: string;
  entity: string;
  entityId: string | null;
  tripId: string | null;
  ip: string | null;
  originNodeId: string;
  details: unknown;
  user: { id: string; name: string; email: string } | null;
};

export async function listAudit(input: unknown): Promise<{ rows: AuditRow[]; nextBefore: string | null; patientNotFound: boolean }> {
  const actor = await requireUser();
  const filter = parse(listAuditSchema, input);
  await assertCan(actor, "audit.read");

  let patientId: string | undefined;
  if (filter.patient) {
    patientId = await resolvePatient(filter.patient);
    if (!patientId) return { rows: [], nextBefore: null, patientNotFound: true };
  }

  const where: Prisma.AuditLogWhereInput = {
    ...(filter.userId ? { userId: filter.userId } : {}),
    ...(filter.action ? { action: filter.action.endsWith(".") ? { startsWith: filter.action } : filter.action } : {}),
    ...(patientId ? { OR: [{ entityId: patientId }, { details: { path: ["patientId"], equals: patientId } }] } : {}),
    ...(filter.before ? { id: { lt: BigInt(filter.before) } } : {}),
    ts: {
      ...(filter.from ? { gte: localMidnight(filter.from) } : {}),
      ...(filter.to ? { lt: localMidnight(filter.to, 1) } : {}),
    },
  };

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { id: "desc" },
    take: AUDIT_PAGE_SIZE + 1,
    select: { id: true, ts: true, userId: true, action: true, entity: true, entityId: true, tripId: true, ip: true, originNodeId: true, details: true },
  });
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const userIds = [...new Set(page.flatMap((r) => (r.userId ? [r.userId] : [])))];
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
  );

  await auditOnly(actor, {
    action: "audit.view",
    entity: "AuditLog",
    details: {
      userId: filter.userId ?? null,
      patientId: patientId ?? null,
      action: filter.action ?? null,
      from: filter.from ?? null,
      to: filter.to ?? null,
      before: filter.before ?? null,
    },
  });

  return {
    rows: page.map(({ id, userId, ...r }) => ({ ...r, id: id.toString(), user: userId ? (users.get(userId) ?? null) : null })),
    nextBefore: rows.length > AUDIT_PAGE_SIZE ? page[page.length - 1].id.toString() : null,
    patientNotFound: false,
  };
}

/** Everyone who has ever been in the log, for the user filter. */
export async function listAuditUsers(): Promise<{ id: string; name: string; email: string }[]> {
  const actor = await requireUser();
  await assertCan(actor, "audit.read");
  return db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true } });
}

const verifySchema = z.object({
  checkpointId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().regex(/^\d{1,19}$/, { error: "invalid" }).optional()),
  checkpointHash: z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().regex(/^[0-9a-f]{64}$/, { error: "invalid" }).optional(),
  ),
}).superRefine((v, ctx) => {
  // A checkpoint is the pair; half of one is a typo.
  if (!v.checkpointId !== !v.checkpointHash) {
    ctx.addIssue({ code: "custom", path: [v.checkpointId ? "checkpointHash" : "checkpointId"], message: "required" });
  }
});

/**
 * Recomputes the whole chain. With a checkpoint (from a backup's manifest or
 * a printout), also checks the log still has that entry with that hash.
 */
export async function verifyAuditChain(input: unknown): Promise<ChainResult> {
  const actor = await requireUser();
  const { checkpointId, checkpointHash } = parse(verifySchema, input);
  await assertCan(actor, "audit.read");

  const result = await verifyChain(checkpointId && checkpointHash ? { checkpoint: { id: checkpointId, hash: checkpointHash } } : {});
  await db.$transaction((tx) =>
    audit(tx, actor, {
      action: "audit.verify",
      entity: "AuditLog",
      details: {
        ok: result.ok,
        checked: result.checked,
        checkpointId: checkpointId ?? null,
        brokenAtId: result.ok ? null : result.brokenAtId,
        reason: result.ok ? null : result.reason,
      },
    }),
  );
  return result;
}

async function resolvePatient(value: string): Promise<string | undefined> {
  if (z.uuid().safeParse(value).success) return value;
  const label = parsePatientLabel(value);
  if (!label) return undefined;
  const patient = await db.patient.findFirst({
    where: { displayNumber: label.displayNumber, trip: { code: label.tripCode } },
    select: { id: true },
  });
  return patient?.id;
}

/** Midnight at the start of a local calendar day (the hub's clock), plus `addDays`. */
function localMidnight(isoDay: string, addDays = 0): Date {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y, m - 1, d + addDays);
}
