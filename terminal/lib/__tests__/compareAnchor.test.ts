import { describe, expect, it } from "vitest";
import {
  ASOF_MAX_DAYS, CMP_DIM_ALPHA, CMP_GAP_COLOR, CMP_LINE_CAVEAT, CMP_LINE_INCOMPARABLE, anchorSpecOf, basisOf,
  buildCompareStudy, comparabilityOf, compareLineLook, currencyOf, isAnchorDate, joinKey, legComparabilityMark,
  resolveHostAnchor, visibleStartDate, withAnchor,
  type CmpBar, type CompareStudyInput,
} from "@/lib/compareAnchor";
import { CMP_LINE_STYLES, defaultCmpCfg, type CmpCfg } from "@/lib/compare";
import { applyLayoutConfig, captureLayoutConfig, normalizeLayoutConfig, type LayoutWorkspace } from "@/lib/layoutConfig";
import { SCHEMA, validateEnvelope } from "@/lib/workspaceLayout";

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────
// Weekday sessions between two dates, minus explicit closures. Closes are a deterministic
// function of the DATE (not the row index), so a deeper or shallower history of the same series
// carries identical values on every shared session — exactly what a later, longer load is.
const DAY = 86_400_000;
function sessions(from: string, to: string, closed: string[] = []): string[] {
  const out: string[] = [];
  const shut = new Set(closed);
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += DAY) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (wd !== 0 && wd !== 6 && !shut.has(iso)) out.push(iso);
  }
  return out;
}
const dayIndex = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / DAY);
const series = (dates: string[], base: number, drift: number, wobble = 0): CmpBar[] =>
  dates.map((d) => {
    const k = dayIndex(d) - dayIndex("2020-01-01");
    return { time: d, c: +(base * (1 + drift * k) + wobble * Math.sin(k / 7)).toFixed(4) };
  });

const HOST_DATES = sessions("2023-01-02", "2024-06-28", ["2023-07-04", "2023-12-25", "2024-01-01"]);
const HOST = series(HOST_DATES, 150, 0.0006, 3);
const QQQ = series(HOST_DATES, 300, 0.0009, 5);
const SPY = series(HOST_DATES, 400, 0.0004, 4);

const pinned = (idx: number, anchor: string, src: "date" | "window" = "date"): CmpCfg => ({ ...defaultCmpCfg(idx), anchor, anchorSrc: src });
const input = (over: Partial<CompareStudyInput> & { legs: CompareStudyInput["legs"] }): CompareStudyInput => ({
  host: { symbol: "AAPL", rows: HOST, src: "polygon" },
  timeframe: "D",
  prec: 2,
  ...over,
});
const leg = (symbol: string, cfg: CmpCfg, rows: CmpBar[], src: string | null = "polygon") =>
  ({ symbol, cfg, load: { status: "data" as const, rows, src } });
const legOf = (b: ReturnType<typeof buildCompareStudy>, sym: string) => b.study.legs.find((l) => l.symbol === sym)!;
const seriesOf = (b: ReturnType<typeof buildCompareStudy>, sym: string) => b.series.find((s) => s.symbol === sym)!.data;
const valueAt = (data: { time: string; value: number }[], t: string) => data.find((p) => p.time === t)?.value;

// The pre-E08 adapter, reproduced VERBATIM from ChartPanel.rebuildCompare's percent branch (the
// date join, the first-common base, and the `lv` carry-forward), so the tests below can show what
// the old behaviour does on the same inputs.
function legacyPercent(rows: CmpBar[], legRows: CmpBar[], prec: number) {
  const cmap: Record<string, number> = {}; for (const cr of legRows) cmap[cr.time] = cr.c;
  let lv: number | null = null;
  let bse = 0, baseA = rows[0]?.c ?? 0; let at: string | null = null;
  for (const r of rows) { if (cmap[r.time] != null) { bse = cmap[r.time]; baseA = r.c; at = r.time; break; } }
  if (!bse) return null; const scl = baseA / bse;
  const data = rows.map((r) => { const v = cmap[r.time]; if (v != null) lv = v; return lv != null ? { time: r.time, value: +(lv * scl).toFixed(prec) } : null; }).filter(Boolean) as { time: string; value: number }[];
  return { anchor: at!, data };
}

