import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPosition, deletePosition, readPositions, type PositionInput, type PortfolioDb } from "@/lib/portfolio";
import { createFixtureDb, fixtureUserId, FAULT_POSITIONS_READ } from "@/lib/watchlistsFixtureDb";

const intent = "a06d0b90-b0fe-4eba-a988-7b140cba1034";
const otherIntent = "58950185-1075-4ab0-a462-22ed56e42ccf";
const draft: PositionInput = { clientPositionId: intent, ticker: "nvda", shares: "2.00",
  entryPrice: "100.50", entryCurrency: "USD", entryDate: "2026-10-01", notes: "One intent" };
let key: string;
let owner: string;
let db: PortfolioDb;
beforeEach(() => {
  key = "portfolio-retry-" + crypto.randomUUID();
  owner = fixtureUserId(key); db = createFixtureDb(key);
});

describe("Existing position primary-key retry protection", () => {
  it("reconciles a committed create when the response was lost", async () => {
    await createPosition(db, owner, draft); // The caller receives no usable response.
    const result = await createPosition(db, owner, { ...draft, ticker: "NVDA", shares: 2, entryPrice: 100.5, entryCurrency: "USD" });
    expect(result.ok).toBe(true); expect(result.position?.id).toBe(intent);
    const read = await readPositions(db, owner);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.positions).toHaveLength(1);
  });

  it("concurrent identical intents converge without an update or a replacement ID", async () => {
    const results = await Promise.all([createPosition(db, owner, draft), createPosition(db, owner, draft)]);
    expect(results.every(r => r.ok && r.position?.id === intent)).toBe(true);
    const read = await readPositions(db, owner);
    if (read.ok) expect(read.positions).toHaveLength(1); else throw new Error("unreadable");
  });

  it.each([{ shares: 3 }, { entryPrice: 101 }, { entryCurrency: "HKD" }, { notes: "Changed" }, { status: "closed" }, { entryDate: null }, { ticker: "AMD" }])(
    "refuses a changed intent without overwriting the accepted record: %j", async patch => {
      const accepted = await createPosition(db, owner, draft);
      const conflict = await createPosition(db, owner, { ...draft, ...patch });
      expect(conflict).toEqual({ ok: false, error: "position intent conflict", status: 409 });
      const read = await readPositions(db, owner);
      if (read.ok) expect(read.positions).toEqual([accepted.position]); else throw new Error("unreadable");
    });

  it("does not disclose or alter a foreign ID", async () => {
    await createPosition(db, "another-owner", draft);
    const conflict = await createPosition(db, owner, draft);
    expect(conflict).toEqual({ ok: false, error: "position intent conflict", status: 409 });
    expect(conflict).not.toHaveProperty("position");
    const read = await readPositions(db, owner);
    if (read.ok) expect(read.positions).toEqual([]); else throw new Error("unreadable");
  });

  it("retains an unavailable confirmation read as unavailable without another insert", async () => {
    await createPosition(db, owner, draft);
    const failed = await createPosition(createFixtureDb(key, new Set([FAULT_POSITIONS_READ])), owner, draft);
    expect(failed).toEqual({ ok: false, error: "position confirmation failed", status: 500 });
    const read = await readPositions(db, owner);
    if (read.ok) expect(read.positions).toHaveLength(1); else throw new Error("unreadable");
  });

  it("does not interpret other database errors as an existing-record receipt", async () => {
    const from = vi.fn(() => ({ insert: () => ({ select: () => ({ maybeSingle: async () => ({
      data: null, error: { code: "08006", message: "connection failure" },
    }) }) }) }));
    const failed = await createPosition({ from } as unknown as PortfolioDb, owner, draft);
    expect(failed).toEqual({ ok: false, error: "position create failed", status: 500 });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("retains legacy no-ID callers, null values and independent new intents", async () => {
    const empty = { ticker: "RKLB", clientPositionId: intent };
    expect((await createPosition(db, owner, empty)).ok).toBe(true);
    expect((await createPosition(db, owner, empty)).ok).toBe(true);
    expect((await createPosition(db, owner, { ...empty, clientPositionId: otherIntent })).ok).toBe(true);
    expect((await createPosition(db, owner, { ticker: "RKLB" })).ok).toBe(true);
    const read = await readPositions(db, owner);
    if (read.ok) expect(read.positions).toHaveLength(3); else throw new Error("unreadable");
  });

  it("rejects invalid supplied intent IDs before inserting", async () => {
    for (const clientPositionId of ["", "not-a-uuid", 12, null]) {
      expect((await createPosition(db, owner, { ...draft, clientPositionId })).status).toBe(400);
    }
    const read = await readPositions(db, owner);
    if (read.ok) expect(read.positions).toEqual([]); else throw new Error("unreadable");
  });

  it("documents the hard-delete boundary: a deleted row no longer carries retry evidence", async () => {
    await createPosition(db, owner, draft);
    expect((await deletePosition(db, owner, intent)).ok).toBe(true);
    const recreated = await createPosition(db, owner, draft);
    expect(recreated.ok).toBe(true); expect(recreated.position?.id).toBe(intent);
  });
});
