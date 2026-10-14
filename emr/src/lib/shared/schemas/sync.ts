import { z } from "zod";
import { fieldTypes, patientFields, recordSchemas } from "./trip-data";

// Offline fallback (spec: "Offline fallback and sync"). Both files travel
// encrypted (src/server/sealed.ts); these schemas check what's inside before
// anything is written.

const { id, str, instant } = fieldTypes;
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const tripCode = z.string().regex(/^[0-9]{2}_[0-9]{4}(_[A-Za-z0-9]+)?$/);
export const SYNC_BUNDLE_MAX_BYTES = 200 * 1024 * 1024;

// ---------- provisioning: hub -> fallback, before the trip ----------

export const provisionSchema = z.object({
  format: z.literal("hf-emr-provision"),
  formatVersion: z.literal(1),
  createdAt: instant,
  hubNodeId: nodeId,
  users: z
    .array(
      z.object({
        id,
        email: z.string().email().max(254),
        name: z.string().min(1).max(200),
        role: z.enum(["ADMIN", "DOCTOR", "STUDENT"]),
        specialty: z.enum(["DENTIST", "PHYSICIAN", "PEDIATRICIAN"]).nullable(),
        /** argon2id hash, so the same passwords work on the fallback. */
        passwordHash: z.string().startsWith("$argon2id$").max(500),
      }),
    )
    .max(50_000),
  trips: z.array(z.object({ id, code: tripCode, name: z.string().min(1).max(200), month: z.number().int().min(1).max(12), year: z.number().int().min(2000).max(2100), location: z.string().max(200), active: z.boolean() })).max(20_000),
  members: z.array(z.object({ tripId: id, userId: id, enabled: z.boolean() })).max(500_000),
});
export type Provision = z.infer<typeof provisionSchema>;

// ---------- bundle: fallback -> hub, afterwards ----------

const versioned = { version: z.number().int().min(1) };
const owned = { patientId: id };

export const syncPatientSchema = z
  .object({ ...patientFields, tripId: id, ...versioned, deleted: z.boolean() })
  .refine((p) => p.dateOfBirth || p.ageValue !== null, { message: "dobOrAge" })
  .refine((p) => (p.ageValue === null) === (p.ageUnit === null), { message: "agePair" });

export const syncBundleSchema = z
  .object({
    format: z.literal("hf-emr-sync"),
    formatVersion: z.literal(1),
    sourceNodeId: nodeId,
    createdAt: instant,
    since: instant.nullable(),
    /** Every trip the records use, so one created on the fallback can be created on the hub. */
    trips: z.array(z.object({ id, code: tripCode, name: z.string().min(1).max(200), month: z.number().int().min(1).max(12), year: z.number().int().min(2000).max(2100), location: z.string().max(200) })).max(20_000),
    records: z.object({
      patients: z.array(syncPatientSchema).max(20_000),
      conditions: z.array(recordSchemas.condition.extend(owned)).max(100_000),
      vitals: z.array(recordSchemas.vitals.extend(owned)).max(100_000),
      diabetic: z.array(recordSchemas.diabetic.extend(owned)).max(100_000),
      visits: z.array(recordSchemas.visit.extend({ ...owned, ...versioned })).max(100_000),
      medications: z.array(recordSchemas.medication.extend({ ...owned, ...versioned })).max(100_000),
      photos: z
        .array(
          z.object({
            id,
            ...owned,
            kind: z.enum(["PROFILE", "MEDICAL"]),
            category: str(60),
            description: str(300),
            notes: str(2000),
            takenOn: fieldTypes.day,
            originNodeId: nodeId,
            createdById: id,
            createdAt: instant,
            /** The JPEG, base64. Re-checked and re-encoded on import like any upload. */
            data: z.string().max(12_000_000),
          }),
        )
        .max(20_000),
    }),
    /** The fallback's own audit entries, appended to the hub's chain on import. */
    audit: z
      .array(
        z.object({
          id: z.string().regex(/^\d{1,19}$/),
          ts: instant,
          userId: id.nullable(),
          sessionId: id.nullable(),
          action: z.string().min(1).max(60),
          entity: z.string().min(1).max(60),
          entityId: z.string().max(100).nullable(),
          tripId: id.nullable(),
          ip: z.string().max(100).nullable(),
          details: z.unknown(),
          originNodeId: nodeId,
          /** The entry's hash in the laptop's own chain: the first one names the chain. */
          hash: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .max(1_000_000),
  })
  .superRefine((b, ctx) => {
    // One node's records only, and every record's patient is in the bundle.
    const patients = new Set(b.records.patients.map((p) => p.id));
    const seen = new Set<string>();
    for (const [kind, list] of Object.entries(b.records) as [string, { id: string; patientId?: string }[]][]) {
      for (const r of list) {
        if (seen.has(r.id)) return void ctx.addIssue({ code: "custom", path: ["records", kind], message: "duplicateId" });
        seen.add(r.id);
        if (r.patientId && !patients.has(r.patientId)) return void ctx.addIssue({ code: "custom", path: ["records", kind], message: "unknownPatient" });
      }
    }
    const trips = new Set(b.trips.map((t) => t.id));
    if (b.records.patients.some((p) => !trips.has(p.tripId))) ctx.addIssue({ code: "custom", path: ["trips"], message: "unknownTrip" });
  });
export type SyncBundle = z.infer<typeof syncBundleSchema>;