// ── THE FALSIFIER ─────────────────────────────────────────────────────────────────────────────
// "The same saved study gives a different anchor solely because one series loaded later."
describe("falsifier — a saved study's anchor never depends on what loaded when", () => {
  const ANCHOR = "2024-01-02";
  const savedLegs = (qqqRows: CmpBar[], spyRows: CmpBar[]) => [leg("QQQ", pinned(0, ANCHOR), qqqRows), leg("SPY", pinned(1, ANCHOR), spyRows)];

  it("a leg whose deeper history arrives later keeps the pinned anchor and every shared value", () => {
    const shallowQqq = QQQ.filter((r) => r.time >= "2023-09-01");      // first answer: a short cached copy
    const early = buildCompareStudy(input({ legs: savedLegs(shallowQqq, SPY) }));
    const late = buildCompareStudy(input({ legs: savedLegs(QQQ, SPY) }));   // the full history landed later
    expect(legOf(early, "QQQ").anchor?.effective).toBe(ANCHOR);
    expect(legOf(late, "QQQ").anchor?.effective).toBe(ANCHOR);
    expect(legOf(late, "QQQ").anchor).toEqual(legOf(early, "QQQ").anchor);
    const lateData = seriesOf(late, "QQQ");
    for (const p of seriesOf(early, "QQQ")) expect(valueAt(lateData, p.time)).toBe(p.value);
    expect(legOf(late, "QQQ").stat).toEqual(legOf(early, "QQQ").stat);
  });

  it("the host's deeper history arriving later keeps the pinned anchor and every shared value", () => {
    const recentHost = HOST.filter((r) => r.time >= "2023-10-02");
    const early = buildCompareStudy(input({ host: { symbol: "AAPL", rows: recentHost, src: "polygon" }, legs: savedLegs(QQQ, SPY) }));
    const late = buildCompareStudy(input({ legs: savedLegs(QQQ, SPY) }));
    for (const sym of ["QQQ", "SPY"]) {
      expect(legOf(late, sym).anchor).toEqual(legOf(early, sym).anchor);
      const lateData = seriesOf(late, sym);
      for (const p of seriesOf(early, sym)) expect(valueAt(lateData, p.time)).toBe(p.value);
    }
  });

  it("leg order and a leg added later never move another leg's anchor", () => {
    const ab = buildCompareStudy(input({ legs: savedLegs(QQQ, SPY) }));
    const ba = buildCompareStudy(input({ legs: [...savedLegs(QQQ, SPY)].reverse() }));
    const solo = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, ANCHOR), QQQ)] }));
    expect(legOf(ba, "QQQ")).toEqual(legOf(ab, "QQQ"));
    expect(legOf(ba, "SPY")).toEqual(legOf(ab, "SPY"));
    expect(legOf(solo, "QQQ")).toEqual(legOf(ab, "QQQ"));
    expect(ab.study.mixedAnchors).toBe(false);
  });

  it("the auto default is per-leg: another leg's late arrival cannot move it", () => {
    const autoQqq = leg("QQQ", defaultCmpCfg(0), QQQ.filter((r) => r.time >= "2023-03-01"));
    const lateLeg = leg("SPY", defaultCmpCfg(1), SPY);
    const alone = buildCompareStudy(input({ legs: [autoQqq] }));
    const both = buildCompareStudy(input({ legs: [lateLeg, autoQqq] }));
    expect(legOf(both, "QQQ")).toEqual(legOf(alone, "QQQ"));
    expect(legOf(both, "QQQ").policy).toBe("auto");
    expect(legOf(both, "QQQ").anchor?.hostRule).toBe("first_common");
  });

  it("WITHOUT the change: the legacy adapter re-anchors the same study when deeper history loads later", () => {
    // Negative control. The verbatim legacy rebase on the two load states of the leg above: its
    // anchor jumps from the short copy's first session to the full history's, and every value on
    // the sessions both builds share changes with it. This is the falsifier holding against the
    // old code — the assertion that the pinned engine passes is one the legacy code fails.
    const shallowQqq = QQQ.filter((r) => r.time >= "2023-09-01");
    const before = legacyPercent(HOST, shallowQqq, 2)!;
    const after = legacyPercent(HOST, QQQ, 2)!;
    expect(before.anchor).not.toBe(after.anchor);
    const shared = before.data.filter((p) => valueAt(after.data, p.time) !== undefined);
    expect(shared.length).toBeGreaterThan(100);
    expect(shared.some((p) => valueAt(after.data, p.time) !== p.value)).toBe(true);
  });
});

