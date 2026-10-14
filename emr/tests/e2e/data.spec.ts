import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, newDevice, test } from "./fixtures";

const PASSWORD = "dev only password 2026";
const TRIP = "May 2026 Guatemala";

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await newDevice(browser)).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return page;
}

test("a returning patient is found from any trip, accents and all", async ({ browser }) => {
  const last = `Búsqueda${Math.random().toString(36).slice(2, 7)}`;
  const doctor = await signedIn(browser, "physician@example.org");
  await doctor.getByRole("link", { name: TRIP }).first().click();
  await doctor.getByRole("link", { name: "Register patient" }).first().click();
  await doctor.getByLabel("First name").fill("Ramón");
  await doctor.getByLabel("Last name").fill(last);
  await doctor.getByLabel("Estimated age").fill("61");
  await doctor.getByLabel("Sex").selectOption("MALE");
  await doctor.getByLabel("Send to").selectOption("PHYSICIAN");
  await doctor.getByRole("button", { name: "Register patient" }).click();
  await expect(doctor.getByText(/registered\./)).toBeVisible();

  await doctor.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
  await doctor.getByLabel("Search patients").fill(`ramon ${last.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()}`);
  await doctor.getByRole("button", { name: "Search" }).click();
  await expect(doctor.getByText("1 patient")).toBeVisible();
  await expectNoHorizontalScroll(doctor);
  await doctor.getByRole("link", { name: new RegExp(`${last}, Ramón`) }).click();
  await expect(doctor.getByRole("heading", { name: new RegExp(`${last}, Ramón`) })).toBeVisible();
});

test("doctors export a trip; admins re-import it without duplicating anything", async ({ browser }) => {
  const doctor = await signedIn(browser, "physician@example.org");
  await doctor.getByRole("link", { name: TRIP }).first().click();
  await doctor.getByRole("link", { name: "Data", exact: true }).click();
  await expectNoHorizontalScroll(doctor);
  await expect(doctor.getByRole("heading", { name: "Import (merge)" })).toHaveCount(0); // admins only

  const csvDownload = doctor.waitForEvent("download");
  await doctor.getByRole("link", { name: "Download CSV" }).click();
  const csv = readFileSync(await (await csvDownload).path(), "utf8");
  expect(csv.startsWith("﻿Patient ID,First Name,Last Name")).toBe(true);

  const jsonDownload = doctor.waitForEvent("download");
  await doctor.getByRole("link", { name: "Download JSON" }).click();
  const jsonPath = await (await jsonDownload).path();
  const exported = JSON.parse(readFileSync(jsonPath, "utf8")) as { patients: unknown[] };

  const admin = await signedIn(browser, "admin@example.org");
  await admin.getByRole("link", { name: TRIP }).first().click();
  await admin.getByRole("link", { name: "Data", exact: true }).click();
  await admin.getByLabel("JSON export file").setInputFiles(jsonPath);
  await admin.getByRole("button", { name: "Check file" }).click();
  await expect(admin.getByText("This import would:")).toBeVisible();
  await expect(admin.getByText(new RegExp(`add 0 patients \\(${exported.patients.length} already here\\)`))).toBeVisible();
  await admin.getByRole("button", { name: "Import", exact: true }).click();
  await expect(admin.getByText("Imported:")).toBeVisible();
});

test("admins verify the audit chain and make a backup", async ({ browser }) => {
  const admin = await signedIn(browser, "admin@example.org");
  await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Backups" }).click();
  await admin.getByRole("button", { name: "Back up now" }).click();
  await expect(admin.getByText("Backup saved.")).toBeVisible();
  await expect(admin.getByText("Latest")).toBeVisible();
  await expectNoHorizontalScroll(admin);

  await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit" }).click();
  await expectNoHorizontalScroll(admin);
  // The newest backup's checkpoint is offered; verifying against it must pass.
  const pick = admin.getByLabel("Checkpoint from a backup");
  await pick.selectOption({ index: 1 });
  await expect(admin.getByLabel("Checkpoint hash")).toHaveValue(/^[0-9a-f]{64}$/);
  await admin.getByRole("button", { name: "Verify chain" }).click();
  await expect(admin.getByText(/The audit log is intact/)).toBeVisible();

  await admin.getByLabel("Action (or prefix, e.g. patient.)").fill("backup.");
  await admin.getByRole("button", { name: "Filter" }).click();
  await expect(admin.getByText("backup.create").first()).toBeVisible();
});

test("students and doctors don't see admin tools", async ({ browser }) => {
  const student = await signedIn(browser, "student.on@example.com");
  const nav = student.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Search" })).toBeVisible();
  for (const name of ["Audit", "Backups", "Users"]) await expect(nav.getByRole("link", { name })).toHaveCount(0);
  for (const url of ["/admin/audit", "/admin/backups"]) {
    await student.goto(url);
    await expect(student.getByText(/not found/i).first()).toBeVisible();
  }
  const response = await student.request.get("/api/backups/emr-20990101-000000-abcdef");
  expect(response.status()).toBe(404);

  const doctor = await signedIn(browser, "dentist@example.org");
  await doctor.goto("/admin/backups");
  await expect(doctor.getByText(/not found/i).first()).toBeVisible();
});
