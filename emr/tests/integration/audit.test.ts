import { beforeAll, describe, expect, it } from "vitest";
import { audit, checkEntries, GENESIS_HASH, latestCheckpoint, verifyChain } from "@/server/audit";
import { db } from "@/server/db";

async function writeEntries(n: number, action = "test.entry") {
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      db.$transaction((tx) =>
        audit(tx, { userId: null, ip: "10.0.0.1" }, { action, entity: "Test", entityId: String(i), details: { i, tags: ["a", "b"] } }),
      ),
    ),
  );
  return db.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });
}

describe("audit log", () => {
  it("keeps one unbroken chain under concurrent writes", async () => {
    await writeEntries(25, `concurrent.${crypto.randomUUID()}`);
    const result = await verifyChain({ batchSize: 10 }); // small batches exercise the paging too
    expect(result).toMatchObject({ ok: true });
  });

  it("each entry links to the one before it", async () => {
    const all = await db.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(all[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < all.length; i++) expect(all[i].prevHash).toBe(all[i - 1].hash);
  });

  it("rolls back with the change it describes", async () => {
    const action = `rollback.${crypto.randomUUID()}`;
    await expect(
      db.$transaction(async (tx) => {
        await audit(tx, null, { action, entity: "Test" });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await db.auditLog.count({ where: { action } })).toBe(0);
    expect(await verifyChain()).toMatchObject({ ok: true });
  });

  describe("tamper detection", () => {
    let all: Awaited<ReturnType<typeof writeEntries>>;
    let middle: number;

    beforeAll(async () => {
      await writeEntries(5, `tamper.${crypto.randomUUID()}`);
      all = await db.auditLog.findMany({ orderBy: { id: "asc" } });
      middle = Math.floor(all.length / 2);
    });

    it("passes the untouched log", () => {
      expect(checkEntries(all)).toMatchObject({ ok: true, checked: all.length });
    });

    it("spots an edited field", () => {
      const edited = all.map((row, i) => (i === middle ? { ...row, action: "something.else" } : row));
      expect(checkEntries(edited)).toMatchObject({ ok: false, brokenAtId: all[middle].id.toString(), reason: "hash" });
    });

    it("spots edited details", () => {
      const edited = all.map((row, i) => (i === middle ? { ...row, details: { injected: true } } : row));
      expect(checkEntries(edited)).toMatchObject({ ok: false, reason: "hash" });
    });

    it("spots a deleted entry", () => {
      const deleted = all.filter((_, i) => i !== middle);
      expect(checkEntries(deleted)).toMatchObject({ ok: false, brokenAtId: all[middle + 1].id.toString(), reason: "link" });
    });

    it("can't be re-hashed without the key", () => {
      // Someone with only database access re-hashes everything with a key they guessed.
      expect(checkEntries(all, GENESIS_HASH, "not-the-real-audit-key-0123456789abcdef")).toMatchObject({ ok: false, reason: "hash" });
    });

    it("spots a re-hashed edit (chain no longer links)", () => {
      const forged = all.map((row, i) => (i === middle ? { ...row, action: "x", hash: "f".repeat(64) } : row));
      expect(checkEntries(forged)).toMatchObject({ ok: false });
    });
  });

  describe("checkpoints", () => {
    it("verifies against a checkpoint kept outside the database", async () => {
      await writeEntries(2, `checkpoint.${crypto.randomUUID()}`);
      const checkpoint = await latestCheckpoint();
      expect(checkpoint).toMatchObject({ hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(checkpoint!.count).toBeGreaterThan(0);
      await writeEntries(2, `after-checkpoint.${crypto.randomUUID()}`); // later entries are fine
      expect(await verifyChain({ checkpoint: checkpoint! })).toMatchObject({ ok: true });
    });

    it("fails when the checkpointed entry no longer has the recorded hash (a rewritten chain)", async () => {
      const checkpoint = await latestCheckpoint();
      expect(await verifyChain({ checkpoint: { id: checkpoint!.id, hash: "f".repeat(64) } })).toMatchObject({
        ok: false,
        reason: "checkpoint",
        brokenAtId: checkpoint!.id,
      });
    });

    it("fails when the checkpointed entry is gone", async () => {
      const checkpoint = await latestCheckpoint();
      const missing = { id: String(BigInt(checkpoint!.id) + BigInt(1_000_000)), hash: checkpoint!.hash };
      expect(await verifyChain({ checkpoint: missing })).toMatchObject({ ok: false, reason: "checkpoint" });
    });
  });
});