// ── AC-E08-01: every drawn rebased series names its effective anchor and basis ─────────────────
describe("AC-E08-01 — effective anchor and basis are named for every rebased line", () => {
  it("a pinned date on a market holiday rolls to the next host session and says so", () => {
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2023-12-25"), QQQ)] }));
    const r = legOf(b, "QQQ");
    expect(r.status).toBe("drawn");
    expect(r.requested).toBe("2023-12-25");
    expect(r.anchor).toMatchObject({ effective: "2023-12-26", hostRule: "next_session", legTime: "2023-12-26", legRule: "exact" });
    expect(r.basis).toBe("price");
    expect(r.currency).toBe("USD");
    expect(r.src).toBe("polygon");
  });

  it("a pinned weekend date rolls to Monday; an exact session is exact", () => {
    const sat = legOf(buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-03-02"), QQQ)] })), "QQQ");
    expect(sat.anchor).toMatchObject({ effective: "2024-03-04", hostRule: "next_session" });
    const exact = legOf(buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-03-04"), QQQ)] })), "QQQ");
    expect(exact.anchor).toMatchObject({ effective: "2024-03-04", hostRule: "exact" });
  });

  it("the rebased value at the anchor equals the host close there", () => {
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ)] }));
    const hostClose = HOST.find((r) => r.time === "2024-01-02")!.c;
    expect(valueAt(seriesOf(b, "QQQ"), "2024-01-02")).toBe(+hostClose.toFixed(2));
  });

  it("raw price legs are drawn on their own scale with no anchor claim", () => {
    const b = buildCompareStudy(input({ legs: [leg("QQQ", { ...defaultCmpCfg(0), mode: "price" }, QQQ)] }));
    const r = legOf(b, "QQQ");
    expect(r.status).toBe("drawn");
    expect(r.anchor).toBeNull();
    expect(r.stat).toBeNull();
    expect(valueAt(seriesOf(b, "QQQ"), "2024-01-02")).toBe(+QQQ.find((x) => x.time === "2024-01-02")!.c.toFixed(2));
  });

  it("mixed effective anchors across drawn legs are flagged", () => {
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ), leg("SPY", defaultCmpCfg(1), SPY)] }));
    expect(b.study.mixedAnchors).toBe(true);
  });
});

