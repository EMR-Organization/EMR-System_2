import { expect, test } from "@playwright/test";

test("home page renders with security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Humanity First");
});
