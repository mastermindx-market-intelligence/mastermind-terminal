import { describe, expect, it } from "vitest";
import { buildCurrentBasket, completedReturnSession, dailyMoves, decodeReturnSeries, returnPath, returnSessions, trajectory } from "../returnsIntelligence";

const dates = returnSessions("2025-01-02", "2026-10-16")!;
function doc(closes: number[], symbol = "NVDA", qualified = true) {
  const days = dates.slice(-closes.length);
  return { t: symbol, src: "polygon", bar_quality: "real_ohlc", bars: closes.map((c, i) => [days[i], c, c, c, c, 100]),
    ...(qualified ? { view: { schema: "terminal.ohlc_view.v1", contract: { schema: "dataos.view_contract.v1", purpose: "terminal_daily_ohlc", identity_namespace: "mmx/us/daily", field_units: { close: "USD/share" }, coverage: { from: days[0], to: days.at(-1) }, adjustment_reference: { basis: "tradj", as_at: "2026-10-17T00:00:00Z" }, evidence_mode: { mode: "CURRENT" } },
      listing: { mic: "XNAS", src: "polygon" }, segments: [], basis_drift: null, suspected_breaks: [], refusal_reasons: [] } } : {}) };
}
function fromMoves(moves: number[], symbol = "NVDA") { let price = 100; return decodeReturnSeries(symbol, doc([price, ...moves.map(r => price *= Math.exp(r))], symbol)); }
const flat = (n: number) => Array<number>(n).fill(0);

describe("returns trajectory math and source boundaries", () => {
  it("compounds wealth, and labels a relative wealth ratio separately from percentage-point excess", () => {
    const a = fromMoves([...flat(62), Math.log(1.1), Math.log(0.9)]), b = fromMoves([...flat(64)], "SPY");
    expect(trajectory(a, 5).returnPct).toBeCloseTo(-1, 10);
    expect(returnPath(a, b, 5).at(-1)?.relative).toBeCloseTo(-1, 10);
    const c = fromMoves([...flat(63), Math.log(1.1)], "SPY");
    expect(returnPath(a, c, 5).at(-1)?.relative).toBeCloseTo(-10, 10);
  });
  it("requires a Macro adjustment receipt rather than inferring it from a vendor name", () => {
    const data = doc(Array.from({ length: 150 }, (_, i) => 100 + i), "NVDA", false);
    const s = decodeReturnSeries("NVDA", data), t = trajectory(s, 21);
    expect(s.basis).toBe("reported_price"); expect(s.quality).toBe("unverified");
    expect(t.returnPct).not.toBeNull(); expect(t.direction).toBe("unqualified");
  });
  it("accepts a real long-history payload while calculations use the supported session window", () => {
    const d = doc(Array<number>(300).fill(100));
    d.bars = [...Array.from({ length: 7000 }, () => ["2000-01-03", 100, 100, 100, 100, 100]), ...d.bars];
    expect(decodeReturnSeries("NVDA", d).issues).not.toContain("INVALID_SERIES");
    expect(dailyMoves(decodeReturnSeries("NVDA", d)).at(-1)?.returnPct).toBe(0);
  });
  it("does not promote a basis-only object into the published contract", () => {
    const d = doc(Array<number>(150).fill(100));
    Object.assign(d.view!.contract, { schema: "wrong" });
    const s = decodeReturnSeries("NVDA", d);
    expect(s.quality).toBe("unverified"); expect(s.basis).toBe("reported_price");
  });
  it("preserves an interior gap: endpoint return may survive, daily risk and pace do not", () => {
    const d = doc(Array.from({ length: 150 }, (_, i) => 100 + i)); d.bars.splice(-10, 1);
    const s = decodeReturnSeries("NVDA", d), t = trajectory(s, 21);
    expect(t.returnPct).not.toBeNull(); expect(t.complete).toBe(false);
    expect(t.volatilityPct).toBeNull(); expect(t.pacePct).toBeNull();
    expect(returnPath(s, null, 21).some(p => p.value === null)).toBe(true);
    expect(dailyMoves(s).slice(-12).some(m => m.returnPct === null)).toBe(true);
  });
  it("refuses basis drift rather than interpreting a split as a crash", () => {
    const d = doc([...Array<number>(130).fill(100), ...Array<number>(20).fill(50)]);
    Object.assign(d.view!, { basis_drift: { status: "SUSPECTED", date: dates.at(-20) }, refusal_reasons: ["BASIS_DRIFT_SUSPECTED"] });
    const s = decodeReturnSeries("NVDA", d);
    expect(s.quality).toBe("refused"); expect(trajectory(s, 21).returnPct).toBeNull(); expect(returnPath(s, null, 63)).toEqual([]);
  });
  it("does not call a slowing decline an accelerating ascent", () => {
    const t = trajectory(fromMoves([...Array<number>(100).fill(-0.01), ...Array<number>(21).fill(-0.003)]), 21);
    expect(t.direction).toBe("falling"); expect(t.paceChange).toBe("falling_slower"); expect(t.paceDeltaPp).toBeGreaterThan(0);
  });
  it("distinguishes a smooth ascent from a single dominating session with the same endpoint", () => {
    const a = trajectory(fromMoves([...flat(100), ...Array<number>(21).fill(0.01)]), 21);
    const b = trajectory(fromMoves([...flat(120), 0.21]), 21);
    expect(a.returnPct).toBeCloseTo(b.returnPct!, 8); expect(a.concentration).toBeCloseTo(1 / 21, 8); expect(b.concentration).toBeCloseTo(1, 8);
  });
  it("retains large drawdown for a round trip rather than calling it quiet sideways", () => {
    const t = trajectory(fromMoves([...flat(100), ...Array<number>(10).fill(0.06), ...Array<number>(10).fill(-0.06), 0]), 21);
    expect(t.returnPct).toBeCloseTo(0, 8); expect(t.drawdownPct).toBeLessThan(-40); expect(t.direction).not.toBe("sideways");
  });
  it("rejects a forced direction when endpoint and fitted slope disagree", () => {
    const t = trajectory(fromMoves([...flat(100), Math.log(2), ...Array<number>(20).fill(Math.log(0.98))]), 21);
    expect(t.returnPct).toBeGreaterThan(0); expect(t.pacePct).toBeLessThan(0); expect(t.direction).toBe("mixed");
  });
  it("treats flat efficiency as undefined and keeps real zero risk finite", () => {
    const t = trajectory(fromMoves(flat(150)), 63);
    expect(t.efficiency).toBeNull(); expect(t.concentration).toBeNull(); expect(t.volatilityPct).toBe(0); expect(t.drawdownPct).toBe(0); expect(t.direction).toBe("sideways");
  });
  it("keeps short and long horizon disagreement visible", () => {
    const s = fromMoves([...Array<number>(140).fill(-0.008), ...Array<number>(5).fill(0.015)]);
    expect(trajectory(s, 5).direction).toBe("rising"); expect(trajectory(s, 63).direction).toBe("falling");
  });
  it("removes conflicting duplicates, preserving the missing-session consequence", () => {
    const d = doc(Array<number>(150).fill(100)); d.bars.push([...d.bars.at(-3)!.slice(0, 4), 101, 100]);
    const t = trajectory(decodeReturnSeries("NVDA", d), 5);
    expect(t.issues).toContain("CONFLICTING_DUPLICATE"); expect(t.complete).toBe(false);
  });
  it("does not manufacture traded opens from a reconstructed-open feed", () => {
    const d = doc(Array<number>(150).fill(100)); d.bar_quality = "synthetic_open_deepstore";
    expect(dailyMoves(decodeReturnSeries("NVDA", d)).at(-1)?.openingGapPct).toBeNull();
  });
  it("uses actual NYSE holidays and early-close completion", () => {
    expect(returnSessions("2026-07-02", "2026-07-06")).toEqual(["2026-07-02", "2026-07-06"]);
    expect(completedReturnSession(new Date("2026-11-27T17:59:00Z"))).toBe("2026-11-25");
    expect(completedReturnSession(new Date("2026-11-27T18:01:00Z"))).toBe("2026-11-27");
    expect(returnSessions("2015-12-31", "2016-01-04")).toBeNull();
  });
  it("excludes incomplete or future sessions at the read boundary", () => {
    const d = doc(Array<number>(150).fill(100));
    expect(decodeReturnSeries("NVDA", d, dates.at(-2)!).asOf).toBe(dates.at(-2));
  });
  it("rejects symbol mismatch and out-of-scope trading calendars", () => {
    expect(decodeReturnSeries("AAPL", doc([100, 101])).quality).toBe("refused");
    expect(decodeReturnSeries("0700.HK", doc([100, 101], "0700.HK")).quality).toBe("refused");
  });
});