// ── AC-E08-02: missing anchor observations are withheld or follow ONE documented rule ──────────
describe("AC-E08-02 — no invented observations", () => {
  it("a leg listed after the pinned date is withheld, with its first bar disclosed", () => {
    const ipo = QQQ.filter((r) => r.time >= "2024-02-01");
    const r = legOf(buildCompareStudy(input({ legs: [leg("NEWCO", pinned(0, "2024-01-02"), ipo)] })), "NEWCO");
    expect(r.status).toBe("withheld");
    expect(r.reason).toBe("anchor_before_leg_history");
    expect(r.firstTime).toBe("2024-02-01");
  });

  it("a leg whose market was closed on the anchor uses its prior close within the documented window", () => {
    const hk = series(sessions("2023-01-02", "2024-06-28", ["2024-02-12", "2024-02-13"]), 80, 0.0003, 1);
    const r = legOf(buildCompareStudy(input({ legs: [leg("HKX", pinned(0, "2024-02-13"), hk)] })), "HKX");
    expect(r.status).toBe("drawn");
    expect(r.anchor).toMatchObject({ effective: "2024-02-13", legTime: "2024-02-09", legRule: "prior_session" });
  });

  it("beyond the as-of window the leg is withheld, never back-filled", () => {
    const closed = sessions("2024-01-22", "2024-02-02");               // a two-week suspension
    const susp = QQQ.filter((r) => !closed.includes(r.time));
    expect(closed.length).toBeGreaterThan(ASOF_MAX_DAYS);
    const r = legOf(buildCompareStudy(input({ legs: [leg("SUSP", pinned(0, "2024-02-01"), susp)] })), "SUSP");
    expect(r.status).toBe("withheld");
    expect(r.reason).toBe("anchor_no_observation");
  });

  it("never uses a LATER leg close for the anchor (no look-ahead)", () => {
    const missingDay = QQQ.filter((r) => r.time !== "2024-01-02");
    const r = legOf(buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), missingDay)] })), "QQQ");
    expect(r.anchor!.legTime < "2024-01-02").toBe(true);
  });

  it("unmatched host sessions are left blank, the bridging segment is transparent, and the count is reported", () => {
    const gap = new Set(sessions("2024-03-11", "2024-03-15"));
    const holey = QQQ.filter((r) => !gap.has(r.time));
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), holey)] }));
    const data = seriesOf(b, "QQQ");
    for (const t of gap) expect(valueAt(data, t)).toBeUndefined();
    const before = data.findIndex((p) => p.time === "2024-03-08");
    expect(data[before].color).toBe(CMP_GAP_COLOR);
    expect(data.filter((p) => p.color).length).toBe(1);
    expect(legOf(b, "QQQ").unmatched).toBe(5);
    // The legacy adapter carried the last close straight through the same hole.
    const legacy = legacyPercent(HOST, holey, 2)!;
    for (const t of gap) expect(valueAt(legacy.data, t)).toBe(valueAt(legacy.data, "2024-03-08"));
  });

  it("a pinned date past the last bar shown (a replay position) withholds every rebased leg", () => {
    const replayRows = HOST.filter((r) => r.time <= "2023-11-30");
    const b = buildCompareStudy(input({ host: { symbol: "AAPL", rows: replayRows }, legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ)] }));
    expect(legOf(b, "QQQ")).toMatchObject({ status: "withheld", reason: "anchor_after_host_end" });
    expect(b.series).toHaveLength(0);
  });

  it("a pinned date before the host's history, or in a wide host data hole, is withheld", () => {
    expect(legOf(buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2022-06-01"), QQQ)] })), "QQQ").reason).toBe("anchor_before_host_history");
    const hole = new Set(sessions("2024-01-02", "2024-01-31"));
    const holeyHost = HOST.filter((r) => !hole.has(r.time));
    const b = buildCompareStudy(input({ host: { symbol: "AAPL", rows: holeyHost }, legs: [leg("QQQ", pinned(0, "2024-01-03"), QQQ)] }));
    expect(legOf(b, "QQQ").reason).toBe("anchor_gap_too_wide");
  });

  it("absent and unavailable reads are reported as such — not as empty data", () => {
    const b = buildCompareStudy(input({ legs: [
      { symbol: "GONE", cfg: defaultCmpCfg(0), load: { status: "absent" } },
      { symbol: "DOWN", cfg: defaultCmpCfg(1), load: { status: "unavailable" } },
    ] }));
    expect(legOf(b, "GONE").status).toBe("absent");
    expect(legOf(b, "DOWN").status).toBe("unavailable");
    expect(b.series).toHaveLength(0);
  });

  it("non-positive or non-finite closes are never used as observations", () => {
    const bad = QQQ.map((r) => (r.time === "2024-01-02" ? { ...r, c: 0 } : r.time === "2024-01-03" ? { ...r, c: Number.NaN } : r));
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), bad)] }));
    expect(legOf(b, "QQQ").anchor).toMatchObject({ legTime: "2023-12-29", legRule: "prior_session" });
    expect(valueAt(seriesOf(b, "QQQ"), "2024-01-02")).toBeUndefined();
    expect(valueAt(seriesOf(b, "QQQ"), "2024-01-03")).toBeUndefined();
  });
});

