import { describe, expect, it } from "vitest";
import { discoverQuoteDemand, discoverRange, discoverSignal, evaluateDiscoverBase, matchesDiscoverSearch, normalizeDiscoverRow, parseDiscoverSearch, toggleDiscoverComparison, type DiscoverBaseFilters } from "../discoverResearch";
import { isPriced } from "../smartScreen/predicate";

const filters: DiscoverBaseFilters = { market: "all", asset: "all", signal: "any", uptrend: false, unpriced: false, mcap: 0, w52: "any", move: "any" };
const row = (overrides: Record<string, unknown> = {}) => normalizeDiscoverRow("TEST", { name: "Test Company", sec: "Equities", last: 100, vol: 50, hi52: 120, lo52: 80, ...overrides });
const query = parseDiscoverSearch("");

describe("Discover scan normalization and membership", () => {
  it.each([0, -1, NaN, Infinity, "100", null])("never lets unusable equity price %s become a drawdown candidate", last => {
    const r = row({ last });
    expect(r.last).toBeNull(); expect(r.dv).toBeNull(); expect(r.offHi).toBeNull(); expect(r.offLo).toBeNull();
    expect(evaluateDiscoverBase(r, filters, query).match).toBe("unknown");
    expect(evaluateDiscoverBase(r, { ...filters, unpriced: true, w52: "dd30" }, query).match).toBe("unknown");
    expect(evaluateDiscoverBase(r, { ...filters, unpriced: true, w52: "nearLow" }, query).match).toBe("unknown");
  });
  it("keeps zero volume as known zero traded value", () => {
    const r = row({ vol: 0 }); expect(r.last).toBe(100); expect(r.dv).toBe(0);
    expect(evaluateDiscoverBase(r, filters, query).match).toBe("pass");
  });
  it.each(["Equities", "Funds", "Crypto", "Indices", "Bonds", "Futures", "Forex", ""])("shares the incumbent %s price policy", sec => {
    for (const last of [-5, 0, 10]) expect(row({ sec, last }).last !== null).toBe(isPriced({ sec, last }));
  });
  it("preserves signed observations while refusing unsupported percentage ranges", () => {
    const r = row({ sec: "Futures", last: -5, hi52: 10, lo52: -20 });
    expect([r.last, r.hi52, r.lo52]).toEqual([-5, 10, -20]);
    expect(r.dv).toBeNull(); expect(r.offHi).toBeNull(); expect(r.offLo).toBeNull(); expect(discoverRange(r)).toBeNull();
  });
  it("does not produce an infinite amount or percentage from finite inputs", () => {
    const r = row({ last: Number.MAX_VALUE, vol: 2, hi52: Number.MIN_VALUE, lo52: Number.MIN_VALUE });
    expect(r.dv).toBeNull(); expect(r.offHi).toBeNull(); expect(r.offLo).toBeNull();
  });
  it("retains contradictory observations but cannot qualify a reversed range", () => {
    const r = row({ hi52: 40, lo52: 80 });
    expect([r.hi52, r.lo52]).toEqual([40, 80]); expect(r.offHi).toBeNull(); expect(r.offLo).toBeNull(); expect(discoverRange(r)).toBeNull();
  });
  it("keeps a real price outside a coherent range visible rather than clipping the fact", () => {
    expect(discoverRange(row({ last: 140 }))).toBe(150);
  });
  it("requires actual signal and regime agreement", () => {
    const f = { ...filters, signal: "buy" as const, uptrend: true };
    expect(evaluateDiscoverBase(row({ verdict: "REBUY", regimeBull: true }), f, query).match).toBe("pass");
    expect(evaluateDiscoverBase(row({ verdict: "SELL", regimeBull: true }), f, query).match).toBe("fail");
    expect(evaluateDiscoverBase(row({ verdict: "BUY" }), f, query).match).toBe("unknown");
  });
});

describe("Discover search and signal semantics", () => {
  it("supports cashtags and explicit exact-listing lists without widening other predicates", () => {
    const search = parseDiscoverSearch(" $nvda, 0700.hk, NVDA; $TSLA ");
    expect(search).toEqual({ kind: "symbols", symbols: ["NVDA", "0700.HK", "TSLA"] });
    expect(matchesDiscoverSearch({ sym: "0700.HK", name: "Tencent" }, search)).toBe(true);
    expect(matchesDiscoverSearch({ sym: "0700", name: "Other listing" }, search)).toBe(false);
    expect(matchesDiscoverSearch({ sym: "NVDA", name: "NVIDIA" }, parseDiscoverSearch("$nvda"))).toBe(true);
    expect(matchesDiscoverSearch({ sym: "700", name: "Tencent", zh: "腾讯控股" }, parseDiscoverSearch("腾讯"))).toBe(true);
  });
  it.each([
    ["2026-11-13", "recorded", false], ["2026-10-01", "historical", true],
    [null, "undated", true], ["2026-02-30", "invalid", true], ["2026-11-15", "future", true],
  ])("shows event date %s with its actual age authority", (vts, age, dim) => {
    expect(discoverSignal({ verdict: "REBUY", vts }, "en", Date.parse("2026-11-14T12:00:00Z"))).toMatchObject({ label: "Re-buy", age, dim });
  });
  it("uses the same localized re-entry words and distinguishes absent coverage", () => {
    expect(discoverSignal({ verdict: "REBUY" }, "zh", Date.now()).label).toBe("快速再入");
    expect(discoverSignal({ verdict: "RECLAIM" }, "en", Date.now()).label).toBe("Re-entry");
    expect(discoverSignal({ verdict: null }, "en", Date.now()).age).toBe("uncovered");
  });
});

describe("Bounded comparison and quote demand", () => {
  it("refuses a fifth selection without replacing the existing four", () => {
    const selected = ["A", "B", "C", "D"];
    expect(toggleDiscoverComparison(selected, "E")).toEqual({ ids: selected, full: true });
    expect(toggleDiscoverComparison(selected, "B")).toEqual({ ids: ["A", "C", "D"], full: false });
  });
  it("subscribes to the open inspector even when price columns are hidden, without duplicates", () => {
    const us = { sym: "NVDA", mktId: "us" as const }, hk = { sym: "0700.HK", mktId: "hk" as const };
    expect(discoverQuoteDemand([us], [hk, us], false, false)).toEqual({ regular: ["0700.HK", "NVDA"], overnight: ["NVDA"] });
    expect(discoverQuoteDemand([us], [us], true, true)).toEqual({ regular: ["NVDA"], overnight: ["NVDA"] });
    expect(discoverQuoteDemand([us], [], false, false)).toEqual({ regular: [], overnight: [] });
  });
});
