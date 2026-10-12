// Creates an ADMIN account from the command line. This is the only way an
// admin account comes into existence: there are no default accounts or passwords.
//
//   npm run create-admin
//
// Prompts for name, email and password (hidden). If stdin isn't a terminal
// (scripted setup), it reads those three lines from stdin instead.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { checkPassword } from "@/lib/shared/password-policy";
import { registerSchema } from "@/lib/shared/schemas/auth";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";

async function prompts(): Promise<{ name: string; email: string; password: string }> {
  if (!process.stdin.isTTY) {
    const lines: string[] = [];
    for await (const line of createInterface({ input: process.stdin })) lines.push(line);
    const [name = "", email = "", password = ""] = lines;
    return { name, email, password };
  }

  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const ask = (q: string, hidden = false) =>
    new Promise<string>((resolve) => {
      process.stdout.write(q);
      muted = hidden;
      rl.question("", (answer) => {
        muted = false;
        if (hidden) process.stdout.write("\n");
        resolve(answer);
      });
    });

  const name = await ask("Full name: ");
  const email = await ask("Email: ");
  const password = await ask("Password (12+ characters, hidden): ", true);
  const confirm = await ask("Password again: ", true);
  rl.close();
  if (password !== confirm) fail("Passwords don't match.");
  return { name, email, password };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const input = await prompts();
  const parsed = registerSchema.safeParse({ ...input, role: "DOCTOR" });
  if (!parsed.success) fail(`Invalid input: ${parsed.error.issues.map((i) => `${String(i.path[0])} ${i.message}`).join(", ")}`);
  const { name, email, password } = parsed.data;

  const problems = checkPassword(password, email);
  if (problems.length > 0) fail(`Password not accepted: ${problems.join(", ")}`);

  if (await db.user.findUnique({ where: { email } })) fail(`An account for ${email} already exists.`);

  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, name, role: "ADMIN", status: "ACTIVE", approvedAt: new Date() },
    });
    await tx.account.create({
      data: { userId: created.id, accountId: created.id, providerId: "credential", password: passwordHash },
    });
    await audit(tx, { userId: created.id, ip: "cli" }, { action: "user.createAdmin", entity: "User", entityId: created.id });
    return created;
  });

  const admins = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
  console.log(`Admin ${user.email} created. Active admins: ${admins}.`);
  if (admins < 2) console.log("Tip: create a second (backup) admin so one lost password can't lock everyone out.");
}

main()
  .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
  .finally(() => db.$disconnect());
