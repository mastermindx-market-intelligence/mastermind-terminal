import { beforeEach, describe, expect, it } from "vitest";
import { bookTotals, costBasis, createPosition, listPositions, marketValue, rowToPosition,
  sinceEntryPct, sinceEntryValue, updatePosition, type Position } from "../portfolio";
import { createFixtureDb, fixtureUserId, resetFixtureStores } from "../watchlistsFixtureDb";

type UnitPosition = Position & { entryCurrency?: string | null };
const lot = (ticker = "AAA", currency: string | null = "USD", shares = 1): UnitPosition => ({
  id: ticker, ticker, shares, entryPrice: 100, entryCurrency: currency,
  entryDate: null, notes: null, status: "open", createdAt: null,
});
beforeEach(() => resetFixtureStores());

describe("actual portfolio monetary boundaries", () => {
  it("does not add USD and HKD prices or costs into a unitless book total", () => {
    const result = bookTotals([lot("AAA", "USD"), lot("BBB", "HKD")], {
      AAA: { last: 110, chg: 10, currency: "USD" }, BBB: { last: 110, chg: 10, currency: "HKD" },
    }, {});
    expect(result.marketValue).toBeNull(); expect(result.costBasis).toBeNull();
    expect(result.sinceEntry).toBeNull(); expect(result.sinceEntryPct).toBeNull();
    expect(result.dayChange).toBeNull();
  });
  it("can value a current USD quote without guessing a legacy entry unit", () => {
    const result = bookTotals([lot("AAA", null)], { AAA: { last: 110, currency: "USD" } }, {});
    expect(result.marketValue).toBe(110); expect(result.costBasis).toBeNull();
    expect(result.sinceEntry).toBeNull(); expect(result.sinceEntryPct).toBeNull();
  });
  it("keeps a known historical cost when the current quote is missing", () => {
    expect(costBasis(lot())).toBe(100);
    expect(bookTotals([lot()], {}, {}).costBasis).toBe(100);
  });
  it("requires current price units for money but not entry units for current value", () => {
    expect(marketValue(lot("AAA", null), 110, "USD")).toBe(110);
    expect(marketValue(lot(), 110)).toBeNull();
    expect(sinceEntryValue(lot(), 110)).toBeNull();
  });
  it("does not treat incompatible entry and quote units as a price percentage", () => {
    expect(sinceEntryPct(lot(), 110, "HKD")).toBeNull();
    expect(sinceEntryValue(lot(), 110, "HKD")).toBeNull();
    expect(sinceEntryPct({ ...lot(), shares: null }, 110, "USD")).toBe(10);
  });
  it("does not borrow manifest currency for a different live price", () => {
    expect(bookTotals([lot()], { AAA: { last: 110 } }, {
      AAA: { last: 100, currency: "USD" },
    }).marketValue).toBeNull();
  });
  it("withholds a common cost total when one eligible lot has an unknown unit", () => {
    const result = bookTotals([lot("AAA"), lot("BBB", null)], {
      AAA: { last: 110, currency: "USD" }, BBB: { last: 110, currency: "USD" },
    }, {});
    expect(result.marketValue).toBe(220); expect(result.costBasis).toBeNull();
    expect(result.sinceEntry).toBeNull();
  });
  it("does not silently turn a pence price tag into pounds", () => {
    expect(marketValue(lot("AAA", "GBP"), 110, "GBp")).toBeNull();
    expect(sinceEntryPct(lot("AAA", "GBP"), 110, "GBp")).toBeNull();
  });
  it("preserves signed short values and same-unit price movement", () => {
    const p = lot("AAA", "USD", -2);
    expect(marketValue(p, 50, "USD")).toBe(-100);
    expect(costBasis(p)).toBe(-200); expect(sinceEntryValue(p, 50, "USD")).toBe(100);
    expect(sinceEntryPct(p, 50, "USD")).toBe(-50);
  });
  it("does not convert numeric overflow into a displayed monetary amount", () => {
    expect(marketValue({ ...lot(), shares: 2 }, 1e308, "USD")).toBeNull();
    expect(costBasis({ ...lot(), shares: 2, entryPrice: 1e308 })).toBeNull();
  });
  it("does not drop an overflowing eligible lot and total the smaller lot", () => {
    const result = bookTotals([lot("AAA"), { ...lot("BBB"), shares: 2, entryPrice: 1e308 }], {
      AAA: { last: 110, chg: 10, currency: "USD" }, BBB: { last: 1e308, chg: 10, currency: "USD" },
    }, {});
    expect(result.marketValue).toBeNull(); expect(result.costBasis).toBeNull();
    expect(result.sinceEntry).toBeNull(); expect(result.dayChange).toBeNull();
    expect(result.monetaryGaps).toContain("BBB");
  });
  it("does not total daily movement when one priced lot has no daily observation", () => {
    const result = bookTotals([lot("AAA"), lot("BBB")], {
      AAA: { last: 110, chg: 10, currency: "USD" }, BBB: { last: 110, currency: "USD" },
    }, {});
    expect(result.marketValue).toBe(220); expect(result.sinceEntry).toBe(20);
    expect(result.dayChange).toBeNull();
  });
  it("reads explicit entry currency and preserves unknown legacy rows", () => {
    expect(rowToPosition({ id: "p", ticker: "AAPL", entry_price: 100, entry_currency: "USD", entry_currency_basis: { ticker: "AAPL", price: 100 } }))
      .toMatchObject({ entryCurrency: "USD" });
    expect(rowToPosition({ id: "old", ticker: "AAPL", entry_price: 100 }))
      .toMatchObject({ entryCurrency: null });
  });
  it("round trips a user's entry unit and preserves it through an older status-only writer", async () => {
    const db = createFixtureDb("currency-unit"), owner = fixtureUserId("currency-unit");
    const written = await createPosition(db, owner, { ticker: "AAA", shares: 1, entryPrice: 100, entryCurrency: "HKD" });
    expect(written.ok).toBe(true); const id = written.position!.id;
    await updatePosition(db, owner, id, { status: "closed" });
    expect((await listPositions(db, owner))[0]).toMatchObject({ status: "closed", entryCurrency: "HKD" });
    await updatePosition(db, owner, id, { entryPrice: 200 });
    expect((await listPositions(db, owner))[0].entryCurrency).toBeNull();
    await updatePosition(db, owner, id, { entryPrice: 100 });
    expect((await listPositions(db, owner))[0].entryCurrency).toBeNull();
    await updatePosition(db, owner, id, { entryCurrency: "USD" });
    await updatePosition(db, owner, id, { ticker: "BBB" });
    expect((await listPositions(db, owner))[0].entryCurrency).toBeNull();
    await updatePosition(db, owner, id, { ticker: "AAA" });
    expect((await listPositions(db, owner))[0].entryCurrency).toBeNull();
    await updatePosition(db, owner, id, { entryCurrency: "" });
    expect((await listPositions(db, owner))[0].entryCurrency).toBeNull();
  });
});