// ── splits, corrections, timeframes ───────────────────────────────────────────────────────────
describe("splits, corrections, and calendar timeframes", () => {
  it("a uniformly re-scaled (split-adjusted) leg draws identical rebased values", () => {
    const split = QQQ.map((r) => ({ ...r, c: r.c / 4 }));
    const a = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ)] }));
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), split)] }));
    expect(seriesOf(b, "QQQ")).toEqual(seriesOf(a, "QQQ"));
    expect(legOf(b, "QQQ").stat).toEqual(legOf(a, "QQQ").stat);
  });

  it("a correction after the anchor changes only that point; one AT the anchor re-bases and changes the digest", () => {
    const base = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ)] }));
    const fixLater = QQQ.map((r) => (r.time === "2024-04-01" ? { ...r, c: r.c * 1.01 } : r));
    const later = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), fixLater)] }));
    const diff = seriesOf(later, "QQQ").filter((p) => valueAt(seriesOf(base, "QQQ"), p.time) !== p.value).map((p) => p.time);
    expect(diff).toEqual(["2024-04-01"]);
    expect(later.study.digest).not.toBe(base.study.digest);
    const fixAnchor = QQQ.map((r) => (r.time === "2024-01-02" ? { ...r, c: r.c * 1.01 } : r));
    const atAnchor = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), fixAnchor)] }));
    expect(legOf(atAnchor, "QQQ").anchor!.effective).toBe("2024-01-02");
    expect(valueAt(seriesOf(atAnchor, "QQQ"), "2024-03-01")).not.toBe(valueAt(seriesOf(base, "QQQ"), "2024-03-01"));
  });

  it("weekly bars join on the calendar week, so a holiday-shortened week is not a false gap", () => {
    // Host week ending Friday; leg week ending Thursday (Good Friday closed) — the same ISO week.
    expect(joinKey("W", "2024-03-29")).toBe(joinKey("W", "2024-03-28"));
    expect(joinKey("1M", "2024-03-28")).toBe("2024-03");
    expect(joinKey("3M", "2024-03-28")).toBe("2024-Q0");
    expect(joinKey("D", "2024-03-28")).toBe("2024-03-28");
    const host = [{ time: "2024-03-22", c: 10 }, { time: "2024-03-29", c: 11 }, { time: "2024-04-05", c: 12 }];
    const lg = [{ time: "2024-03-22", c: 100 }, { time: "2024-03-28", c: 120 }, { time: "2024-04-05", c: 90 }];
    const b = buildCompareStudy({ host: { symbol: "AAPL", rows: host, src: "polygon" }, timeframe: "W", prec: 2, legs: [leg("HKX", pinned(0, "2024-03-25"), lg)] });
    const r = legOf(b, "HKX");
    expect(r.anchor).toMatchObject({ effective: "2024-03-29", legTime: "2024-03-28", legRule: "exact" });
    expect(seriesOf(b, "HKX").map((p) => p.value)).toEqual([9.17, 11, 8.25]);
    expect(r.unmatched).toBe(0);
  });

  it("a monthly bar keyed by its last session accepts a pin on the month's first day", () => {
    expect(resolveHostAnchor([{ time: "2024-01-31", c: 1 }, { time: "2024-02-29", c: 1 }], "1M", "2024-01-01")).toEqual({ ok: true, index: 0, rule: "next_session" });
    expect(resolveHostAnchor([{ time: "2024-01-31", c: 1 }], "D", "2024-01-01")).toEqual({ ok: false, reason: "anchor_before_host_history" });
  });
});

