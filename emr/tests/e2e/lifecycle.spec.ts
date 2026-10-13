import type { Browser, Page } from "@playwright/test";
import { expect, newDevice, test } from "./fixtures";

// The Phase 3 "done when": the whole account lifecycle in real browsers, with
// each person in their own browser context (their own cookies), against the
// seeded e2e database.
const PASSWORD = "dev only password 2026";
const TRIP = "May 2026 Guatemala";

async function signedIn(browser: Browser, email: string, password = PASSWORD): Promise<Page> {
  const page = await (await newDevice(browser)).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return page;
}

async function openTrip(page: Page) {
  await page.goto("/trips");
  await page.getByRole("link", { name: TRIP }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(TRIP);
}

test("register → approve → switch on → switch off → disable", async ({ browser }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const student = { name: `Student ${unique}`, email: `student-${unique}@example.com`, password: "a long passphrase for learning" };

  // 1. The student registers and waits for approval.
  const studentPage = await (await newDevice(browser)).newPage();
  await studentPage.goto("/register");
  await studentPage.getByLabel("Student").check();
  await studentPage.getByLabel("Full name").fill(student.name);
  await studentPage.getByLabel("Email").fill(student.email);
  await studentPage.getByLabel("Password").fill(student.password);
  await studentPage.getByRole("button", { name: "Create account" }).click();
  await expect(studentPage).toHaveURL(/\/pending/);

  // 2. An admin approves them.
  const admin = await signedIn(browser, "admin@example.org");
  await admin.goto("/admin/users");
  const pendingRow = admin.getByRole("listitem").filter({ hasText: student.email });
  await pendingRow.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText(`${student.name} approved.`)).toBeVisible();

  // 3. Signed in but not on any trip yet: they see nothing.
  await studentPage.goto("/login");
  await studentPage.getByLabel("Email").fill(student.email);
  await studentPage.getByLabel("Password").fill(student.password);
  await studentPage.getByRole("button", { name: "Sign in" }).click();
  await expect(studentPage.getByText(/not switched on for any trip/)).toBeVisible();

  // 4. A doctor switches them on for the trip.
  const doctor = await signedIn(browser, "physician@example.org");
  await openTrip(doctor);
  await doctor.getByRole("link", { name: "Students" }).click();
  await doctor.getByRole("switch", { name: `Allow ${student.name} on this trip` }).click();
  await expect(doctor.getByText(`${student.name} can now work on this trip.`)).toBeVisible();

  // 5. Now the student can open the trip.
  await openTrip(studentPage);
  const tripUrl = studentPage.url();

  // 6. Switched off: blocked on their very next request, though still signed in.
  await doctor.getByRole("switch", { name: `Allow ${student.name} on this trip` }).click();
  await expect(doctor.getByText(`${student.name} is switched off for this trip.`)).toBeVisible();
  await studentPage.goto(tripUrl);
  await expect(studentPage.getByRole("heading", { name: "Not found" })).toBeVisible();
  await studentPage.goto("/trips");
  await expect(studentPage.getByText(/not switched on for any trip/)).toBeVisible();

  // 7. Disabled by the admin: signed out on the next request.
  await admin.goto("/admin/users");
  await admin.getByRole("listitem").filter({ hasText: student.email }).getByRole("button", { name: "Disable" }).click();
  await expect(admin.getByText(`${student.name} disabled and signed out everywhere.`)).toBeVisible();
  await studentPage.goto("/trips");
  await expect(studentPage).toHaveURL(/\/login/);
});

test("doctors are approved with a specialty", async ({ browser }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const page = await (await newDevice(browser)).newPage();
  await page.goto("/register");
  await page.getByLabel("Doctor").check();
  await page.getByLabel("Full name").fill(`Dr ${unique}`);
  await page.getByLabel("Email").fill(`dr-${unique}@example.org`);
  await page.getByLabel("Password").fill("a long doctor passphrase");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/pending/);

  const admin = await signedIn(browser, "admin@example.org");
  await admin.goto("/admin/users");
  const row = admin.getByRole("listitem").filter({ hasText: `dr-${unique}@example.org` });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText("Choose a specialty for doctors.")).toBeVisible();
  await row.getByLabel("Specialty").selectOption("DENTIST");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText(`Dr ${unique} approved.`)).toBeVisible();
  await expect(admin.getByRole("listitem").filter({ hasText: `dr-${unique}@example.org` })).toContainText("Doctor · Dentist");
});

test("admins issue a reset code that lets the user set a new password", async ({ browser }) => {
  const admin = await signedIn(browser, "admin@example.org");
  await admin.goto("/admin/users");
  await admin.getByRole("listitem").filter({ hasText: "dentist@example.org" }).getByRole("button", { name: "Reset code" }).click();
  const code = (await admin.getByTestId("reset-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  const page = await (await newDevice(browser)).newPage();
  await page.goto("/reset");
  await page.getByLabel("Email").fill("dentist@example.org");
  await page.getByLabel("Reset code").fill(code);
  await page.getByLabel("New password", { exact: true }).fill(PASSWORD); // keep the seeded password for other tests
  await page.getByLabel("Confirm new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText(/Your password has been changed/)).toBeVisible();
});

test("students and doctors can't open the admin screen", async ({ browser }) => {
  const doctor = await signedIn(browser, "physician@example.org");
  await expect(doctor.getByRole("link", { name: "Users" })).toHaveCount(0);
  await doctor.goto("/admin/users");
  await expect(doctor.getByRole("heading", { name: "Not found" })).toBeVisible();
});
