import "server-only";
import { createHmac } from "node:crypto";
import type { Actor } from "@/server/auth/session";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";

// Append-only, hash-chained audit log (spec: "Audit log").
//
// - Written in the SAME transaction as the change it describes, so a change
//   can't commit without its entry and a rolled-back change leaves none.
// - Each entry's hash is an HMAC (keyed with AUDIT_KEY, which is not in the
//   database) over the previous entry's hash and its own fields. Editing or
//   deleting a row breaks the chain from there on, and without the key nobody
//   can recompute a consistent chain; verifyChain() finds where it breaks.
// - Someone holding both the database and the key could rewrite the whole
//   chain, so checkpoints (latestCheckpoint()) are also kept outside the
//   database (backups, printouts) and verifyChain() can check against one.
// - pg_advisory_xact_lock makes appends one-at-a-time so the chain can't fork.
// - details holds IDs and field names only, never patient field values.

export const GENESIS_HASH = "0".repeat(64);
const AUDIT_LOCK_KEY = 72_017_001; // arbitrary constant shared by every writer

export type AuditDetails = Record<string, string | number | boolean | null | string[]>;

export type AuditInput = {
  action: string;
  entity: string;
  entityId?: string | null;
  tripId?: string | null;
  details?: AuditDetails;
};

/** Who an entry is attributed to: a signed-in actor, or a known user with no session (e.g. sign-in failures). */
export type AuditSubject = Actor | { userId: string | null; ip?: string | null } | null;

export async function audit(tx: Tx, subject: AuditSubject, input: AuditInput): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS_HASH;

  const entry = {
    ts: new Date(),
    userId: subject && "sessionId" in subject ? subject.id : (subject?.userId ?? null),
    sessionId: subject && "sessionId" in subject ? subject.sessionId : null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    tripId: input.tripId ?? null,
    ip: subject?.ip ?? null,
    details: input.details ?? null,
    originNodeId: env().NODE_ID,
  };

  await tx.auditLog.create({
    data: { ...entry, details: entry.details ?? undefined, prevHash, hash: hashEntry(prevHash, entry) },
  });
}

/** Convenience for a write that's only an audit entry (e.g. a record view). */
export function auditOnly(subject: AuditSubject, input: AuditInput): Promise<void> {
  return db.$transaction((tx) => audit(tx, subject, input));
}

type HashedFields = {
  ts: Date;
  userId: string | null;
  sessionId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  tripId: string | null;
  ip: string | null;
  details: unknown;
  originNodeId: string;
};

export function hashEntry(prevHash: string, e: HashedFields, key = env().AUDIT_KEY): string {
  const payload = canonicalJson([
    prevHash,
    e.ts.toISOString(),
    e.userId,
    e.sessionId,
    e.action,
    e.entity,
    e.entityId,
    e.tripId,
    e.ip,
    e.details ?? null,
    e.originNodeId,
  ]);
  return createHmac("sha256", key).update(payload).digest("hex");
}

// JSON with object keys sorted at every level. Postgres jsonb reorders keys, so
// the hash must not depend on key order.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export type ChainResult =
  | { ok: true; checked: number; lastHash: string }
  | { ok: false; checked: number; brokenAtId: string; reason: "hash" | "link" | "checkpoint" };

/**
 * A point in the log to keep OUTSIDE the database (in backups, on paper, on a
 * USB stick). If the log is later rewritten, the entry at `id` won't have this
 * hash any more.
 */
export type Checkpoint = { id: string; hash: string; count: number; at: string };

export async function latestCheckpoint(): Promise<Checkpoint | null> {
  const [last, count] = await Promise.all([
    db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true, hash: true, ts: true } }),
    db.auditLog.count(),
  ]);
  return last ? { id: last.id.toString(), hash: last.hash, count, at: last.ts.toISOString() } : null;
}

type StoredEntry = HashedFields & { id: bigint; prevHash: string; hash: string };

/** Checks a run of entries that should follow prevHash. Pure, so tests can feed it tampered copies. */
export function checkEntries(entries: StoredEntry[], prevHash = GENESIS_HASH, key = env().AUDIT_KEY): ChainResult {
  let checked = 0;
  for (const row of entries) {
    if (row.prevHash !== prevHash) return { ok: false, checked, brokenAtId: row.id.toString(), reason: "link" };
    if (hashEntry(row.prevHash, row, key) !== row.hash) {
      return { ok: false, checked, brokenAtId: row.id.toString(), reason: "hash" };
    }
    prevHash = row.hash;
    checked++;
  }
  return { ok: true, checked, lastHash: prevHash };
}

/**
 * Recomputes every hash in the log, in order, and reports the first entry that
 * doesn't match. With a checkpoint, also fails if the entry it names is
 * missing or has a different hash (which catches a whole-chain rewrite).
 */
export async function verifyChain(options: { checkpoint?: Pick<Checkpoint, "id" | "hash">; batchSize?: number } = {}): Promise<ChainResult> {
  const { checkpoint, batchSize = 1000 } = options;
  if (checkpoint) {
    const row = await db.auditLog.findUnique({ where: { id: BigInt(checkpoint.id) }, select: { hash: true } });
    if (row?.hash !== checkpoint.hash) return { ok: false, checked: 0, brokenAtId: checkpoint.id, reason: "checkpoint" };
  }

  let prevHash = GENESIS_HASH;
  let cursor: bigint | undefined;
  let checked = 0;

  for (;;) {
    const rows = await db.auditLog.findMany({
      where: cursor === undefined ? undefined : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) return { ok: true, checked, lastHash: prevHash };

    const result = checkEntries(rows, prevHash);
    if (!result.ok) return { ...result, checked: checked + result.checked };
    checked += result.checked;
    prevHash = result.lastHash;
    cursor = rows[rows.length - 1].id;
  }
}
