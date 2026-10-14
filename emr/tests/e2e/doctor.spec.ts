import type { Browser, Page } from "@playwright/test";
import sharp from "sharp";
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

/** Registers a fresh patient for the given specialty and returns the record URL. */
async function newPatient(page: Page, last: string, specialty = "PHYSICIAN") {
  await page.goto("/trips");
  await page.getByRole("link", { name: TRIP }).first().click();
  await page.getByRole("link", { name: "Register patient" }).first().click();
  await page.getByLabel("First name").fill("Carlos");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Estimated age").fill("47");
  await page.getByLabel("Sex").selectOption("MALE");
  await page.getByLabel("Send to").selectOption(specialty);
  await page.getByRole("button", { name: "Register patient" }).click();
  await expect(page.getByText(/registered\./)).toBeVisible();
  return page.url().split("?")[0];
}

test("a doctor works through their queue: diagnose, prescribe, discontinue, add a visit", async ({ browser }) => {
  const last = `Queue${Math.random().toString(36).slice(2, 7)}`;
  const student = await signedIn(browser, "student.on@example.com");
  await newPatient(student, last);

  const doctor = await signedIn(browser, "physician@example.org");
  await doctor.getByRole("link", { name: TRIP }).first().click();
  await doctor.getByRole("link", { name: "My patients" }).click();
  await expect(doctor.getByRole("heading", { name: "Patients for Physician" })).toBeVisible();
  await expectNoHorizontalScroll(doctor);
  const row = doctor.getByRole("link", { name: new RegExp(`${last}, Carlos`) });
  await expect(row).toContainText("Waiting");
  await row.click();

  // Diagnosis on the trip visit.
  await doctor.getByLabel("Chief complaint").fill("Cough for two weeks");
  await doctor.getByLabel("Diagnosis", { exact: true }).fill("Acute bronchitis");
  await doctor.getByLabel("Treatment plan").fill("Fluids and rest");
  await doctor.getByRole("button", { name: "Save diagnosis" }).click();
  await expect(doctor.getByText("Diagnosis saved.")).toBeVisible();
  await expect(doctor.getByText(/Seen by: Physician/)).toBeVisible();

  // Prescribe, then discontinue with a reason.
  await doctor.getByRole("link", { name: "Medications" }).click();
  await expect(doctor.getByRole("heading", { name: "Prescribe" })).toBeVisible();
  await expectNoHorizontalScroll(doctor);
  await doctor.getByLabel("Medication", { exact: true }).selectOption("Amoxicillin");
  await doctor.getByLabel("Dosage").fill("500 mg");
  await doctor.getByLabel("Frequency").selectOption("Three times daily");
  await doctor.getByLabel("Route").selectOption("Oral");
  await doctor.getByRole("button", { name: "Prescribe" }).last().click();
  await expect(doctor.getByText("Medication prescribed.")).toBeVisible();
  await expect(doctor.getByText("Amoxicillin · 500 mg · Three times daily · Oral")).toBeVisible();
  await doctor.getByRole("button", { name: "Discontinue: Amoxicillin" }).click();
  await doctor.getByLabel("Reason").fill("Entered in error");
  await doctor.getByRole("button", { name: "Confirm" }).click();
  await expect(doctor.getByText("Medication discontinued.")).toBeVisible();
  await expect(doctor.getByText("Reason: Entered in error")).toBeVisible();

  // A follow-up visit; the trip visit carries the diagnosis.
  await doctor.getByRole("link", { name: "Visits" }).click();
  await doctor.getByLabel("Visit type").selectOption("Follow-up");
  await doctor.getByLabel("Symptoms").fill("Cough improving");
  await doctor.getByRole("button", { name: "Save visit" }).click();
  await expect(doctor.getByText("Visit saved.")).toBeVisible();
  await expect(doctor.getByRole("listitem").filter({ hasText: "Trip visit" })).toContainText("Acute bronchitis");
  await expect(doctor.getByRole("listitem").filter({ hasText: "Follow-up" })).toContainText("Cough improving");

  // Now shown as seen in the queue.
  await doctor.getByRole("link", { name: TRIP }).first().click();
  await doctor.getByRole("link", { name: "My patients" }).click();
  await expect(doctor.getByRole("link", { name: new RegExp(`${last}, Carlos`) })).toContainText("Seen");
});

test("students see medications but not diagnosis or visit history", async ({ browser }) => {
  const student = await signedIn(browser, "student.on@example.com");
  await newPatient(student, `Stu${Math.random().toString(36).slice(2, 7)}`);
  const nav = student.getByRole("navigation", { name: "Details" });
  await expect(nav.getByRole("link", { name: "Medications" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Diagnosis" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Visits" })).toHaveCount(0);
  await student.goto(`${student.url().split("?")[0]}/diagnosis`);
  await expect(student.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(student.getByRole("link", { name: "My patients" })).toHaveCount(0);
});

test("photos: upload, metadata stripped, served only to signed-in users, cross-site uploads refused", async ({ browser }) => {
  const doctor = await signedIn(browser, "pediatrician@example.org");
  const url = await newPatient(doctor, `Photo${Math.random().toString(36).slice(2, 7)}`, "PEDIATRICIAN");
  await doctor.getByRole("link", { name: "Photos" }).click();

  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#2a6" } })
    .png()
    .withExif({ IFD0: { Copyright: "camera-owner-secret" } })
    .toBuffer();
  await doctor.getByLabel("Photo", { exact: true }).setInputFiles({ name: "wound.png", mimeType: "image/png", buffer: png });
  await doctor.getByLabel("Category").selectOption("Wound/Injury");
  await doctor.getByLabel("Description").fill("Left forearm");
  await doctor.getByRole("button", { name: "Upload" }).click();
  await expect(doctor.getByText("Photo added.")).toBeVisible();

  const img = doctor.getByRole("img", { name: /Left forearm/ });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(120);

  // The served file is a JPEG without the original metadata, never cached.
  const src = (await img.getAttribute("src"))!;
  const served = await doctor.request.get(src);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect(served.headers()["cache-control"]).toBe("private, no-store");
  expect((await served.body()).includes(Buffer.from("camera-owner-secret"))).toBe(false);

  // Not for someone signed out.
  const anonymous = await (await newDevice(browser)).newPage();
  const res = await anonymous.request.get(src, { maxRedirects: 0 });
  expect([302, 307, 401]).toContain(res.status());

  // A cross-site form post (even with the doctor's cookie) is refused.
  const patientId = url.split("/").pop();
  const forged = await doctor.request.post(`/api/patients/${patientId}/photos`, {
    headers: { origin: "https://evil.example" },
    multipart: { photo: { name: "x.png", mimeType: "image/png", buffer: png } },
  });
  expect(forged.status()).toBe(403);
});
