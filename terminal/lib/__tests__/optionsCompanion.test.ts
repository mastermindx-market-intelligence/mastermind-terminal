import { describe, expect, it, vi } from "vitest";
import { optionsRoot, isoSession, readCompanionMatrix, readVannaProfile, matrixForExpiry, formatExposureMn, readCompanionFlow } from "../optionsCompanion";
import { optionsReadAccess } from "../optionsAccess";
import { gateEntitlement, type EntitlementSnapshot } from "../entitlementStore";
import { syncOptionsPricePin, removeOptionsPricePin } from "../optionsChartPin";
import { buildMatrixGrid, matrixCellValue, matrixCellTone, fmtMatrixCell } from "@/components/shared/StrikeExpiryMatrix";

const now = Date.parse("2026-09-23T15:00:00Z");
const cell = (strike = 192, expiry = "2026-09-25") => ({ strike, expiry, gex: 2_500_000, call_oi: 3, put_oi: 5 });
const matrix = () => ({ schema: "options_structure.matrix/v1", root: "NVDA", spot: 192.53,
  asof: "2026-09-23T08:00:00Z", _build_meta: { asof_date: "2026-09-22" }, cells: [cell(), cell(194)] });
const profile = () => ({ schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-09-22", spot_ref: 192.53,
  by_strike: [{ strike: 192, vanna_net: 2.5 }, { strike: 194, vanna_net: -1 }, { strike: 196, vanna_net: null }] });

describe("companion source boundaries", () => {
  it("normalizes only supported root shapes; no crypto or foreign substitution", () => {
    expect(optionsRoot(" nvda ")).toBe("NVDA"); expect(optionsRoot("BRK.B")).toBe("BRK.B");
    for (const v of ["BTC-USD", "0700.HK", "^NDX", "A..B", "A.", "../admin", "A/B", "A%2fB", ""]) expect(optionsRoot(v)).toBeNull();
  });
  it("rejects impossible dates without normalizing them", () => {
    expect(isoSession("2026-02-29")).toBeNull(); expect(isoSession("2024-02-29")).toBe("2024-02-29");
    expect(isoSession("2026-09-22T23:00:00Z")).toBeNull();
  });
  it("uses the cell session, never the newer build clock", () => {
    const r = readCompanionMatrix(matrix(), "NVDA", now); expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.session).toBe("2026-09-22");
  });
  it.each(["SPY", "AMD"])("refuses the %s matrix wearing an NVDA header", (root) => {
    expect(readCompanionMatrix({ ...matrix(), root }, "NVDA", now)).toEqual({ ok: false, reason: "identity" });
  });
  it("refuses a build-only, future, malformed or duplicate matrix", () => {
    expect(readCompanionMatrix({ ...matrix(), _build_meta: null }, "NVDA", now)).toMatchObject({ ok: false, reason: "session" });
    expect(readCompanionMatrix({ ...matrix(), _build_meta: { asof_date: "2026-10-01" } }, "NVDA", now).ok).toBe(false);
    expect(readCompanionMatrix({ ...matrix(), cells: [cell(), cell()] }, "NVDA", now).ok).toBe(false);
    expect(readCompanionMatrix({ ...matrix(), cells: [null] }, "NVDA", now).ok).toBe(false);
    expect(readCompanionMatrix(matrix(), "NVDA", Number.NaN).ok).toBe(false);
  });
  it("preserves published zero while missing/invalid fields remain null", () => {
    const r = readCompanionMatrix({ ...matrix(), cells: [{ ...cell(), gex: 0, call_oi: -5 }, { ...cell(194), gex: null }] }, "NVDA", now);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.value.doc.cells?.[0].gex).toBe(0); expect(r.value.doc.cells?.[0].call_oi).toBeNull();
    expect(matrixCellValue(r.value.doc.cells![0], "oi")).toBeNull();
    expect(r.value.doc.cells?.[1].gex).toBeNull(); expect(r.value.missingCells).toBe(1);
  });
  it("never substitutes a front expiry for a snapshot with no 0DTE", () => {
    const r = readCompanionMatrix(matrix(), "NVDA", now); if (!r.ok) throw Error("fixture");
    expect(matrixForExpiry(r.value, "0dte").cells).toEqual([]);
    expect(matrixForExpiry(r.value, "all").cells).toHaveLength(2);
  });
  it("keeps gamma exposure distinct from the opposite hedge transaction", () => {
    expect(matrixCellValue(cell(), "gex")).toBe(2.5); expect(matrixCellValue(cell(), "hedge")).toBe(-2.5);
    expect(matrixCellTone(2.5, "gex")).toBe("var(--exposure-positive)");
    expect(matrixCellTone(-2.5, "gex")).toBe("var(--exposure-negative)");
    expect(matrixCellTone(2.5, "hedge")).toBe("var(--flow-buy)");
    expect(fmtMatrixCell(0.00002, "gex")).toBe("+20");
  });
  it("preserves exact strike identity for chart pins, rather than rounded buckets", () => {
    const doc = { ...matrix(), cells: [cell(191.25), cell(193.75), cell(197.5)] };
    const grid = buildMatrixGrid({ matrix: doc, metric: "gex", exactStrikes: true, windowPct: 3, maxRows: 101, maxCols: 3 });
    expect(grid?.strikes).toEqual([197.5, 193.75, 191.25]); expect(grid?.bucket).toBe(0);
    expect(grid?.byKey.get("193.75|2026-09-25")?.gex).toBe(2_500_000);
  });
  it("does not expand an exact-strike window merely because it has fewer than five rows", () => {
    const grid = buildMatrixGrid({ matrix: { ...matrix(), cells: [cell(170), cell(192), cell(210)] }, metric: "gex", exactStrikes: true, windowPct: 1 });
    expect(grid?.strikes).toEqual([192]);
  });
  it("validates canonical Vanna profiles, preserving nulls and the all-expiry basis", () => {
    const r = readVannaProfile({ NVDA: profile() }, "NVDA", now); expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rows).toEqual([{ strike: 196, valueMn: null }, { strike: 194, valueMn: -1 }, { strike: 192, valueMn: 2.5 }]);
    expect(readVannaProfile({ ...profile(), schema: "other" }, "NVDA", now).ok).toBe(false);
    expect(readVannaProfile({ ...profile(), root: "SPY" }, "NVDA", now).ok).toBe(false);
    expect(readVannaProfile({ ...matrix(), vex_mn: 888 }, "NVDA", now).ok).toBe(false);
    expect(readVannaProfile({ ...profile(), by_strike: [{ strike: 192, vex_mn: 50 }] }, "NVDA", now).ok).toBe(false);
  });
  it("does not round a real small exposure to measured zero", () => {
    expect(formatExposureMn(0)).toBe("0"); expect(formatExposureMn(-0)).toBe("0");
    expect(formatExposureMn(0.000001)).toBe("+1"); expect(formatExposureMn(-2.5)).toBe("−2.5M");
    expect(formatExposureMn(Infinity)).toBe("—");
  });
  it("filters and deduplicates the activity tape without inventing direction", () => {
    const event = { id: "a", root: "NVDA", ts: "2026-09-22T19:00:00Z", exp: "2026-09-25", strike: 195, right: "C", premium: 50_000, size: 100 };
    const rows = readCompanionFlow({ events: [event, event, { ...event, id: "b", root: "SPY" }, { ...event, id: "c", ts: "invalid" }] }, "NVDA");
    expect(rows).toHaveLength(1); expect(rows?.[0]).not.toHaveProperty("direction"); expect(readCompanionFlow({}, "NVDA")).toBeNull();
    expect(readCompanionFlow({ events: [] }, "NVDA")).toEqual([]);
  });
});

