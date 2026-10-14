import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The one database client for the app. Only code in src/server/ may import it
// (enforced by ESLint); everything else goes through src/server/services.
//
// It connects with DATABASE_URL as the restricted emr_app role, which cannot
// edit the audit log or hard-delete patients.

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // Writes queue for the audit chain's lock. On a busy morning (20+ devices
    // saving at once, slow laptop) give a transaction time to wait for a
    // connection rather than failing after Prisma's default 2 s.
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });
}

// Reuse one client across hot reloads in development.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? createClient();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
