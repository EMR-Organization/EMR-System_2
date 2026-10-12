import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** A raw connection as the restricted app role (DATABASE_URL). */
export async function appClient() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** A raw connection as the owner role (DATABASE_OWNER_URL), for test setup only. */
export async function ownerClient() {
  const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await client.connect();
  return client;
}

/** A unique trip code so tests never collide with seed data or each other. */
export function uniqueTripCode() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  return `01_2099_T${suffix}`;
}

