// Gives the emr_app role LOGIN and the password from DATABASE_URL.
// Runs as the owner (DATABASE_OWNER_URL), after migrations have created the role.
// Dev and CI only; the Windows setup script does the same with a generated password.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
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
  if (!/^[\x20-\x7e]+$/.test(password)) throw new Error("emr_app password must be printable ASCII");

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // Send a SCRAM verifier, not the password, so it can't end up in Postgres logs.
    await client.query(`ALTER ROLE emr_app WITH LOGIN PASSWORD ${client.escapeLiteral(scramVerifier(password))}`);
  } finally {
    await client.end();
  }
  console.log("emr_app can now log in with the password from DATABASE_URL.");
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802/7677),
 * in the format pg_authid uses. Postgres accepts it in ALTER ROLE ... PASSWORD
 * as-is. (Postgres also normalizes passwords with SASLprep; ours are ASCII.)
 */
function scramVerifier(password: string, iterations = 4096): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
