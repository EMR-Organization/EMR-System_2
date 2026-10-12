// The permission matrix from the spec ("Roles and permissions"). Shared so the
// UI can hide buttons a user can't use, but hiding is only a convenience:
// src/server/rbac.ts enforces this same table on every service call.

export const PERMISSIONS = [
  "patient.register",
  "patient.read",
  "vitals.write",
  "diabetic.write",
  "condition.write",
  "photo.write",
  "diagnosis.write",
  "medication.write",
  "visit.write",
  "visit.read",
  "search.crossTrip",
  "data.export",
  "trip.members.toggle",
  "trip.create",
  "user.manage",
  "data.import",
  "sync.import",
  "patient.delete",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type RoleName = "ADMIN" | "DOCTOR" | "STUDENT";

/**
 * "trip" = only on trips the student is switched on for. Admins and doctors
 * can reach every trip, so for them "trip" and "all" are the same.
 */
export type Grant = "all" | "trip" | "none";

export const MATRIX: Record<Permission, Record<RoleName, Grant>> = {
  "patient.register": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "patient.read": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "vitals.write": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "diabetic.write": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "condition.write": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "photo.write": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "search.crossTrip": { STUDENT: "trip", DOCTOR: "all", ADMIN: "all" },
  "diagnosis.write": { STUDENT: "none", DOCTOR: "all", ADMIN: "all" },
  "medication.write": { STUDENT: "none", DOCTOR: "all", ADMIN: "all" },
  "visit.write": { STUDENT: "none", DOCTOR: "all", ADMIN: "all" },
  "visit.read": { STUDENT: "none", DOCTOR: "all", ADMIN: "all" },
  "data.export": { STUDENT: "none", DOCTOR: "all", ADMIN: "all" },
  "trip.members.toggle": { STUDENT: "none", DOCTOR: "all", ADMIN: "all" },
  "trip.create": { STUDENT: "none", DOCTOR: "none", ADMIN: "all" },
  "user.manage": { STUDENT: "none", DOCTOR: "none", ADMIN: "all" },
  "data.import": { STUDENT: "none", DOCTOR: "none", ADMIN: "all" },
  "sync.import": { STUDENT: "none", DOCTOR: "none", ADMIN: "all" },
  "patient.delete": { STUDENT: "none", DOCTOR: "none", ADMIN: "all" },
  "audit.read": { STUDENT: "none", DOCTOR: "none", ADMIN: "all" },
};

/** Whether the role has the permission at all (ignoring which trip). For UI only. */
export function roleHas(role: RoleName, permission: Permission): boolean {
  return MATRIX[permission][role] !== "none";
}