describe("current-members reconstructed baskets", () => {
  it("compounds equal-weight simple returns, not an average of logs", () => {
    const a = fromMoves([...flat(100), Math.log(2)], "AAA"), b = fromMoves([...flat(100), Math.log(0.5)], "BBB");
    const r = buildCurrentBasket([a, b], 5, "2026-10-16");
    expect(r.status).toBe("ready");
    if (r.status === "ready") { expect(trajectory(r.series, 5).returnPct).toBeCloseTo(25, 8); expect(r.upShare).toBe(0.5); expect(r.series.composite?.history).toBe("current_members_reconstructed"); }
  });
  it("never drops a new or missing constituent from the denominator", () => {
    const a = fromMoves(flat(100), "AAA"), b = fromMoves(flat(2), "BBB");
    expect(buildCurrentBasket([a, b], 21, "2026-10-16")).toMatchObject({ status: "incomplete", reason: "INSUFFICIENT_COMMON_HISTORY" });
    const c = fromMoves(flat(100), "CCC"); c.bars.splice(-10, 1);
    expect(buildCurrentBasket([a, c], 5, "2026-10-16")).toMatchObject({ status: "incomplete", reason: "INCOMPLETE_MEMBERSHIP_HISTORY", missing: ["CCC"] });
  });
  it("exposes narrow leadership independently of a positive basket return", () => {
    const inputs = [0.5, -0.04, -0.03, -0.02, -0.01].map((r, i) => fromMoves([...flat(100), r], `A${i}`));
    const r = buildCurrentBasket(inputs, 21, "2026-10-16");
    if (r.status !== "ready") throw new Error(r.reason);
    expect(trajectory(r.series, 21).returnPct).toBeGreaterThan(0); expect(r.upShare).toBe(0.2); expect(r.medianReturnPct).toBeLessThan(0);
  });
  it("refuses mixed return bases and duplicate memberships", () => {
    const a = fromMoves(flat(100), "AAA"), b = decodeReturnSeries("BBB", doc(Array<number>(101).fill(100), "BBB", false));
    expect(buildCurrentBasket([a, b], 5, "2026-10-16")).toMatchObject({ reason: "INCOMPARABLE_BASES" });
    expect(buildCurrentBasket([a, a], 5, "2026-10-16")).toMatchObject({ reason: "INVALID_MEMBERSHIP" });
  });
});
