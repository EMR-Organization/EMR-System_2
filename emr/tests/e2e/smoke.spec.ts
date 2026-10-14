import { expect, takeCspViolations, test } from "./fixtures";

test("pages are served with security headers", async ({ page }) => {
  const response = await page.goto("/login");
  const headers = response?.headers() ?? {};
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});

test("the CSP nonce is fresh per request and injected scripts don't run", async ({ page }) => {
  const nonceOf = (csp: string | undefined) => csp?.match(/'nonce-([^']+)'/)?.[1];
  const first = nonceOf((await page.goto("/login"))?.headers()["content-security-policy"]);
  const second = nonceOf((await page.goto("/login"))?.headers()["content-security-policy"]);
  expect(first).toBeTruthy();
  expect(second).not.toBe(first);
  // Next's own scripts carry the nonce, so the page works...
  await expect(page.locator(`script[nonce]`).first()).toBeAttached();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();

  // ...while markup an attacker managed to inject does not run.
  await page.evaluate(() => {
    const div = document.createElement("div");
    div.innerHTML = `<img src="data:," onerror="window.__injected = 1">`;
    document.body.append(div);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as { __injected?: number }).__injected)).toBeUndefined();
  expect(takeCspViolations().join("\n")).toMatch(/inline event handler/i);
});
