import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { verifyChain } from "@/server/audit";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import * as hubPatients from "@/server/services/patients";
import { searchPatients } from "@/server/services/search";
import { getConflict, importSyncFile, listConflicts, resolveConflict } from "@/server/services/sync";
import { signIn } from "@/server/services/users";
import { buildBundleFile } from "@/server/sync/export";
import { buildProvisionFile } from "@/server/sync/provision";
import { browser } from "./fake-request";
import { createTrip, createUser } from "./fixtures";

// The whole fallback story against two real databases: the test database is
// the hub, and a throwaway database (migrated like a fresh install) is a
// fallback laptop. Code "on the fallback" runs through freshly imported
// modules with that laptop's DATABASE_URL, NODE_ID and photo folder, so it's
// the real services, signed in with the provisioned account.

// A new name per run: the hub (the shared test database) remembers nodes it has synced with.
const FALLBACK_NODE = `fallback-${Date.now().toString(36)}`;
const fallbackDb = `emr_fallback_${Date.now()}`;
const reinstalledDb = `${fallbackDb}_b`;
const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};
const maintenance = () => new pg.Client({ connectionString: withDb(process.env.DATABASE_OWNER_URL!, "postgres") });
const fallbackPhotos = mkdtempSync(path.join(tmpdir(), "emr-fallback-photos-"));

/** A fresh, migrated database, like a newly set-up laptop. */
async function freshDatabase(name: string) {
  const admin = maintenance();
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_OWNER_URL: withDb(process.env.DATABASE_OWNER_URL!, name) },
    encoding: "utf8",
  });
  if (migrate.status !== 0) throw new Error(`migrate failed for ${name}: ${migrate.stderr}`);
}

beforeAll(() => freshDatabase(fallbackDb), 120_000);