// ── AC-E08-03: incompatible currency or return bases are never like-for-like outperformance ────
describe("AC-E08-03 — comparability", () => {
  it("derives the return basis from the writer and the symbol shape", () => {
    expect(basisOf("AAPL", "polygon")).toBe("price");
    expect(basisOf("BTC-USD", "coinbase")).toBe("price");
    expect(basisOf("AAPL", "yahoo")).toBe("adjusted");
    expect(basisOf("BTC-USD", "yahoo")).toBe("price");
    expect(basisOf("^GSPC", "yahoo")).toBe("price");
    expect(basisOf("^TNX", "yahoo")).toBe("level");
    expect(basisOf("DFII10", "fred")).toBe("level");
    expect(basisOf("GC=F", "yahoo")).toBe("unknown");
    expect(basisOf("600519.SS", "deep")).toBe("unknown");
    expect(basisOf("AAPL", null)).toBe("unknown");
    expect(basisOf("AAPL+MSFT", "polygon")).toBe("unknown");
  });

  it("derives currency from the listing venue and admits what it cannot establish", () => {
    expect(currencyOf("AAPL")).toBe("USD");
    expect(currencyOf("BTC-USD")).toBe("USD");
    expect(currencyOf("ETH-USDT")).toBe("USDT");
    expect(currencyOf("0700.HK")).toBe("HKD");
    expect(currencyOf("600519.SS")).toBe("CNY");
    expect(currencyOf("SHOP.TO")).toBe("CAD");
    expect(currencyOf("VOD.L")).toBeNull();
    expect(currencyOf("^GSPC")).toBeNull();
    expect(currencyOf("EURUSD=X")).toBeNull();
  });

  it("grades pairs", () => {
    const usdPrice = { basis: "price" as const, currency: "USD" };
    expect(comparabilityOf(usdPrice, usdPrice)).toEqual({ state: "comparable" });
    expect(comparabilityOf(usdPrice, { basis: "price", currency: "HKD" })).toEqual({ state: "incomparable", reason: "currency_mismatch" });
    expect(comparabilityOf(usdPrice, { basis: "price", currency: null })).toEqual({ state: "incomparable", reason: "currency_unknown" });
    expect(comparabilityOf(usdPrice, { basis: "adjusted", currency: "USD" })).toEqual({ state: "incomparable", reason: "basis_mismatch" });
    expect(comparabilityOf(usdPrice, { basis: "level", currency: "USD" })).toEqual({ state: "incomparable", reason: "basis_level" });
    expect(comparabilityOf(usdPrice, { basis: "unknown", currency: "USD" })).toEqual({ state: "incomparable", reason: "basis_unknown" });
    const adj = { basis: "adjusted" as const, currency: "USD" };
    expect(comparabilityOf(adj, adj)).toEqual({ state: "caveat", reason: "basis_adjusted" });
  });

  it("a cross-currency leg is still drawn, but its spread is withheld", () => {
    const b = buildCompareStudy(input({ legs: [leg("0700.HK", pinned(0, "2024-01-02"), QQQ, "polygon"), leg("QQQ", pinned(1, "2024-01-02"), QQQ)] }));
    const hk = legOf(b, "0700.HK");
    expect(hk.status).toBe("drawn");
    expect(hk.stat).toMatchObject({ comparability: "incomparable", reason: "currency_mismatch", spreadPp: null });
    expect(Number.isFinite(hk.stat!.legRet)).toBe(true);
    const us = legOf(b, "QQQ");
    expect(us.stat!.comparability).toBe("comparable");
    expect(us.stat!.spreadPp).toBeCloseTo((us.stat!.legRet - us.stat!.hostRet) * 100, 10);
  });

  it("a rebased leg that is not like-for-like carries an always-visible mark; a like-for-like one does not", () => {
    const b = buildCompareStudy(input({ legs: [leg("0700.HK", pinned(0, "2024-01-02"), QQQ, "yahoo"), leg("QQQ", pinned(1, "2024-01-02"), QQQ)] }));
    expect(legComparabilityMark(legOf(b, "0700.HK"))).toEqual({ state: "incomparable", reason: "currency_mismatch", currency: "HKD" });
    expect(legComparabilityMark(legOf(b, "QQQ"))).toBeNull();
    // Both adjusted closes (production US documents are src=yahoo): a caveat mark, not "comparable".
    const adj = buildCompareStudy(input({ host: { symbol: "AAPL", rows: HOST, src: "yahoo" }, legs: [leg("SPY", pinned(0, "2024-01-02"), SPY, "yahoo")] }));
    expect(legComparabilityMark(legOf(adj, "SPY"))).toEqual({ state: "caveat", reason: "basis_adjusted", currency: "USD" });
    // Each incomparable reason reaches the mark.
    const lvl = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ, "fred")] }));
    expect(legComparabilityMark(legOf(lvl, "QQQ"))).toMatchObject({ state: "incomparable", reason: "basis_level" });
    const mix = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ, "yahoo")] }));
    expect(legComparabilityMark(legOf(mix, "QQQ"))).toMatchObject({ state: "incomparable", reason: "basis_mismatch" });
  });

  it("no mark where nothing is presented as relative performance: raw-price, withheld, absent", () => {
    const raw = buildCompareStudy(input({ legs: [leg("0700.HK", { ...defaultCmpCfg(0, "price") }, QQQ, "yahoo")] }));
    expect(legOf(raw, "0700.HK").status).toBe("drawn");
    expect(legComparabilityMark(legOf(raw, "0700.HK"))).toBeNull();
    const late = QQQ.filter((r) => r.time >= "2024-03-01");
    const withheld = buildCompareStudy(input({ legs: [leg("0700.HK", pinned(0, "2024-01-02"), late, "yahoo")] }));
    expect(legOf(withheld, "0700.HK").status).toBe("withheld");
    expect(legComparabilityMark(legOf(withheld, "0700.HK"))).toBeNull();
    const absent = buildCompareStudy(input({ legs: [{ symbol: "0700.HK", cfg: pinned(0, "2024-01-02"), load: { status: "absent" } }] }));
    expect(legComparabilityMark(legOf(absent, "0700.HK"))).toBeNull();
    expect(legComparabilityMark(null)).toBeNull();
  });

  it("the chart look follows the mark, with styles no user can pick, and never touches the cfg", () => {
    const userStyles = CMP_LINE_STYLES.map((o) => o.v);
    expect(userStyles).not.toContain(CMP_LINE_INCOMPARABLE);
    expect(userStyles).not.toContain(CMP_LINE_CAVEAT);
    expect(CMP_LINE_INCOMPARABLE).not.toBe(CMP_LINE_CAVEAT);
    const hkCfg = pinned(0, "2024-01-02");
    const b = buildCompareStudy(input({ legs: [leg("0700.HK", hkCfg, QQQ, "yahoo"), leg("QQQ", { ...pinned(1, "2024-01-02"), lineStyle: 1 }, QQQ)] }));
    expect(compareLineLook(hkCfg.lineStyle, legOf(b, "0700.HK"))).toEqual({ lineStyle: CMP_LINE_INCOMPARABLE, dimAlpha: CMP_DIM_ALPHA });
    expect(compareLineLook(1, legOf(b, "QQQ"))).toEqual({ lineStyle: 1, dimAlpha: null });   // like-for-like keeps its own style
    const adj = buildCompareStudy(input({ host: { symbol: "AAPL", rows: HOST, src: "yahoo" }, legs: [leg("SPY", { ...pinned(0, "2024-01-02"), lineStyle: 2 }, SPY, "yahoo")] }));
    expect(compareLineLook(2, legOf(adj, "SPY"))).toEqual({ lineStyle: CMP_LINE_CAVEAT, dimAlpha: null });
    const raw = buildCompareStudy(input({ legs: [leg("0700.HK", { ...defaultCmpCfg(0, "price"), lineStyle: 2 }, QQQ, "yahoo")] }));
    expect(compareLineLook(2, legOf(raw, "0700.HK"))).toEqual({ lineStyle: 2, dimAlpha: null });   // raw price keeps its style
    expect(compareLineLook(0, undefined)).toEqual({ lineStyle: 0, dimAlpha: null });
    expect(hkCfg).toEqual(pinned(0, "2024-01-02"));
  });

  it("the spread window ends on the last session both series observed", () => {
    const ended = QQQ.filter((r) => r.time <= "2024-05-31");
    const r = legOf(buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), ended)] })), "QQQ");
    expect(r.stat!.end).toBe("2024-05-31");
    const h0 = HOST.find((x) => x.time === "2024-01-02")!.c, h1 = HOST.find((x) => x.time === "2024-05-31")!.c;
    expect(r.stat!.hostRet).toBeCloseTo(h1 / h0 - 1, 12);
  });
});

