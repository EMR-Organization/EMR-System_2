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

// Anything the browser blocked under the Content-Security-Policy
// (src/lib/shared/csp.ts), from any device a test opened.
const cspViolations: string[] = [];

export async function newDevice(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
  context.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(`${msg.location().url}: ${msg.text()}`);
  });
  return context;
}

/** Returns (and clears) what the CSP blocked so far, for tests that expect a block. */
export function takeCspViolations(): string[] {
  return cspViolations.splice(0);
}

/**
 * Every test also fails if the browser blocked anything under the CSP: a
 * blocked Next script means a page that silently doesn't work, so a CSP
 * mistake surfaces in whichever test hits it first.
 */
export const test = base.extend<{ cspCheck: void }>({
  cspCheck: [
    async ({}, provide) => {
      await provide();
      const found = cspViolations.splice(0);
      expect(found, "the Content-Security-Policy blocked something").toEqual([]);
    },
    { auto: true },
  ],
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
