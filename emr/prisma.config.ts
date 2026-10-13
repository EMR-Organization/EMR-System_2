import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local itself; the Prisma CLI and scripts need it loaded here.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

// The CLI (migrate, seed) connects as the database owner. The app itself
// connects as the restricted emr_app role via DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_OWNER_URL,
  },
});