afterAll(async () => {
  const admin = maintenance();
  await admin.connect();
  for (const name of [fallbackDb, reinstalledDb]) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

async function signInAs(user: { email: string; password: string }) {
  browser.reset();
  await signIn({ email: user.email, password: user.password });
}

/** Runs `fn` as the fallback laptop: its database, NODE_ID and photos, with fresh module instances. */
async function onFallback<T>(
  fn: (m: {
    users: typeof import("@/server/services/users");
    patients: typeof import("@/server/services/patients");
    vitals: typeof import("@/server/services/vitals");
    visits: typeof import("@/server/services/visits");
    medications: typeof import("@/server/services/medications");
    photos: typeof import("@/server/services/photos");
    provision: typeof import("@/server/sync/provision");
    exporter: typeof import("@/server/sync/export");
    signInAs: (u: { email: string; password: string }) => Promise<void>;
  }) => Promise<T>,
  database = fallbackDb,
): Promise<T> {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, NODE_ID: process.env.NODE_ID, PHOTOS_DIR: process.env.PHOTOS_DIR };
  const g = globalThis as { db?: { $disconnect(): Promise<void> } };
  const hubClient = g.db;
  vi.resetModules();
  g.db = undefined; // so the fresh db module connects to the fallback's database
  process.env.DATABASE_URL = withDb(saved.DATABASE_URL!, database);
  process.env.NODE_ID = FALLBACK_NODE;
  process.env.PHOTOS_DIR = fallbackPhotos;
  try {
    const fake = await import("./fake-request");
    const users = await import("@/server/services/users");
    const { resetRateLimits: reset } = await import("@/server/auth/rate-limit");
    return await fn({
      users,
      patients: await import("@/server/services/patients"),
      vitals: await import("@/server/services/vitals"),
      visits: await import("@/server/services/visits"),
      medications: await import("@/server/services/medications"),
      photos: await import("@/server/services/photos"),
      provision: await import("@/server/sync/provision"),
      exporter: await import("@/server/sync/export"),
      signInAs: async (u) => {
        fake.browser.reset();
        reset();
        await users.signIn({ email: u.email, password: u.password });
      },
    });
  } finally {
    await (globalThis as { db?: { $disconnect(): Promise<void> } }).db?.$disconnect();
    Object.assign(process.env, saved);
    g.db = hubClient;
    vi.resetModules();
  }
}

const blob = (file: Buffer) => new Blob([new Uint8Array(file)]);
const jpeg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a7" } }).jpeg().toBuffer();
const demographics = { firstName: "Lucía", lastName: "Fallback", gender: "FEMALE", assignedSpecialty: "PHYSICIAN", ageValue: 34, ageUnit: "YEARS" };

describe("offline fallback and sync", async () => {
  const trip = await createTrip();
  const doctor = await createUser();
  const admin = await createUser({ role: "ADMIN", specialty: null });
  const disabled = await createUser({ status: "DISABLED" });
  let patientId = "";
  let fallbackLabel = "";
  let firstBundle: Buffer;

  it("provisions a fallback: the same logins work there, and its numbers start at 5001", async () => {
    const { file } = await buildProvisionFile();
    const loaded = await onFallback(async (m) => {
      const result = await m.provision.loadProvisionFile(file, { firstNumber: 5001 });
      await m.signInAs(doctor);
      const p = await m.patients.registerPatient({ tripId: trip.id, ...demographics });
      patientId = p.id;
      fallbackLabel = p.label;
      await m.vitals.addVitals({ patientId: p.id, bpSystolic: 128, bpDiastolic: 84 });
      await m.visits.recordDiagnosis({ patientId: p.id, version: 1, diagnosis: "Migraine" });
      await m.medications.prescribe({ patientId: p.id, name: "Ibuprofen", dosage: "400 mg", frequency: "Three times daily" });
      await m.photos.uploadPhoto({ patientId: p.id, kind: "MEDICAL" }, blob(await jpeg()));
      // An account that's disabled on the hub can't sign in on the fallback.
      await expect(m.signInAs(disabled)).rejects.toThrow();
      firstBundle = (await m.exporter.buildBundleFile()).file;
      return result;
    });
    expect(loaded.users).toBeGreaterThan(0);
    expect(fallbackLabel).toMatch(/^5001_/);
  }, 60_000);

  it("imports a bundle: dry run first, then new records as-is with a hub number, photos and audit entries", async () => {
    await signInAs(admin);
    const preview = await importSyncFile({ dryRun: "true" }, blob(firstBundle));
    expect(preview).toMatchObject({ dryRun: true, sourceNodeId: FALLBACK_NODE, patientsAdded: 1, conflicts: 0 });
    expect(await db.patient.findUnique({ where: { id: patientId } })).toBeNull();

    const before = await db.auditLog.count();
    const done = await importSyncFile({ dryRun: "false" }, blob(firstBundle));
    expect(done).toMatchObject({ dryRun: false, patientsAdded: 1, recordsAdded: { vitals: 1, visits: 1, medications: 1, photos: 1 }, conflicts: 0, skipped: [] });
    expect(done.auditAppended).toBeGreaterThan(5);

    const p = await db.patient.findUniqueOrThrow({ where: { id: patientId }, include: { visits: true, medications: true, photos: true, vitals: true } });
    expect(p).toMatchObject({ firstName: "Lucía", originLabel: fallbackLabel, originNodeId: FALLBACK_NODE });
    expect(p.displayNumber).toBeLessThan(5001); // the hub's own next number
    expect(p.visits.find((v) => v.tripVisit)).toMatchObject({ diagnosis: "Migraine", specialty: "PHYSICIAN" });
    expect(p.medications[0].visitId).toBe(p.visits.find((v) => v.tripVisit)!.id);
    expect(readdirSync(process.env.PHOTOS_DIR!)).toContain(p.photos[0].filePath);

    // The fallback's entries joined the hub's chain with their original node and time.
    const appended = await db.auditLog.findMany({ where: { originNodeId: FALLBACK_NODE, action: "patient.create" } });
    expect(appended.map((a) => a.entityId)).toContain(patientId);
    expect(await db.auditLog.count()).toBeGreaterThan(before + done.auditAppended);
    expect((await verifyChain()).ok).toBe(true);

    // Paper notes carry the fallback number: search finds it.
    expect((await searchPatients({ q: fallbackLabel })).results.map((r) => r.id)).toContain(patientId);
  });

  it("importing the same bundle again changes nothing", async () => {
    await signInAs(admin);
    const counts = async () => ({ audit: await db.auditLog.count({ where: { originNodeId: FALLBACK_NODE } }), patients: await db.patient.count({ where: { tripId: trip.id } }) });
    const before = await counts();
    const again = await importSyncFile({ dryRun: "false" }, blob(firstBundle));
    expect(again).toMatchObject({ patientsAdded: 0, applied: 0, conflicts: 0, auditAppended: 0, recordsAdded: { vitals: 0, visits: 0, medications: 0, photos: 0 } });
    expect(await counts()).toEqual(before);
  });

  it("an edit made only on the fallback is applied; one made on both sides is queued", async () => {
    // 1. Only the fallback changes the phone number.
    const second = await onFallback(async (m) => {
      await m.signInAs(doctor);
      await m.patients.updatePatient({ patientId, version: 1, ...demographics, phone: "555-0123" });
      return (await m.exporter.buildBundleFile()).file;
    });
    await signInAs(admin);
    expect(await importSyncFile({ dryRun: "false" }, blob(second))).toMatchObject({ applied: 1, conflicts: 0 });
    const afterApply = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(afterApply.phone).toBe("555-0123");

    // 2. Both sides change the address.
    await signInAs(doctor);
    await hubPatients.updatePatient({ patientId, version: afterApply.version, ...demographics, phone: "555-0123", address: "Hub street 1" });
    const third = await onFallback(async (m) => {
      await m.signInAs(doctor);
      await m.patients.updatePatient({ patientId, version: 2, ...demographics, phone: "555-0123", address: "Fallback road 9" });
      return (await m.exporter.buildBundleFile()).file;
    });
    await signInAs(admin);
    expect(await importSyncFile({ dryRun: "false" }, blob(third))).toMatchObject({ applied: 0, conflicts: 1 });
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).address).toBe("Hub street 1"); // nothing overwritten
    expect(await importSyncFile({ dryRun: "false" }, blob(third))).toMatchObject({ conflicts: 0 }); // not queued twice

    const [item] = (await listConflicts()).filter((c) => c.patient?.id === patientId);
    expect(item).toMatchObject({ entity: "Patient", sourceNodeId: FALLBACK_NODE, fields: ["address"] });
    const conflict = await getConflict(item.id);
    expect(conflict.fields).toEqual([{ field: "address", hub: "Hub street 1", incoming: "Fallback road 9" }]);

    // 3. Resolved field by field; a stale screen (old version) is refused.
    await expect(resolveConflict({ conflictId: item.id, hubVersion: conflict.hubVersion - 1, choices: { address: "incoming" } })).rejects.toMatchObject({
      messageKey: "syncChanged",
    });
    await expect(resolveConflict({ conflictId: item.id, hubVersion: conflict.hubVersion, choices: { address: "incoming" } })).resolves.toEqual({
      status: "TOOK_INCOMING",
    });
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).address).toBe("Fallback road 9");
    expect((await listConflicts()).some((c) => c.id === item.id)).toBe(false);
    await expect(resolveConflict({ conflictId: item.id, hubVersion: conflict.hubVersion + 1, choices: {} })).rejects.toMatchObject({ messageKey: "syncResolved" });

    // 4. Re-importing the bundle after resolving doesn't bring the conflict back.
    expect(await importSyncFile({ dryRun: "false" }, blob(third))).toMatchObject({ conflicts: 0, applied: 0 });

    // 5. A change made only on the hub afterwards stays when an older bundle arrives.
    await signInAs(doctor);
    const current = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    await hubPatients.updatePatient({ patientId, version: current.version, ...demographics, phone: "555-0123", address: "Fallback road 9", emergencyContact: "Hub only" });
    await signInAs(admin);
    expect(await importSyncFile({ dryRun: "false" }, blob(third))).toMatchObject({ conflicts: 0, applied: 0 });
    expect((await db.patient.findUniqueOrThrow({ where: { id: patientId } })).emergencyContact).toBe("Hub only");
    expect((await verifyChain()).ok).toBe(true);
  }, 60_000);

  it("a laptop reinstalled with the same NODE_ID: its new audit log is added; old bundles still add nothing", async () => {
    await freshDatabase(reinstalledDb);
    const { file } = await buildProvisionFile();
    const bundle = await onFallback(async (m) => {
      await m.provision.loadProvisionFile(file);
      await m.signInAs(doctor);
      await m.patients.registerPatient({ tripId: trip.id, ...demographics, firstName: "Reinstalled" });
      return (await m.exporter.buildBundleFile()).file;
    }, reinstalledDb);
    await signInAs(admin);
    const result = await importSyncFile({ dryRun: "false" }, blob(bundle));
    expect(result.patientsAdded).toBe(1);
    expect(result.auditAppended).toBeGreaterThan(0); // not skipped because its IDs restarted at 1
    expect(result.skipped.join()).toMatch(/audit log starts over/);
    // The pre-reinstall bundle (e.g. still on a USB stick) adds nothing.
    expect(await importSyncFile({ dryRun: "false" }, blob(firstBundle))).toMatchObject({ auditAppended: 0, patientsAdded: 0, applied: 0, conflicts: 0 });
    expect((await verifyChain()).ok).toBe(true);
  }, 120_000);

  it("rejects tampered, wrong-kind, foreign and own files", async () => {
    await signInAs(admin);
    const tampered = Buffer.from(firstBundle);
    tampered[tampered.length - 40] ^= 0x01;
    await expect(importSyncFile({ dryRun: "true" }, blob(tampered))).rejects.toMatchObject({ fieldErrors: { file: ["syncDamaged"] } });
    await expect(importSyncFile({ dryRun: "true" }, blob((await buildProvisionFile()).file))).rejects.toMatchObject({ fieldErrors: { file: ["syncWrongKind"] } });
    await expect(importSyncFile({ dryRun: "true" }, new Blob(["{}"]))).rejects.toMatchObject({ fieldErrors: { file: ["syncNotOurs"] } });

    const key = process.env.SYNC_KEY;
    vi.resetModules();
    process.env.SYNC_KEY = "another-deployments-sync-key-0123456789abcdef";
    try {
      const { seal } = await import("@/server/sealed");
      await expect(importSyncFile({ dryRun: "true" }, blob(seal("bundle", Buffer.from("{}"))))).rejects.toMatchObject({ fieldErrors: { file: ["syncWrongKey"] } });
    } finally {
      process.env.SYNC_KEY = key;
      vi.resetModules();
    }
    // The hub's own export can't be imported back into it.
    await expect(importSyncFile({ dryRun: "true" }, blob((await buildBundleFile()).file))).rejects.toMatchObject({ fieldErrors: { file: ["syncOwnNode"] } });
  });

  it("is for admins only", async () => {
    await signInAs(doctor);
    await expect(importSyncFile({ dryRun: "true" }, blob(firstBundle))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listConflicts()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resolveConflict({ conflictId: crypto.randomUUID(), hubVersion: 1, choices: {} })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importSyncFile({ dryRun: "true" }, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("two imports of the same new bundle at once: one adds it, the other finds it there", async () => {
    const file = await onFallback(async (m) => {
      await m.signInAs(doctor);
      await m.patients.registerPatient({ tripId: trip.id, ...demographics, firstName: "Paralela" });
      return (await m.exporter.buildBundleFile()).file;
    });
    await signInAs(admin);
    const [a, b] = await Promise.all([importSyncFile({ dryRun: "false" }, blob(file)), importSyncFile({ dryRun: "false" }, blob(file))]);
    expect(a.patientsAdded + b.patientsAdded).toBe(1);
  }, 60_000);

  it("refreshing the provisioning file mirrors the hub's accounts: disabled ones are signed out, the hub's wins an email clash", async () => {
    const leaver = await createUser();
    const newcomer = await createUser();
    const first = (await buildProvisionFile()).file;
    await onFallback(async (m) => {
      await m.provision.loadProvisionFile(first);
      await m.signInAs(leaver);
      // A local account (say, made with create-admin on the laptop) with an email the hub is about to use.
      const { db: fallback } = await import("@/server/db");
      await fallback.user.delete({ where: { id: newcomer.id } });
      await fallback.user.create({ data: { email: newcomer.email, name: "Local", role: "ADMIN", status: "ACTIVE" } });
    });

    await db.user.update({ where: { id: leaver.id }, data: { status: "DISABLED" } });
    const second = (await buildProvisionFile()).file;
    await onFallback(async (m) => {
      const result = await m.provision.loadProvisionFile(second);
      const { db: fallback } = await import("@/server/db");
      expect(result.disabled).toBeGreaterThanOrEqual(2); // the leaver and the replaced local account
      expect(await fallback.session.count({ where: { userId: leaver.id } })).toBe(0);
      expect(await m.users.signIn({ email: leaver.email, password: leaver.password })).toEqual({ status: "DISABLED" });
      expect(await m.users.signIn({ email: newcomer.email, password: newcomer.password })).toEqual({ status: "ACTIVE" });
      expect((await fallback.user.findUniqueOrThrow({ where: { email: newcomer.email } })).id).toBe(newcomer.id);
    });
  }, 60_000);
});
