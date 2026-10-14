import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import pg from "pg";
import { expect, expectNoHorizontalScroll, newDevice, test } from "./fixtures";

const PASSWORD = "dev only password 2026";

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await newDevice(browser)).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return page;
}

/**
 * Queues a conflict on a seeded patient, as an import would when the hub and a
 * laptop both changed the address (the import itself is covered by the
 * integration tests, which run two real databases).
 */
async function queueAddressConflict(
  newAddress: string,
  laptop: { gender?: string; changeWaterSource?: boolean } = {},
): Promise<{ patientId: string; conflictId: string }> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT p.* FROM "Patient" p JOIN "Trip" t ON t.id = p."tripId" WHERE t.code = '05_2026' AND p."deletedAt" IS NULL ORDER BY p."displayNumber" LIMIT 1`,
    );
    const p = rows[0];
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const incoming = {
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: day(p.dateOfBirth),
      ageValue: p.ageValue,
      ageUnit: p.ageUnit,
      gender: laptop.gender ?? p.gender,
      phone: p.phone,
      address: newAddress,
      emergencyContact: p.emergencyContact,
      // Well Water on one side or the other.
      waterSource: laptop.changeWaterSource ? (p.waterSource === "Well Water" ? "River/Stream" : "Well Water") : p.waterSource,
      waterRiskRating: p.waterRiskRating,
      waterHistory: p.waterHistory,
      waterNotes: p.waterNotes,
      assignedSpecialty: p.assignedSpecialty,
      deleted: false,
    };
    const conflictId = randomUUID();
    await client.query(
      `INSERT INTO "SyncConflict" (id, entity, "entityId", "hubVersion", incoming, "incomingHash", "sourceNodeId") VALUES ($1, 'Patient', $2, $3, $4, $5, 'fallback-e2e')`,
      [conflictId, p.id, p.version, JSON.stringify(incoming), randomBytes(32).toString("hex")],
    );
    return { patientId: p.id, conflictId };
  } finally {
    await client.end();
  }
}

test("admins see sync, resolve a conflict field by field, and bad files are refused", async ({ browser }) => {
  const address = `Laptop road ${randomBytes(3).toString("hex")}`;
  const { patientId, conflictId } = await queueAddressConflict(address);

  const admin = await signedIn(browser, "admin@example.org");
  await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sync" }).click();
  await expectNoHorizontalScroll(admin);

  const notABundle = path.join(tmpdir(), `not-a-bundle-${Date.now()}.hfsync`);
  writeFileSync(notABundle, "just some text");
  await admin.getByLabel("Bundle file (.hfsync)").setInputFiles(notABundle);
  await admin.getByRole("button", { name: "Check bundle" }).click();
  await expect(admin.getByText("That isn't a sync bundle from a fallback laptop.")).toBeVisible();

  // The queue lives on its own page (doctors use it too); the Sync page links to it.
  await admin.getByRole("link", { name: /Resolve \d+ conflicts?/ }).click();
  await expect(admin).toHaveURL(/\/conflicts$/);
  // Its own conflict (desktop and phone runs each queue one at the same time).
  const link = admin.locator(`a[href="/conflicts/${conflictId}"]`);
  await expect(link).toContainText("from fallback-e2e: Address");
  await link.click();
  await expect(admin.getByRole("heading", { name: "Conflict: Patient details" })).toBeVisible();
  await expectNoHorizontalScroll(admin);
  await admin.getByRole("radio", { name: new RegExp(address) }).check();
  await admin.getByRole("button", { name: "Save choices" }).click();
  await expect(admin.getByText("Conflict resolved.")).toBeVisible();
  await expect(admin).toHaveURL(/\/conflicts\?resolved=1$/);

  await admin.goto(`/patients/${patientId}`);
  await expect(admin.getByText(address)).toBeVisible();
});

test("doctors resolve conflicts but can't import bundles", async ({ browser }) => {
  const address = `Laptop lane ${randomBytes(3).toString("hex")}`;
  const { patientId, conflictId } = await queueAddressConflict(address);

  const doctor = await signedIn(browser, "physician@example.org");
  const nav = doctor.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Sync" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Conflicts" }).click();
  await expectNoHorizontalScroll(doctor);
  await doctor.locator(`a[href="/conflicts/${conflictId}"]`).click();
  await doctor.getByRole("radio", { name: new RegExp(address) }).check();
  await doctor.getByRole("button", { name: "Save choices" }).click();
  await expect(doctor.getByText("Conflict resolved.")).toBeVisible();
  await doctor.goto(`/patients/${patientId}`);
  await expect(doctor.getByText(address)).toBeVisible();

  // Importing stays admin-only: no page, no form, and the upload is refused.
  await doctor.goto("/admin/sync");
  await expect(doctor.getByText(/not found/i).first()).toBeVisible();
  await expect(doctor.getByRole("button", { name: "Check bundle" })).toHaveCount(0);
  const response = await doctor.request.post("/api/sync/import", { multipart: { file: { name: "x.hfsync", mimeType: "application/octet-stream", buffer: Buffer.from("x") } } });
  expect([403, 404]).toContain(response.status());
});

test("a Spanish-speaking doctor sees both sides of a conflict in Spanish", async ({ browser }) => {
  const address = `Camino ${randomBytes(3).toString("hex")}`;
  const { conflictId } = await queueAddressConflict(address, { gender: "OTHER", changeWaterSource: true });

  const doctor = await (await newDevice(browser, { locale: "es-GT" })).newPage();
  await doctor.goto("/login");
  await doctor.getByLabel("Correo electrónico").fill("physician@example.org");
  await doctor.getByLabel("Contraseña").fill(PASSWORD);
  await doctor.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(doctor).toHaveURL(/\/trips$/);
  await doctor.goto(`/conflicts/${conflictId}`);
  await expectNoHorizontalScroll(doctor);
  // Stored codes and list values (OTHER, Well Water) shown in the reader's language.
  await expect(doctor.getByRole("radio", { name: /Otro/ })).toBeVisible();
  await expect(doctor.getByRole("radio", { name: /Agua de pozo/ })).toBeVisible();
  await expect(doctor.getByText("OTHER", { exact: true })).toHaveCount(0);
  await doctor.getByRole("button", { name: "Guardar opciones" }).click();
  await expect(doctor.getByText("Conflicto resuelto.")).toBeVisible();
});

test("students don't see conflicts", async ({ browser }) => {
  const student = await signedIn(browser, "student.on@example.com");
  await expect(student.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Conflicts" })).toHaveCount(0);
  await student.goto("/conflicts");
  await expect(student.getByText(/not found/i).first()).toBeVisible();
});
