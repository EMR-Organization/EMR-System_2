import { expect, test, type Page } from "@playwright/test";

// Runs against the seeded e2e database (fake accounts, see prisma/seed.ts).
const PASSWORD = "dev only password 2026";

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
});

test("a doctor signs in, sees their devices, and signs out", async ({ page, context }) => {
  await signIn(page, "physician@example.org");
  await expect(page.getByText(/Signed in as Dr\. .+ \(Doctor\)/)).toBeVisible();

  const [cookie] = (await context.cookies()).filter((c) => c.name.includes("session_token"));
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", secure: true });

  await page.getByRole("link", { name: "Your account and devices" }).click();
  await expect(page.getByRole("heading", { name: "Signed-in devices" })).toBeVisible();
  await expect(page.getByText("This device")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});

test("returns to the page you asked for", async ({ page }) => {
  await page.goto("/account");
  await page.getByLabel("Email").fill("dentist@example.org");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("a wrong password gets the generic message", async ({ page }) => {
  await signIn(page, "pediatrician@example.org", "not the right password");
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
});

test("a pending account sees its status only after the right password", async ({ page }) => {
  await signIn(page, "pending.doctor@example.org");
  await expect(page).toHaveURL(/\/pending\?status=PENDING/);
  await expect(page.getByText(/waiting for an admin/)).toBeVisible();
});

test("registering creates a pending account", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Student").check();
  await page.getByLabel("Full name").fill("E2E Student");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel("Password").fill("a long and memorable passphrase");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/pending\?status=REGISTERED/);
});

test("weak passwords are explained", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Weak");
  await page.getByLabel("Email").fill(`weak-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("That password is too common or easy to guess.")).toBeVisible();
});
