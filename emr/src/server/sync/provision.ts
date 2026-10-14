import "server-only";
import { provisionSchema, type Provision } from "@/lib/shared/schemas/sync";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { seal, unseal } from "@/server/sealed";

// Provisioning (spec: "Offline fallback and sync"). Before the trip, the hub
// writes everyone's accounts (with password hashes), the trips and who's
// switched on where, encrypted with SYNC_KEY. Each fallback laptop loads it so
// the same logins work there. Fallbacks start with no patients.

/** On the hub: the provisioning file's bytes (encrypted). Active accounts only. */
export async function buildProvisionFile(): Promise<{ file: Buffer; counts: { users: number; trips: number; members: number } }> {
  const [users, trips, members] = await Promise.all([
    db.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, email: true, name: true, role: true, specialty: true, accounts: { where: { providerId: "credential" }, select: { password: true } } },
    }),
    db.trip.findMany({ select: { id: true, code: true, name: true, month: true, year: true, location: true, active: true } }),
    db.tripMember.findMany({ select: { tripId: true, userId: true, enabled: true } }),
  ]);
  const withPassword = users.flatMap(({ accounts, ...u }) => (accounts[0]?.password ? [{ ...u, passwordHash: accounts[0].password }] : []));
  const ids = new Set(withPassword.map((u) => u.id));
  const data: Provision = {
    format: "hf-emr-provision",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    hubNodeId: env().NODE_ID,
    users: withPassword,
    trips,
    members: members.filter((m) => ids.has(m.userId)),
  };
  await db.$transaction((tx) =>
    audit(tx, null, {
      action: "sync.provision.create",
      entity: "Node",
      details: { users: data.users.length, trips: data.trips.length, members: data.members.length },
    }),
  );
  return { file: seal("provision", Buffer.from(JSON.stringify(data))), counts: { users: data.users.length, trips: data.trips.length, members: data.members.length } };
}

export type ProvisionResult = { users: number; trips: number; members: number; skipped: string[] };

/**
 * On a fallback laptop: loads (or refreshes) accounts, trips and memberships.
 * New trips start numbering at `firstNumber`, so this laptop's patient numbers
 * (e.g. 5001_05_2026) can't be mistaken for the hub's on paper; the hub gives
 * them its own numbers on import and keeps these as aliases.
 */
export async function loadProvisionFile(file: Buffer, options: { firstNumber?: number } = {}): Promise<ProvisionResult> {
  const firstNumber = options.firstNumber ?? 5001;
  if (!Number.isInteger(firstNumber) || firstNumber < 1 || firstNumber > 900_000) throw new Error("--first-number must be a whole number from 1 to 900000");
  const data = provisionSchema.parse(JSON.parse(unseal("provision", file).toString("utf8")));
  if (data.hubNodeId === env().NODE_ID) throw new Error(`This laptop's NODE_ID (${env().NODE_ID}) is the hub's: give each fallback its own NODE_ID`);

  const skipped: string[] = [];
  const result = await db.$transaction(
    async (tx) => {
      let users = 0;
      for (const u of data.users) {
        const clash = await tx.user.findUnique({ where: { email: u.email }, select: { id: true } });
        if (clash && clash.id !== u.id) {
          skipped.push(`user ${u.email}: a different account with that email already exists here`);
          continue;
        }
        const fields = { email: u.email, name: u.name, role: u.role, specialty: u.specialty, status: "ACTIVE" as const, failedLogins: 0, lockedUntil: null };
        await tx.user.upsert({ where: { id: u.id }, create: { id: u.id, ...fields, approvedAt: new Date() }, update: fields });
        const account = await tx.account.findFirst({ where: { userId: u.id, providerId: "credential" }, select: { id: true } });
        if (account) await tx.account.update({ where: { id: account.id }, data: { password: u.passwordHash } });
        else await tx.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: u.passwordHash } });
        users++;
      }

      let trips = 0;
      for (const t of data.trips) {
        const clash = await tx.trip.findUnique({ where: { code: t.code }, select: { id: true } });
        if (clash && clash.id !== t.id) {
          skipped.push(`trip ${t.code}: a different trip with that code already exists here`);
          continue;
        }
        const { id, ...fields } = t;
        await tx.trip.upsert({ where: { id }, create: { id, ...fields, nextPatientNumber: firstNumber }, update: fields });
        trips++;
      }

      const userIds = new Set((await tx.user.findMany({ select: { id: true } })).map((u) => u.id));
      const tripIds = new Set((await tx.trip.findMany({ select: { id: true } })).map((t) => t.id));
      let members = 0;
      for (const m of data.members) {
        if (!userIds.has(m.userId) || !tripIds.has(m.tripId)) continue;
        await tx.tripMember.upsert({
          where: { tripId_userId: { tripId: m.tripId, userId: m.userId } },
          create: { ...m, enabledAt: m.enabled ? new Date() : null },
          update: { enabled: m.enabled },
        });
        members++;
      }
      await audit(tx, null, {
        action: "sync.provision.load",
        entity: "Node",
        details: { hubNodeId: data.hubNodeId, users, trips, members, skipped: skipped.length },
      });
      return { users, trips, members };
    },
    { timeout: 120_000 },
  );
  return { ...result, skipped };
}