describe("options access remains authority-owned", () => {
  it("requires the exact feature for customers, not a paid tier alone", () => {
    expect(optionsReadAccess({ tier: "pro", features: [] })).toBe(false);
    expect(optionsReadAccess({ tier: "essential", features: ["terminal_live_options"] })).toBe(true);
    expect(optionsReadAccess({ tier: " UNLIMITED ", features: [] })).toBe(true);
    expect(optionsReadAccess({ tier: "not-unlimited", features: [] })).toBe(false);
  });
  it("closes the hint before an incoming identity can inherit the outgoing grant", () => {
    const snap = { owner: "account:A", state: "VERIFIED_PAID", plan: { tier: "unlimited", features: [] }, verifiedAt: now } as EntitlementSnapshot;
    expect(gateEntitlement(snap, "account:A").optionsRead).toBe(true);
    expect(gateEntitlement(snap, "account:B").optionsRead).toBe(false);
    expect(gateEntitlement({ ...snap, state: "STALE_LAST_GOOD" }, "account:A").optionsRead).toBe(false);
  });
});

describe("ephemeral chart price pin", () => {
  const level = { root: "NVDA", price: 195, session: "2026-09-22", label: "Strike 195 · EOD" };
  it("is idempotent and cleans up on root change, replay or close", () => {
    const host = { createPriceLine: vi.fn(() => ({ id: "line" })), removePriceLine: vi.fn() };
    const pin = syncOptionsPricePin(null, host as never, level, "NVDA", true, "#aaa");
    expect(pin).not.toBeNull(); expect(host.createPriceLine).toHaveBeenCalledTimes(1);
    expect(syncOptionsPricePin(pin, host as never, level, "NVDA", true, "#aaa")).toBe(pin);
    expect(syncOptionsPricePin(pin, host as never, level, "SPY", true, "#aaa")).toBeNull();
    expect(host.removePriceLine).toHaveBeenCalledTimes(1);
    expect(syncOptionsPricePin(null, host as never, level, "NVDA", false, "#aaa")).toBeNull();
    expect(syncOptionsPricePin(null, host as never, { ...level, price: NaN }, "NVDA", true, "#aaa")).toBeNull();
    expect(removeOptionsPricePin(null)).toBeNull();
  });
  it("removes from the original series after a chart-type change", () => {
    const oldHost = { createPriceLine: vi.fn(() => ({ id: "old" })), removePriceLine: vi.fn() };
    const nextHost = { createPriceLine: vi.fn(() => ({ id: "new" })), removePriceLine: vi.fn() };
    const pin = syncOptionsPricePin(null, oldHost as never, level, "NVDA", true, "#aaa");
    const next = syncOptionsPricePin(pin, nextHost as never, level, "NVDA", true, "#aaa");
    expect(oldHost.removePriceLine).toHaveBeenCalledTimes(1); expect(next?.host).toBe(nextHost);
  });
});
