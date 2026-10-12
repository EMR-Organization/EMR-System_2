import { beforeAll, describe, expect, it } from "vitest";
import { audit, checkEntries, GENESIS_HASH, verifyChain } from "@/server/audit";
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
    const result = await verifyChain(10); // small batches exercise the paging too
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

    it("spots a re-hashed edit (chain no longer links)", () => {
      const forged = all.map((row, i) => (i === middle ? { ...row, action: "x", hash: "f".repeat(64) } : row));
      expect(checkEntries(forged)).toMatchObject({ ok: false });
    });
  });
});
