import { expect, test as base, type Browser, type BrowserContext } from "@playwright/test";

export { expect };

// Each browser context gets its own client IP (the e2e server runs with
// TRUST_PROXY=1, as behind Caddy), like separate phones on the clinic network.
// Without this every test shares one IP and trips the per-IP rate limits.
let counter = 0;
export function uniqueIp() {
  counter++;
  return `10.${(process.pid >> 8) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
}

export function newDevice(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
}

export const test = base.extend({
  context: async ({ browser }, provide) => {
    const context = await newDevice(browser);
    await provide(context);
    await context.close();
  },
});


/** Fails if the page scrolls sideways (content wider than the screen), which breaks phones. */
export async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page is wider than the screen").toBeLessThanOrEqual(0);
}
