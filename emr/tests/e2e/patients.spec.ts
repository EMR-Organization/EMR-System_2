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

async function registerPatient(page: Page, first: string, last: string) {
  await page.getByRole("link", { name: TRIP }).first().click();
  await page.getByRole("link", { name: "Register patient" }).first().click();
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Estimated age").fill("34");
  await page.getByLabel("Sex").selectOption("FEMALE");
  await page.getByLabel("Send to").selectOption("PHYSICIAN");
  await page.getByLabel("Main water source").selectOption("Well Water");
  await page.getByLabel("Risk level").selectOption("HIGH");
  await page.getByLabel("Cholera", { exact: true }).check();
  await page.getByLabel("Hypertension").check();
  await page.getByLabel("Severity: Hypertension").selectOption("MODERATE");
  await page.getByRole("button", { name: "Register patient" }).click();
  await expect(page.getByText(/Patient \d{3}_05_2026 registered\./)).toBeVisible();
  return (await page.getByRole("heading", { level: 1 }).textContent())!.match(/\d{3}_05_2026/)![0];
}

test("a student registers a patient and records intake", async ({ browser }) => {
  const unique = Math.random().toString(36).slice(2, 7);
  const last = `Intake${unique}`;
  const page = await signedIn(browser, "student.on@example.com");
  const label = await registerPatient(page, "Rosa", last);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${last}, Rosa`);
  await expect(page.getByText("34 yrs")).toBeVisible();

  // Vitals: weight in pounds, BMI computed on the server.
  await page.getByRole("link", { name: "Vitals" }).click();
  await expect(page.getByRole("heading", { name: "Record vital signs" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByLabel("Systolic (mmHg)").fill("130");
  await page.getByLabel("Diastolic (mmHg)").fill("85");
  await page.getByLabel("Weight", { exact: true }).fill("154");
  await page.getByLabel("Weight unit").selectOption("LB");
  await page.getByLabel("Height (cm)").fill("170");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(page.getByText("Vitals saved.")).toBeVisible();
  await expect(page.getByText("BMI 24.2")).toBeVisible();
  await expect(page.getByText("Blood pressure 130/85")).toBeVisible();

  // Diabetic check.
  await page.getByRole("link", { name: "Diabetic" }).click();
  await page.getByLabel("Blood glucose (mg/dL)").fill("185");
  await page.getByLabel("Timing").selectOption("Fasting");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect(page.getByText("Entry saved.")).toBeVisible();
  await expect(page.getByText(/Blood glucose \(mg\/dL\) 185 \(Fasting\)/)).toBeVisible();

  // Conditions: the one from registration is there; add another.
  await page.getByRole("link", { name: "Conditions" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Hypertension" })).toContainText("Moderate");
  await page.getByLabel("Condition", { exact: true }).selectOption("Asthma");
  await page.getByRole("button", { name: "Add condition" }).click();
  await expect(page.getByText("Condition added.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Asthma" })).toBeVisible();

  // Found in the list by name and by number.
  await page.getByRole("link", { name: TRIP }).first().click();
  await page.getByRole("link", { name: "Patients", exact: true }).click();
  await page.getByRole("searchbox").or(page.getByLabel("Search by name or number")).fill(last);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`${last}, Rosa`) })).toBeVisible();
  await page.getByLabel("Search by name or number").fill(label);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`${last}, Rosa`) })).toBeVisible();
});

test("students can't diagnose, students can't delete, and validation is explained", async ({ browser }) => {
  const page = await signedIn(browser, "student.on@example.com");
  await registerPatient(page, "Val", `Check${Math.random().toString(36).slice(2, 7)}`);
  await expect(page.getByRole("heading", { name: "Delete patient" })).toHaveCount(0);

  await page.getByRole("link", { name: "Vitals" }).click();
  await page.getByLabel("Systolic (mmHg)").fill("120");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(page.getByText("Enter both systolic and diastolic.")).toBeVisible();
});

test("two people editing one patient: the second save is refused, not lost silently", async ({ browser }) => {
  const doctor = await signedIn(browser, "physician@example.org");
  await registerPatient(doctor, "Edit", `Race${Math.random().toString(36).slice(2, 7)}`);
  const url = doctor.url().split("?")[0];
  const other = await signedIn(browser, "dentist@example.org");
  await other.goto(url);

  await doctor.getByRole("button", { name: "Edit details" }).click();
  await other.getByRole("button", { name: "Edit details" }).click();

  await doctor.getByLabel("Phone").fill("5555-0001");
  await doctor.getByRole("button", { name: "Save changes" }).click();
  await expect(doctor.getByText("Changes saved.")).toBeVisible();

  await other.getByLabel("Phone").fill("5555-0002");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.getByText(/Someone else saved this patient after you opened it/)).toBeVisible();

  await other.reload();
  await expect(other.getByText("5555-0001")).toBeVisible();
});

test("an admin deletes a patient after typing its number", async ({ browser }) => {
  const admin = await signedIn(browser, "admin@example.org");
  const label = await registerPatient(admin, "Gone", `Del${Math.random().toString(36).slice(2, 7)}`);
  await admin.getByLabel("Type the patient number").fill("wrong");
  await admin.getByRole("button", { name: "Delete patient" }).click();
  await expect(admin.getByText("That doesn't match the patient number.")).toBeVisible();
  await admin.getByLabel("Type the patient number").fill(label);
  await admin.getByRole("button", { name: "Delete patient" }).click();
  await expect(admin).toHaveURL(/\/trips\/[^/]+\/patients$/);
  await admin.getByLabel("Search by name or number").fill(label);
  await admin.getByRole("button", { name: "Search" }).click();
  await expect(admin.getByText("No patients match.")).toBeVisible();
});
