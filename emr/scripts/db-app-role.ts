// Gives the emr_app role LOGIN and the password from DATABASE_URL.
// Runs as the owner (DATABASE_OWNER_URL), after migrations have created the role.
// Dev and CI only; the Windows setup script does the same with a generated password.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const appUrl = process.env.DATABASE_URL;
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!appUrl || !ownerUrl) throw new Error("DATABASE_URL and DATABASE_OWNER_URL must both be set");

  const app = new URL(appUrl);
  if (decodeURIComponent(app.username) !== "emr_app") {
    throw new Error(`DATABASE_URL must connect as emr_app, not "${app.username}"`);
  }
  const password = decodeURIComponent(app.password);
  if (password.length < 12) throw new Error("emr_app password must be at least 12 characters");

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE emr_app WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  } finally {
    await client.end();
  }
  console.log("emr_app can now log in with the password from DATABASE_URL.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
