import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { appClient, ownerClient, uniqueTripCode } from "./helpers";

// These prove the database itself enforces the rules, so a bug (or attacker)
// in the app can't get around them.

let app: Client;
let owner: Client;
let auditId: string;
let tripId: string;
let patientId: string;

beforeAll(async () => {
  app = await appClient();
  owner = await ownerClient();

  // A real, correctly chained entry, written the way the app writes them.
  const action = `test.write.${randomUUID()}`;
  await db.$transaction((tx) => audit(tx, null, { action, entity: "Test" }));
  auditId = (await db.auditLog.findFirstOrThrow({ where: { action } })).id.toString();

  tripId = randomUUID();
  await app.query(
    `INSERT INTO "Trip" (id, code, name, month, year, location, "updatedAt")
     VALUES ($1,$2,'Test trip',1,2099,'Testland',now())`,
    [tripId, uniqueTripCode()],
  );
  patientId = randomUUID();
  await app.query(
    `INSERT INTO "Patient" (id,"tripId","displayNumber","firstName","lastName","ageValue","ageUnit",gender,
       "assignedSpecialty","originNodeId","createdById","updatedAt")
     VALUES ($1,$2,1,'Test','Patient',30,'YEARS','OTHER','PHYSICIAN','test',$3,now())`,
    [patientId, tripId, randomUUID()],
  );
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await db.$disconnect();
});

describe("emr_app role", () => {
  it("can read and append to the audit log", async () => {
    const res = await app.query(`SELECT id FROM "AuditLog" WHERE id = $1`, [auditId]);
    expect(res.rowCount).toBe(1);
  });

  it("cannot update audit entries", async () => {
    await expect(app.query(`UPDATE "AuditLog" SET action = 'x' WHERE id = $1`, [auditId])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cannot delete or truncate audit entries", async () => {
    await expect(app.query(`DELETE FROM "AuditLog" WHERE id = $1`, [auditId])).rejects.toThrow(/permission denied/);
    await expect(app.query(`TRUNCATE "AuditLog"`)).rejects.toThrow(/permission denied/);
  });

  it("cannot hard-delete patients or trips", async () => {
    await expect(app.query(`DELETE FROM "Patient" WHERE id = $1`, [patientId])).rejects.toThrow(/permission denied/);
    await expect(app.query(`DELETE FROM "Trip" WHERE id = $1`, [tripId])).rejects.toThrow(/permission denied/);
  });

  it("cannot read or change migration history", async () => {
    await expect(app.query(`SELECT * FROM "_prisma_migrations"`)).rejects.toThrow(/permission denied/);
  });

  it("cannot change the schema or create roles", async () => {
    await expect(app.query(`ALTER TABLE "AuditLog" DISABLE TRIGGER ALL`)).rejects.toThrow(/must be owner/);
    await expect(app.query(`CREATE ROLE sneaky`)).rejects.toThrow(/permission denied/);
  });
});

describe("audit log trigger", () => {
  it("blocks updates and deletes even for the owner", async () => {
    await expect(owner.query(`UPDATE "AuditLog" SET action = 'x' WHERE id = $1`, [auditId])).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.query(`DELETE FROM "AuditLog" WHERE id = $1`, [auditId])).rejects.toThrow(/append-only/);
  });
});

describe("constraints", () => {
  it("rejects a duplicate patient number in the same trip", async () => {
    await expect(
      app.query(
        `INSERT INTO "Patient" (id,"tripId","displayNumber","firstName","lastName","ageValue","ageUnit",gender,
           "assignedSpecialty","originNodeId","createdById","updatedAt")
         VALUES ($1,$2,1,'Dup','Patient',30,'YEARS','OTHER','PHYSICIAN','test',$3,now())`,
        [randomUUID(), tripId, randomUUID()],
      ),
    ).rejects.toThrow(/Patient_tripId_displayNumber_key/);
  });

  it("allows only one trip visit per patient", async () => {
    const insertVisit = (tripVisit: boolean | null) =>
      app.query(
        `INSERT INTO "Visit" (id,"patientId","tripVisit","visitType",date,"originNodeId","createdById","updatedAt")
         VALUES ($1,$2,$3,'Trip Visit',current_date,'test',$4,now())`,
        [randomUUID(), patientId, tripVisit, randomUUID()],
      );
    await insertVisit(true);
    await expect(insertVisit(true)).rejects.toThrow(/Visit_patientId_tripVisit_key/);
    await expect(insertVisit(false)).rejects.toThrow(/Visit_tripVisit_true_or_null/);
    await insertVisit(null);
    await insertVisit(null);
  });

  it("rejects uppercase emails and specialties on non-doctors", async () => {
    await expect(
      app.query(`INSERT INTO "User" (id,email,name,"updatedAt") VALUES ($1,'Mixed@Example.org','X',now())`, [
        randomUUID(),
      ]),
    ).rejects.toThrow(/User_email_lowercase/);
    await expect(
      app.query(
        `INSERT INTO "User" (id,email,name,role,specialty,"updatedAt") VALUES ($1,$2,'X','STUDENT','DENTIST',now())`,
        [randomUUID(), `s-${randomUUID()}@example.org`],
      ),
    ).rejects.toThrow(/User_specialty_doctor_only/);
  });
});
