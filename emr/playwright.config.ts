import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// e2e tests sign in and change data, so they run against their own seeded
// database: .env.e2e.local (see README). Loaded first, so it wins over .env.local.
config({ path: ".env.e2e.local", quiet: true });
config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./tests/e2e",
  // Sign-in tests share accounts and the per-IP rate limit; run them in order.
  workers: 1,
  // In CI also write an HTML report, uploaded when a run fails.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Dedicated port so a dev server (or another local app) on :3000 is never tested by mistake.
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    // The standalone server is what the field bundle runs.
    command: "npm run start:standalone",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
      AUDIT_KEY: process.env.AUDIT_KEY ?? "",
      TRUST_PROXY: process.env.TRUST_PROXY ?? "0",
      ALLOWED_EMAIL_DOMAINS: process.env.ALLOWED_EMAIL_DOMAINS ?? "",
      NODE_ID: process.env.NODE_ID ?? "e2e",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
