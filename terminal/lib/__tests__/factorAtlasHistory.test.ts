import { beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nativeFixture from "./fixtures/factorAtlasNativeSynthetic.json";
import type * as HistoryModule from "../factorAtlasHistory";

let api: typeof HistoryModule | undefined;
beforeAll(async () => {
  const url = new URL("../factorAtlasHistory.ts", import.meta.url);
  if (existsSync(fileURLToPath(url))) api = await import(/* @vite-ignore */ url.href);
});
function subject(): typeof HistoryModule {
  expect(api, "native Factor Atlas history projection must exist").toBeDefined();
  return api!;
}
const fixture = () => structuredClone(nativeFixture);
const options = { basketId: "mag7", audience: "synthetic-preview" as const };
function history() {
  const read = subject().prepareFactorHistory(fixture(), options);
  expect(read.kind).toBe("synthetic-preview");
  expect(read.history).not.toBeNull();
  return read.history!;
}
const full = { anchorDate: "2026-01-28", endDate: "2026-01-30" };

describe("native Factor Atlas candidate boundary", () => {
  it("reads the exact committed native synthetic envelope without admission", () => {
    const r = subject().prepareFactorHistory(fixture(), options);
    expect(r.kind).toBe("synthetic-preview");
    expect(r.history?.basketId).toBe("mag7");
    expect(r.history?.sourceDigest).toBe(nativeFixture.result_digest);
    expect(r.history?.constructionRef).toBe(nativeFixture.source_refs.construction);
    expect(r.history?.digestVerification).toBe("NOT_PERFORMED");
    expect(r.history?.points).toHaveLength(3);
    expect(r.mayPublish).toBe(false);
  });
  it("withholds all numbers for a customer even when the candidate is READY", () => {
    const r = subject().prepareFactorHistory(fixture(), { ...options, audience: "customer" });
    expect(r).toMatchObject({ kind: "withheld", history: null, mayPublish: false });
    expect(JSON.stringify(r)).not.toContain("133.333");
  });
  it("fails closed for an unsupported audience rather than defaulting to preview", () => {
    const r = subject().prepareFactorHistory(fixture(), { ...options, audience: "unknown" } as never);
    expect(r.history).toBeNull();
  });
  it("does not infer preview permission from real retained input", () => {
    const d = fixture(); d.evidence_kind = "RETAINED_OWNER_INPUT";
    expect(subject().prepareFactorHistory(d, options)).toMatchObject({ kind: "withheld", history: null });
  });
  it("binds the caller's exact requested basket", () => {
    expect(subject().prepareFactorHistory(fixture(), { ...options, basketId: "defense" }).history).toBeNull();
  });
  it.each([
    ["schema", "factor_atlas.read.v1"], ["release_state", "ADMITTED"],
    ["input_admission", "AUTHENTICATED"], ["status", "LIVE"],
    ["history_mode", "FUTURE_ROSTER"], ["as_of", "2026-02-01"],
    ["result_digest", "not-a-digest"],
  ])("rejects unsupported %s", (key, value) => {
    const d = { ...fixture(), [key]: value };
    expect(subject().prepareFactorHistory(d, options)).toMatchObject({ kind: "invalid", history: null });
  });
  it.each(["may_publish", "may_trade", "may_rank", "may_gate", "may_size", "may_escalate"])(
    "preserves the false %s ceiling", key => {
      const d = fixture(); (d.authority as Record<string, boolean>)[key] = true;
      expect(subject().prepareFactorHistory(d, options).history).toBeNull();
    });
  it("rejects a new unrecognized authority field", () => {
    const d = fixture(); Object.assign(d.authority, { may_predict: true });
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it.each([
    ["return_basis", "raw"], ["currency", "EUR"], ["costs", "net"],
    ["between_rebalances", "daily-reset"], ["rebalance", "daily"],
    ["weighting", "cap"], ["window_semantics", "RECONSTRUCT"],
  ])("rejects an unsupported %s method", (key, value) => {
    const d = fixture(); Object.assign(d.method, { [key]: value });
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it("does not treat percentage points as return fractions", () => {
    const d = fixture(); d.units.returns = "percent";
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it.each([null, [], "{}", 0, true])("rejects malformed input %j without throwing", d => {
    expect(subject().prepareFactorHistory(d, options)).toMatchObject({ kind: "invalid", history: null });
  });
  it("rejects unordered or duplicated source dates", () => {
    for (const points of [[...fixture().points].reverse(), [fixture().points[0], fixture().points[0]]]) {
      expect(subject().prepareFactorHistory({ ...fixture(), points }, options).history).toBeNull();
    }
  });
  it("rejects impossible dates and future interval clocks", () => {
    const d = fixture(); d.points[0].date = "2026-02-30";
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
    const e = fixture(); e.points[1].interval_end = "2027-01-30T21:00:00Z";
    expect(subject().prepareFactorHistory(e, options).history).toBeNull();
  });
  it("rejects incomplete interval continuity instead of smoothing it", () => {
    const d = fixture(); d.points[1].interval_start = "2026-01-28T21:00:00Z";
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it.each([NaN, Infinity, -Infinity, -1, 0, true])("rejects invalid NAV %s", value => {
    const d = fixture(); Object.assign(d.points[0], { index_level: value });
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it("rejects a NAV inconsistent with its original source return", () => {
    const d = fixture(); d.points[0].index_level = 200;
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it("does not reconnect a broken source NAV using later local returns", () => {
    const d = fixture(); d.status = "PARTIAL";
    Object.assign(d.points[0], { index_level: null, return: null });
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it("accepts explicit trailing gaps without replacing them with zero", () => {
    const d = fixture(); d.status = "PARTIAL";
    Object.assign(d.points[1], { index_level: null, return: null, reasons: ["MISSING_OR_INVALID_HELD_PRICE"] });
    const r = subject().prepareFactorHistory(d, options);
    expect(r.history?.points[2].level).toBeNull();
    expect(r.history?.points[2].returnFraction).toBeNull();
  });
  it("rejects READY with an unavailable valuation", () => {
    const d = fixture(); Object.assign(d.points[1], { index_level: null, return: null });
    expect(subject().prepareFactorHistory(d, options).history).toBeNull();
  });
  it("does not mutate the native candidate or copy arbitrary payload values", () => {
    const d = fixture(); const before = JSON.stringify(d);
    const r = subject().prepareFactorHistory({ ...d, vendor_secret: "never-copy-this" }, options);
    expect(JSON.stringify(d)).toBe(before);
    expect(JSON.stringify(r)).not.toContain("never-copy-this");
  });
});

describe("exact source-history windows", () => {
  it("preserves the three-member round trip and drifting holdings", () => {
    const r = subject().factorHistoryWindow(history(), full);
    expect(r.status).toBe("READY"); expect(r.returnFraction).toBeCloseTo(0, 12);
    expect(r.points[1].rebasedPercent).toBeCloseTo(33.3333333333333);
  });
  it("changing the display anchor does not rebalance: -25%, not -16.7%", () => {
    const r = subject().factorHistoryWindow(history(), { ...full, anchorDate: "2026-01-29" });
    expect(r.returnFraction).toBeCloseTo(-0.25, 12);
    expect(r.points[0].rebasedPercent).toBe(0);
  });
  it.each([
    { anchorDate: "2026-01-27", endDate: "2026-01-30" },
    { anchorDate: "2026-01-28", endDate: "2026-02-01" },
    { anchorDate: "2026-01-30", endDate: "2026-01-29" },
  ])("never substitutes a first-common anchor or nearby end: %j", window => {
    expect(subject().factorHistoryWindow(history(), window)).toMatchObject({ status: "UNAVAILABLE", points: [], returnFraction: null });
  });
  it("withholds a complete window return after a source gap", () => {
    const h = history(); h.points[2].level = null; h.points[2].returnFraction = null;
    const r = subject().factorHistoryWindow(h, full);
    expect(r.status).toBe("PARTIAL"); expect(r.returnFraction).toBeNull();
    expect(r.points[2].rebasedPercent).toBeNull();
  });
  it("does not invent an anchor level", () => {
    const h = history(); h.points[1].level = null;
    expect(subject().factorHistoryWindow(h, { ...full, anchorDate: "2026-01-29" }).status).toBe("UNAVAILABLE");
  });
  it("splits line geometry at gaps and source segment changes", () => {
    const p = subject().factorHistoryWindow(history(), full).points;
    const gap = { ...p[1], rebasedPercent: null };
    expect(subject().splitFactorSegments([p[0], gap, p[2]]).map(x => x.length)).toEqual([1, 1]);
    expect(subject().splitFactorSegments([p[0], { ...p[1], segmentId: 1 }]).map(x => x.length)).toEqual([1, 1]);
  });
});

describe("comparison and units", () => {
  it.each([[0.07, "+7.0%"], [-0.25, "-25.0%"], [0, "0.0%"], [-0, "0.0%"], [null, "—"], [Infinity, "—"]])(
    "formats fraction %s once", (value, expected) => expect(subject().formatFactorPercent(value)).toBe(expected));
  it("withholds mixed membership modes rather than implying comparable PIT", () => {
    const a = history(), b = history(); b.basketId = "fixture:second"; b.historyMode = "PIT_AS_KNOWN";
    const r = subject().compareFactorHistories([a, b], full);
    expect(r.status).toBe("INCOMPATIBLE"); expect(r.spreadFraction).toBeNull();
  });
  it("keeps a valid sibling when another exact anchor is unavailable", () => {
    const a = history(), b = history(); b.basketId = "fixture:second"; b.points[0].level = null;
    const r = subject().compareFactorHistories([a, b], full);
    expect(r.status).toBe("PARTIAL"); expect(r.series[0].window.status).toBe("READY");
    expect(r.spreadFraction).toBeNull();
  });
  it("computes only an explicitly named return difference, never a strategy P&L", () => {
    const a = history(), b = history(); b.basketId = "fixture:second";
    const r = subject().compareFactorHistories([a, b], full);
    expect(r.status).toBe("READY"); expect(r.spreadFraction).toBeCloseTo(0);
    expect(r.spreadDefinition).toBe("RETURN_DIFFERENCE_NOT_TRADEABLE_PNL");
  });
  it("rejects duplicate or more than eight selections", () => {
    expect(subject().compareFactorHistories([history(), history()], full).status).toBe("UNAVAILABLE");
    const many = Array.from({ length: 9 }, (_, i) => ({ ...history(), basketId: `fixture:${i}` }));
    expect(subject().compareFactorHistories(many, full).status).toBe("UNAVAILABLE");
  });
});
