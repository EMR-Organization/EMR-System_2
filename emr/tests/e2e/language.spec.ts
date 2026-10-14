import { expect, expectNoHorizontalScroll, newDevice, test } from "./fixtures";

const PASSWORD = "dev only password 2026";
const TRIP = "May 2026 Guatemala";

test("a Spanish phone gets Spanish; values are stored the same in either language", async ({ browser }) => {
  // A device whose browser asks for Spanish, with no choice made yet.
  const page = await (await newDevice(browser, { locale: "es-GT" })).newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Iniciar sesión");
  await page.getByLabel("Correo electrónico").fill("student.on@example.com");
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Viajes" })).toBeVisible();

  // Register a patient through the Spanish form, ticking a translated condition.
  const last = `Idioma${Math.random().toString(36).slice(2, 7)}`;
  await page.getByRole("link", { name: TRIP }).first().click();
  await page.getByRole("link", { name: "Registrar paciente" }).first().click();
  await expectNoHorizontalScroll(page);
  await page.getByLabel("Nombre", { exact: true }).fill("Marta");
  await page.getByLabel("Apellido").fill(last);
  await page.getByLabel("Edad aproximada").fill("52");
  await page.getByLabel("Sexo").selectOption("FEMALE");
  await page.getByLabel("Enviar a").selectOption("PHYSICIAN");
  await page.getByLabel("Fuente principal de agua").selectOption({ label: "Agua de pozo" });
  await page.getByLabel("Hipertensión").check();
  await page.getByRole("button", { name: "Registrar paciente" }).click();
  await expect(page.getByText(/Paciente \d{3}_05_2026 registrado\./)).toBeVisible();
  await expect(page.getByText("Agua de pozo", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Enfermedades" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Hipertensión" })).toBeVisible();

  // Switch the device to English: the same record, the stored English values.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("listitem").filter({ hasText: "Hypertension" })).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("Well Water", { exact: true }).first()).toBeVisible();

  // The choice sticks for this device (a cookie), over the browser's language.
  await page.reload();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Español" }).click();
  await expect(page.getByRole("link", { name: "Resumen" })).toBeVisible();
});
