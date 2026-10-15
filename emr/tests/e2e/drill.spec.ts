import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import pg from "pg";
import { expect, expectNoHorizontalScroll, newDevice, test } from "./fixtures";

// The software half of the field drill (docs/field-drill.md, sections B and F),
// rehearsed with separate browser devices. The drill itself still has to be run
// on the real laptops, phones and network.

const PASSWORD = "dev only password 2026";
const TRIP = "May 2026 Guatemala";

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await newDevice(browser)).newPage();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/trips$/);
  return page;
}

/** A doctor account of its own (same password as the seeded ones), so locking it can't upset other tests. */
async function freshDoctor(): Promise<string> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    const id = randomUUID();
    const email = `drill-${id.slice(0, 8)}@example.org`;
    await client.query(
      `INSERT INTO "User" (id, email, name, role, specialty, status, "updatedAt") VALUES ($1, $2, $3, 'DOCTOR', 'PHYSICIAN', 'ACTIVE', now())`,
      [id, email, `Drill ${id.slice(0, 4)}`],
    );
    await client.query(
      `INSERT INTO "Account" (id, "accountId", "providerId", "userId", password, "updatedAt")
       SELECT $1, $2::text, 'credential', $2::uuid, a.password, now() FROM "Account" a JOIN "User" u ON u.id = a."userId"
       WHERE u.email = 'physician@example.org' AND a."providerId" = 'credential'`,
      [randomUUID(), id],
    );
    return email;
  } finally {
    await client.end();
  }
}

test("three devices at once: a new patient reaches the other devices' lists without reloading", async ({ browser }) => {
  const [watcher, student, doctor] = await Promise.all([
    signedIn(browser, "admin@example.org"),
    signedIn(browser, "student.on@example.com"),
    signedIn(browser, "pediatrician@example.org"),
  ]);
  for (const page of [watcher, student, doctor]) {
    await page.getByRole("link", { name: TRIP }).first().click();
    await page.getByRole("link", { name: "Patients", exact: true }).first().click();
    await expect(page).toHaveURL(/\/patients$/);
  }

  const last = `Drill${Math.random().toString(36).slice(2, 7)}`;
  await student.getByRole("link", { name: "Register patient" }).first().click();
  await student.getByLabel("First name").fill("Ana");
  await student.getByLabel("Last name").fill(last);
  await student.getByLabel("Estimated age").fill("8");
  await student.getByLabel("Sex").selectOption("FEMALE");
  await student.getByLabel("Send to").selectOption("PEDIATRICIAN");
  await student.getByRole("button", { name: "Register patient" }).click();
  await expect(student.getByText(/Patient \d{3}_05_2026 registered\./)).toBeVisible();

  // The others were in use a moment ago, so their lists refresh every 10 seconds.
  for (const page of [watcher, doctor]) {
    await page.mouse.move(10, 10);
    await expect(page.getByRole("link", { name: new RegExp(last) })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
  }
});

test("five wrong passwords lock an account until an admin unlocks it", async ({ browser }) => {
  const email = await freshDoctor();
  const page = await (await newDevice(browser)).newPage();
  for (let i = 0; i < 5; i++) {
    await signIn(page, email, "not the right password");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  }
  // Locked: even the right password is refused, with the same message.
  await signIn(page, email);
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();

  const admin = await signedIn(browser, "admin@example.org");
  await admin.goto("/admin/users");
  const row = admin.getByRole("listitem").filter({ hasText: email });
  await expect(row).toContainText("Locked");
  await row.getByRole("button", { name: "Unlock" }).click();
  await expect(admin.getByText(/can sign in again\./)).toBeVisible();

  await signIn(page, email);
  await expect(page).toHaveURL(/\/trips$/);
});

test("a reset code signs the user out of their other devices", async ({ browser }) => {
  const email = await freshDoctor();
  const phone = await signedIn(browser, email);

  const admin = await signedIn(browser, "admin@example.org");
  await admin.goto("/admin/users");
  await admin.getByRole("listitem").filter({ hasText: email }).getByRole("button", { name: "Reset code" }).click();
  const code = (await admin.getByTestId("reset-code").textContent())!.trim();

  const laptop = await (await newDevice(browser)).newPage();
  await laptop.goto("/reset");
  await laptop.getByLabel("Email").fill(email);
  await laptop.getByLabel("Reset code").fill(code);
  await laptop.getByLabel("New password", { exact: true }).fill("a brand new field password");
  await laptop.getByLabel("Confirm new password").fill("a brand new field password");
  await laptop.getByRole("button", { name: "Set new password" }).click();
  await expect(laptop.getByText(/Your password has been changed/)).toBeVisible();

  // The phone's next click needs the new password.
  await phone.getByRole("link", { name: TRIP }).first().click();
  await expect(phone).toHaveURL(/\/login/);
  await signIn(phone, email);
  await expect(phone.getByText("Email or password is incorrect.")).toBeVisible();
  await signIn(phone, email, "a brand new field password");
  await expect(phone).toHaveURL(/\/trips$/);
});
