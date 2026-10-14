import type { Page } from "@playwright/test";
import { Client } from "pg";
import { expect, test } from "./fixtures";

// The 30-minute idle sign-out must hold even on pages that refresh themselves.
const PASSWORD = "dev only password 2026";

async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * This browser's own session (by its cookie token). The desktop and phone runs
 * use the same accounts at the same time, so "the user's sessions" would mix
 * them up.
 */
async function sessionToken(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name.endsWith("session_token"));
  if (!cookie) throw new Error("no session cookie");
  return decodeURIComponent(cookie.value).split(".")[0];
}

const idleMinutes = (token: string) =>
  db(async (c) => {
    const r = await c.query(`SELECT extract(epoch FROM now() - "updatedAt") / 60 AS m FROM "Session" WHERE token = $1`, [token]);
    return Number(r.rows[0].m);
  });

async function openPatientList(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByRole("link", { name: "May 2026 Guatemala" }).first().click();
  await page.getByRole("navigation", { name: "May 2026 Guatemala" }).getByRole("link", { name: "Patients", exact: true }).click();
  await expect(page).toHaveURL(/\/patients$/);
}

test("an unattended patient list doesn't keep the session alive", async ({ page }) => {
  test.setTimeout(60_000);
  const email = "pediatrician@example.org";
  await page.clock.install();
  await openPatientList(page, email);

  // Nobody touches the device for 3 minutes: auto-refresh must stop.
  await page.clock.fastForward("03:00");
  const token = await sessionToken(page);
  const { rowCount } = await db((c) => c.query(`UPDATE "Session" SET "updatedAt" = now() - interval '29 minutes' WHERE token = $1`, [token]));
  expect(rowCount).toBe(1);
  // Let time run for real (Next's own timers need it) through at least one refresh tick.
  await page.clock.resume();
  await page.waitForTimeout(12_000);
  expect(await idleMinutes(token)).toBeGreaterThan(28);
});

test("after 30 idle minutes the browser signs out for real", async ({ page }) => {
  const email = "dentist@example.org";
  await page.clock.install();
  await openPatientList(page, email);
  const listUrl = page.url();

  await page.clock.fastForward("25:30");
  await expect(page.getByText("Still there?")).toBeVisible();
  await page.clock.fastForward("05:00");
  await expect(page).toHaveURL(/\/login/);

  // The session is gone on the server, so going back doesn't show the list.
  await page.goto(listUrl);
  await expect(page).toHaveURL(/\/login/);
});

test("past trips are read-only for doctors, with a notice", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("physician@example.org");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "November 2025 Guatemala" }).first().click();
  await expect(page.getByText(/This trip is marked as past/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
  await page.goto(page.url() + "/patients/new");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
