import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import pg from "pg";
import { expect, newDevice, test } from "./fixtures";

// Every page, as the people who use it, on desktop and phone (the two
// Playwright projects), in English and Spanish: no WCAG 2.2 AA problems axe can
// find, nothing wider than the screen, a title of its own, and (on touch
// screens) controls big enough for a thumb.

const PASSWORD = "dev only password 2026";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function ids(): Promise<{ tripId: string; patientId: string; conflictId: string | null }> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  try {
    const trip = await client.query(`SELECT id FROM "Trip" WHERE code = '05_2026'`);
    const patient = await client.query(
      `SELECT p.id FROM "Patient" p WHERE p."tripId" = $1 AND p."deletedAt" IS NULL ORDER BY p."displayNumber" LIMIT 1`,
      [trip.rows[0].id],
    );
    const conflict = await client.query(`SELECT id FROM "SyncConflict" WHERE "resolvedAt" IS NULL LIMIT 1`);
    return { tripId: trip.rows[0].id, patientId: patient.rows[0].id, conflictId: conflict.rows[0]?.id ?? null };
  } finally {
    await client.end();
  }
}

async function device(browser: Browser, locale: string, email?: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await newDevice(browser, { locale, ...(viewport && { viewport }) })).newPage();
  if (email) {
    await page.goto("/login");
    await page.locator("input[name=email]").fill(email);
    await page.locator("input[name=password]").fill(PASSWORD);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(email.startsWith("pending") ? /\/pending/ : /\/trips$/);
  }
  return page;
}

/** Problems on the page as it is now, as short readable lines. */
async function problems(page: Page): Promise<string[]> {
  const found: string[] = [];
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  for (const v of results.violations) {
    for (const node of v.nodes) found.push(`${v.id} (${v.impact}): ${node.target.join(" ")}: ${node.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) found.push(`wider than the screen by ${overflow}px`);
  const title = await page.title();
  if (!title.includes(" · ")) found.push(`no title of its own ("${title}")`);
  // WCAG asks for 24px; a thumb in a busy clinic needs more. Checkboxes and
  // radios sit inside a label that is itself the target, so they only need 20.
  const small = await page.evaluate(() =>
    matchMedia("(pointer: coarse)").matches
      ? [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea")]
          .filter((el) => el.offsetParent !== null && !el.closest(".sr-only"))
          .map((el) => {
            const r = el.getBoundingClientRect();
            const box = el.matches("[type=checkbox], [type=radio]") ? 20 : 40;
            return r.height < box ? `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("name") || "").trim().slice(0, 30)}" is ${Math.round(r.height)}px tall` : null;
          })
          .filter((x): x is string => x !== null)
      : [],
  );
  found.push(...small);
  return found;
}

for (const locale of ["en", "es"]) {
  test(`every page is accessible (${locale})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { tripId, patientId, conflictId } = await ids();
    const patient = `/patients/${patientId}`;
    const pages: [string | undefined, string[]][] = [
      [undefined, ["/login", "/register", "/reset", "/setup"]],
      ["pending.doctor@example.org", ["/pending?status=PENDING"]],
      [
        "admin@example.org",
        [
          "/trips",
          `/trips/${tripId}`,
          `/trips/${tripId}/patients`,
          `/trips/${tripId}/patients/new`,
          `/trips/${tripId}/queue`,
          `/trips/${tripId}/members`,
          `/trips/${tripId}/data`,
          patient,
          `${patient}/vitals`,
          `${patient}/diabetic`,
          `${patient}/conditions`,
          `${patient}/diagnosis`,
          `${patient}/medications`,
          `${patient}/visits`,
          `${patient}/photos`,
          "/search?q=ma",
          "/conflicts",
          ...(conflictId ? [`/conflicts/${conflictId}`] : []),
          "/account",
          "/admin/users",
          "/admin/audit",
          "/admin/backups",
          "/admin/sync",
        ],
      ],
      ["student.on@example.com", ["/trips", patient, `${patient}/medications`]],
    ];
    const report: string[] = [];
    for (const [email, paths] of pages) {
      const page = await device(browser, locale, email);
      for (const path of paths) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        for (const p of await problems(page)) report.push(`${path} ${p}`);
      }
      await page.context().close();
    }
    expect(report).toEqual([]);
  });
}

test("the smallest phones (320px wide) never scroll sideways or hide menu links", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tripId, patientId } = await ids();
  const page = await device(browser, "es", "admin@example.org", { width: 320, height: 640 });
  for (const path of [
    "/trips",
    `/trips/${tripId}`,
    `/trips/${tripId}/patients`,
    `/trips/${tripId}/patients/new`,
    `/patients/${patientId}`,
    `/patients/${patientId}/medications`,
    `/patients/${patientId}/vitals`,
    "/admin/users",
    "/admin/audit",
    "/account",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
    // Every menu link on screen, none hidden off the edge.
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("nav a")].filter((a) => a.offsetParent !== null && a.getBoundingClientRect().right > innerWidth + 1).map((a) => a.textContent),
    );
    expect(clipped, `${path} has menu links off the screen`).toEqual([]);
  }
});

test("a keyboard user can skip the navigation", async ({ browser }) => {
  const page = await device(browser, "en", "physician@example.org");
  await page.goto("/trips"); // a fresh page load, so focus starts at the top
  await expect(page.locator("main a[href]").first()).toBeVisible(); // the list has streamed in
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  await page.keyboard.press("Tab");
  // The next stop is inside the page, not the menu.
  expect(await page.evaluate(() => document.activeElement?.closest("main") !== null)).toBe(true);
});
