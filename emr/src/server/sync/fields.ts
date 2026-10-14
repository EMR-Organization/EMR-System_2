import "server-only";
import { createHash } from "node:crypto";

// What counts as a record's content when the hub compares its copy with a
// fallback's: the fields people edit, in a fixed order and a fixed form
// (dates as YYYY-MM-DD, a deleted patient as deleted: true). Numbers, IDs and
// bookkeeping (version, updatedAt, who) aren't content.

export const EDITABLE = {
  Patient: [
    "firstName",
    "lastName",
    "dateOfBirth",
    "ageValue",
    "ageUnit",
    "gender",
    "phone",
    "address",
    "emergencyContact",
    "waterSource",
    "waterRiskRating",
    "waterHistory",
    "waterNotes",
    "assignedSpecialty",
    "deleted",
  ],
  Visit: ["visitType", "date", "chiefComplaint", "symptoms", "diagnosis", "treatment", "specialty", "followUpDate", "notes"],
  Medication: ["name", "dosage", "frequency", "route", "startDate", "endDate", "prescribedFor", "instructions", "notes", "status", "discontinueReason"],
} as const;

export type SyncEntity = keyof typeof EDITABLE;
export type Content = Record<string, string | number | boolean | string[] | null>;

const DATE_FIELDS = new Set(["dateOfBirth", "date", "followUpDate", "startDate", "endDate"]);

/** A database row (or bundle record) reduced to its editable content. */
export function contentOf(entity: SyncEntity, row: Record<string, unknown>): Content {
  const out: Content = {};
  for (const field of EDITABLE[entity]) {
    let v = field === "deleted" ? ("deleted" in row ? row.deleted : row.deletedAt != null) : row[field];
    if (v instanceof Date) v = DATE_FIELDS.has(field) ? v.toISOString().slice(0, 10) : v.toISOString();
    if (v === undefined || v === "") v = null;
    out[field] = v as Content[string];
  }
  return out;
}

export function contentHash(content: Content): string {
  return createHash("sha256").update(JSON.stringify(Object.keys(content).map((k) => [k, content[k]]))).digest("hex");
}

/** Content back to column values for an update (dates as Date, deleted as deletedAt). */
export function toColumns(entity: SyncEntity, content: Content, current: { deletedAt?: Date | null }): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of EDITABLE[entity]) {
    const v = content[field];
    if (field === "deleted") data.deletedAt = v ? (current.deletedAt ?? new Date()) : null;
    else if (DATE_FIELDS.has(field)) data[field] = typeof v === "string" ? new Date(`${v}T00:00:00Z`) : null;
    else if (field === "waterHistory") data[field] = v ?? [];
    else data[field] = v;
  }
  return data;
}
