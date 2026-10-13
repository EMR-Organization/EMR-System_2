import "server-only";
import { hash, verify } from "@node-rs/argon2";

// argon2id with OWASP's recommended minimum cost (19 MiB, 2 passes).
// About 30-60 ms per hash on a laptop: cheap for one sign-in, slow for guessing.
const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed hash is a failed check, never a crash or a bypass.
    return false;
  }
}

// Verifying against this when there's no real hash (unknown email) makes
// failures take the same time either way, so timing doesn't reveal which
// emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= hashPassword("not-a-real-password-just-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}