// ── AC-E08-04: visible range never moves a pinned anchor ──────────────────────────────────────
describe("AC-E08-04 — the window pin is captured once, as a date", () => {
  it("normalises every lightweight-charts time shape to a calendar date", () => {
    expect(visibleStartDate("2024-01-02")).toBe("2024-01-02");
    expect(visibleStartDate({ year: 2024, month: 1, day: 2 })).toBe("2024-01-02");
    expect(visibleStartDate(Date.UTC(2024, 0, 2) / 1000)).toBe("2024-01-02");
    expect(visibleStartDate(null)).toBeNull();
    expect(visibleStartDate("garbage")).toBeNull();
  });

  it("a window pin is stored as the captured date; the policy itself is never stored", () => {
    const cfg = withAnchor(defaultCmpCfg(0), "2024-01-02", "window");
    expect(cfg).toEqual({ ...defaultCmpCfg(0), anchor: "2024-01-02", anchorSrc: "window" });
    expect(anchorSpecOf(cfg)).toEqual({ policy: "window", requested: "2024-01-02" });
    // The engine has no visible-range input at all: the same stored date is the same study.
    const a = buildCompareStudy(input({ legs: [leg("QQQ", cfg, QQQ)] }));
    const b = buildCompareStudy(input({ legs: [leg("QQQ", withAnchor(defaultCmpCfg(0), "2024-01-02", "date"), QQQ)] }));
    expect(seriesOf(a, "QQQ")).toEqual(seriesOf(b, "QQQ"));
    expect(legOf(a, "QQQ").anchor).toEqual(legOf(b, "QQQ").anchor);
  });

  it("clearing the pin returns exactly the legacy config", () => {
    expect(withAnchor(pinned(2, "2024-01-02"), null)).toEqual(defaultCmpCfg(2));
  });
});

