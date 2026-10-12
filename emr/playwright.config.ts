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
  // Dedicated port so a dev server (or another local app) on :3000 is never tested by mistake.
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
      ALLOWED_EMAIL_DOMAINS: process.env.ALLOWED_EMAIL_DOMAINS ?? "",
      NODE_ID: process.env.NODE_ID ?? "e2e",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