// ── AC-E08-05: legacy layouts keep their mode, style, and values ──────────────────────────────
describe("AC-E08-05 — legacy compare layouts", () => {
  it("a pre-E08 config is the disclosed auto policy", () => {
    expect(anchorSpecOf(defaultCmpCfg(0))).toEqual({ policy: "auto", requested: null });
    expect(anchorSpecOf({ anchor: "not-a-date" } as CmpCfg)).toEqual({ policy: "auto", requested: null });
    expect(anchorSpecOf({ anchor: "2024-02-30" } as CmpCfg)).toEqual({ policy: "auto", requested: null });
    expect(isAnchorDate("2024-02-29")).toBe(true);
  });

  it("on gap-free data the auto policy reproduces the legacy values exactly", () => {
    const shallow = QQQ.filter((r) => r.time >= "2023-06-01");
    const b = buildCompareStudy(input({ legs: [leg("QQQ", defaultCmpCfg(0), shallow)] }));
    const legacy = legacyPercent(HOST, shallow, 2)!;
    expect(seriesOf(b, "QQQ").map(({ time, value }) => ({ time, value }))).toEqual(legacy.data);
    expect(legOf(b, "QQQ").anchor!.effective).toBe(legacy.anchor);
  });

  it("mode and style pass through untouched", () => {
    const cfg: CmpCfg = { color: "#123456", lineStyle: 2, lineWidth: 3, mode: "price" };
    const r = legOf(buildCompareStudy(input({ legs: [leg("QQQ", cfg, QQQ)] })), "QQQ");
    expect(r).toMatchObject({ mode: "price", color: "#123456", policy: "auto" });
  });
});

// ── AC-E08-06: a saved study restores identical deterministic values ──────────────────────────
describe("AC-E08-06 — save/restore determinism", () => {
  const ws = (compareCfg: Record<string, CmpCfg>): LayoutWorkspace => ({
    panes: ["AAPL"], paneTfs: ["D"], split: 1, activePane: 0, sync: true, chartType: "candles",
    inds: [], indParams: {}, hidden: [], compare: ["QQQ", "SPY"], compareCfg, lockedVLine: null,
  });

  it("the anchor fields survive the saved-layout round trip and the restored study is identical", () => {
    const cfg = { QQQ: pinned(0, "2024-01-02", "window"), SPY: pinned(1, "2024-01-02") };
    const saved = JSON.parse(JSON.stringify(captureLayoutConfig(ws(cfg))));
    const restored = applyLayoutConfig(normalizeLayoutConfig(saved), ws({})).compareCfg as Record<string, CmpCfg>;
    expect(restored).toEqual(cfg);
    const legsFrom = (c: Record<string, CmpCfg>) => [leg("QQQ", c.QQQ, QQQ), leg("SPY", c.SPY, SPY)];
    const before = buildCompareStudy(input({ legs: legsFrom(cfg) }));
    const after = buildCompareStudy(input({ legs: legsFrom(restored) }));
    expect(after.study.digest).toBe(before.study.digest);
    expect(after.series).toEqual(before.series);
  });

  it("the cloud workspace validator accepts the anchor fields", () => {
    const envelope = {
      schema: SCHEMA, requires: { floor: 1 }, revision: 1, name: null,
      link_groups: { primary_security: { entity_type: "security" } },
      widgets: [{
        id: "chart-main", type: "chart", semantic_lane: "primary",
        context_in: ["primary_security"], context_out: ["primary_security"],
        config: { panes: ["AAPL"], compare: ["QQQ"], compareCfg: { QQQ: pinned(0, "2024-01-02", "window") } },
      }],
      migration: { source: "none", source_revision: null },
    };
    expect(validateEnvelope(envelope)).toEqual({ ok: true, errors: [] });
  });

  it("the digest is a function of the plotted values and anchors only", () => {
    const a = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ)] }));
    const b = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-02"), QQQ.map((r) => ({ ...r })))] }));
    expect(b.study.digest).toBe(a.study.digest);
    const moved = buildCompareStudy(input({ legs: [leg("QQQ", pinned(0, "2024-01-03"), QQQ)] }));
    expect(moved.study.digest).not.toBe(a.study.digest);
  });
});
