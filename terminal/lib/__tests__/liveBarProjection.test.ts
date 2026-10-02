import { describe, expect, it, vi } from "vitest";
import { IND_ORDER, type IndKey } from "@/lib/indicators";
import { parseTencentFields } from "@/lib/intradaySources";
import {
  LIVE_BAR_PROJECTION,
  LIVE_CLOSED_BAR_KEYS,
  LIVE_INPLACE_SERIES_KEYS,
  LIVE_REBUILD_KEYS,
  acceptsLiveTick,
  liveQuoteStamp,
  regularSessionBarIsFinal,
  reuseSeries,
  seriesReuseChart,
} from "@/lib/liveBarProjection";

// ── the classification is the contract ───────────────────────────────────────
// A study nobody classified is a study that silently freezes on the previous bar while the candle
// beside it moves. The registry is the list of everything the chart can draw, so it is the list
// everything must be classified against.
describe("LIVE_BAR_PROJECTION — every built-in study has a decided live behaviour", () => {
  it("classifies exactly the registry, with no orphans either way", () => {
    expect(Object.keys(LIVE_BAR_PROJECTION).sort()).toEqual([...IND_ORDER].sort());
  });

  it("partitions the registry into disjoint projection classes", () => {
    const byClass = new Map<string, IndKey[]>();
    for (const k of IND_ORDER) {
      const cls = LIVE_BAR_PROJECTION[k];
      byClass.set(cls, [...(byClass.get(cls) ?? []), k]);
    }
    const total = [...byClass.values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBe(IND_ORDER.length);
    // The classic subset ChartPanel's updateAllIndicators() actually re-setData's. Adding a key to
    // that function without adding it here (or the reverse) is what this pins.
    expect([...LIVE_INPLACE_SERIES_KEYS].sort())
      .toEqual(["bb", "ema", "macd", "rsi", "stochrsi", "vol", "vwap"]);
    // Nothing may be BOTH re-setData'd by the classic path and re-run by the builder path.
    expect(LIVE_REBUILD_KEYS.some((k) => LIVE_INPLACE_SERIES_KEYS.has(k))).toBe(false);
  });

  it("keeps the rebuild list in canonical draw order", () => {
    const canonical = IND_ORDER.filter((k) => LIVE_REBUILD_KEYS.includes(k));
    expect(LIVE_REBUILD_KEYS).toEqual(canonical);
  });

  it("holds the day-trade and premium studies that used to strand on the previous bar", () => {
    for (const k of ["ichimoku", "ribbon", "supertrend", "rvwap", "wvwap", "vprofile", "volbox",
      "rsistack", "accum", "svwap", "orb", "slevels", "pivots", "rvol", "ttmsq", "adx", "cvd"] as IndKey[]) {
      expect(LIVE_BAR_PROJECTION[k]).toBe("inplace-rebuild");
    }
    // Options levels come from the nightly options build, not from the bars: a developing candle
    // carries nothing they read, so re-running their builder per quote would be pure waste.
    expect(LIVE_BAR_PROJECTION.optlevels).toBe("not-bar-derived");
    // Gap zones and lab markers cache nothing of their own — the render pass re-derives them.
    expect(LIVE_BAR_PROJECTION.gaps).toBe("render-pass");
    expect(LIVE_BAR_PROJECTION._lab).toBe("render-pass");
    // MTF confluence is derived from bars, but only CLOSED bars. It therefore has an
    // explicit non-live projection class rather than pretending to be data-fed.
    expect(LIVE_BAR_PROJECTION.mtfconfluence).toBe("closed-bar-series");
    expect(LIVE_CLOSED_BAR_KEYS).toEqual(["mtfconfluence"]);
    expect(LIVE_REBUILD_KEYS).not.toContain("mtfconfluence");
    expect(LIVE_INPLACE_SERIES_KEYS.has("mtfconfluence")).toBe(false);
  });
});

describe("regularSessionBarIsFinal — completion must be explicit", () => {
  const tencentRecord = (o: Partial<Record<number, string>>) => {
    const f = new Array(41).fill("0");
    f[0] = "1"; f[1] = "TestCo"; f[2] = "000729";
    for (const k of Object.keys(o)) f[+k] = o[+k as unknown as number]!;
    return f;
  };

  it("accepts only an explicitly completed US regular session", () => {
    expect(regularSessionBarIsFinal(
      { marketSession: "rth", regularSessionDate: "2026-08-07" }, "us", "2026-08-07",
    )).toBe(false);
    expect(regularSessionBarIsFinal(
      { marketSession: "post", regularSessionDate: "2026-08-07" }, "us", "2026-08-07",
    )).toBe(true);
    expect(regularSessionBarIsFinal(
      { marketSession: "overnight", regularSessionDate: "2026-08-07" }, "us", "2026-08-07",
    )).toBe(true);
    expect(regularSessionBarIsFinal(
      { marketSession: "post", regularSessionDate: "2026-08-06" }, "us", "2026-08-07",
    )).toBe(false);
  });

  it("keeps parser-shaped ordinary CN/HK quotes unfinalized when session state is absent", () => {
    const cn = parseTencentFields("000729.SZ", "cn", tencentRecord({
      3: "12.20", 4: "11.74", 5: "11.90", 30: "20260807100000", 32: "3.92", 33: "12.35", 34: "11.85",
    }))!;
    const hk = parseTencentFields("0700.HK", "hk", tencentRecord({
      3: "600.0", 4: "595.0", 5: "596.0", 30: "2026/08/07 10:00:00", 32: "0.84", 33: "602.0", 34: "594.0",
    }))!;
    expect(cn.marketSession).toBeUndefined();
    expect(hk.marketSession).toBeUndefined();
    expect(cn.basis).toBe("LIVE");
    expect(hk.basis).toBe("DELAYED_15M");
    expect(regularSessionBarIsFinal(cn, "cn", "2026-08-07")).toBe(false);
    expect(regularSessionBarIsFinal(hk, "hk", "2026-08-07")).toBe(false);
  });
});

// ── out-of-order packets ─────────────────────────────────────────────────────
describe("acceptsLiveTick — a superseded tick must never repaint over a newer one", () => {
  const live = (stamp: number | null) => ({ basis: "REALTIME", stamp });

  it("refuses a strictly older packet from the same lane", () => {
    expect(acceptsLiveTick(live(1_000), live(999))).toBe(false);
  });
  it("accepts a newer packet, and a corrected print under the same instant", () => {
    expect(acceptsLiveTick(live(1_000), live(1_001))).toBe(true);
    expect(acceptsLiveTick(live(1_000), live(1_000))).toBe(true);
  });
  it("accepts anything when either side has no clock — a basis that ships none must not freeze", () => {
    expect(acceptsLiveTick(live(null), live(42))).toBe(true);
    expect(acceptsLiveTick(live(42), live(null))).toBe(true);
    expect(acceptsLiveTick(null, live(42))).toBe(true);
  });
  it("restarts the ordering on a lane change so a delayed fallback cannot freeze the chart", () => {
    // REALTIME → DELAYED_15M moves the measured instant back a quarter of an hour. Comparing
    // across that boundary would refuse every packet until the delayed clock caught up.
    expect(acceptsLiveTick(live(1_700_000_900_000), { basis: "DELAYED_15M", stamp: 1_700_000_000_000 })).toBe(true);
    expect(acceptsLiveTick({ basis: "DELAYED_15M", stamp: 1_700_000_900_000 }, live(1_700_000_000_000))).toBe(true);
  });
});

describe("liveQuoteStamp", () => {
  it("prefers the measured packet time over the coarse seconds field", () => {
    expect(liveQuoteStamp({ asOfMs: 1_700_000_000_123, ts: 1_700_000_000 })).toBe(1_700_000_000_123);
  });
  it("falls back to ts, in ms", () => {
    expect(liveQuoteStamp({ ts: 1_700_000_000 })).toBe(1_700_000_000_000);
  });
  it("is null for a quote that declares no instant", () => {
    expect(liveQuoteStamp({})).toBeNull();
    expect(liveQuoteStamp(null)).toBeNull();
  });

  // ── an implausible stamp is a units bug, and adopting one freezes the lane forever ──
  const NOW = 1_800_000_000_000;   // a fixed "now" so this never depends on the wall clock

  it("accepts a stamp inside the skew window, ahead or behind", () => {
    expect(liveQuoteStamp({ asOfMs: NOW - 86_400_000 }, NOW)).toBe(NOW - 86_400_000);
    expect(liveQuoteStamp({ asOfMs: NOW + 60_000 }, NOW)).toBe(NOW + 60_000);
    expect(liveQuoteStamp({ asOfMs: NOW + 5 * 60 * 60 * 1000 }, NOW)).toBe(NOW + 5 * 60 * 60 * 1000);
  });

  it("reports a stamp implausibly far ahead as UNSTAMPED rather than adopting it", () => {
    // the realistic source: a lane ships `ts` already in ms and the fallback multiplies by 1000
    expect(liveQuoteStamp({ ts: NOW }, NOW)).toBeNull();
    expect(liveQuoteStamp({ asOfMs: NOW * 1000 }, NOW)).toBeNull();
    expect(liveQuoteStamp({ asOfMs: NOW + 7 * 60 * 60 * 1000 }, NOW)).toBeNull();
  });

  it("does not let one bad stamp freeze the lane for the life of the bar set", () => {
    // Adopting the bad stamp would make it the lane's floor, and `acceptsLiveTick` would then
    // refuse every real packet that follows — a permanently frozen chart with no self-heal.
    const bad = { basis: "REALTIME", stamp: liveQuoteStamp({ ts: NOW }, NOW) };
    expect(bad.stamp).toBeNull();
    const real = { basis: "REALTIME", stamp: liveQuoteStamp({ asOfMs: NOW + 1_000 }, NOW) };
    expect(acceptsLiveTick(bad, real)).toBe(true);
    // and the lane keeps ordering normally from there
    expect(acceptsLiveTick(real, { basis: "REALTIME", stamp: NOW - 1_000 })).toBe(false);
  });
});

// ── the reuse facade ─────────────────────────────────────────────────────────
// This is what lets a builder be its own update owner. If it ever starts creating real series, a
// live tick silently leaks an untracked series onto the chart every few seconds.
const fakeSeries = () => ({
  setData: vi.fn(),
  update: vi.fn(),
  data: vi.fn(() => []),
  options: vi.fn(() => ({ lastValueVisible: false })),
  priceScale: vi.fn(),
  getPane: vi.fn(),
  applyOptions: vi.fn(),
  createPriceLine: vi.fn(),
});

describe("seriesReuseChart — a re-run builder updates, it does not create", () => {
  it("hands back the series the key already owns, in creation order", () => {
    const owned = [fakeSeries(), fakeSeries()];
    const addSeries = vi.fn();
    const chart = { addSeries, priceScale: vi.fn((_id: string) => "scale") };
    const facade = seriesReuseChart(chart, owned, "ichimoku") as typeof chart;

    (facade.addSeries as any)().setData([{ time: "2026-08-07", value: 1 }]);
    (facade.addSeries as any)().setData([{ time: "2026-08-07", value: 2 }]);

    expect(addSeries).not.toHaveBeenCalled();
    expect(owned[0].setData).toHaveBeenCalledWith([{ time: "2026-08-07", value: 1 }]);
    expect(owned[1].setData).toHaveBeenCalledWith([{ time: "2026-08-07", value: 2 }]);
  });

  it("forwards every other chart call to the real chart", () => {
    const chart = { addSeries: vi.fn(), priceScale: vi.fn((_id: string) => "scale") };
    const facade = seriesReuseChart(chart, [fakeSeries()], "vol") as typeof chart;
    expect(facade.priceScale("volume")).toBe("scale");
    expect(chart.priceScale).toHaveBeenCalledWith("volume");
  });

  it("throws rather than leak an untracked series when the shape no longer matches", () => {
    const facade = seriesReuseChart({ addSeries: vi.fn() }, [fakeSeries()], "adx") as any;
    facade.addSeries();
    expect(() => facade.addSeries()).toThrow(/more series than it owns/);
  });
});

describe("reuseSeries — the parts of a builder that must NOT replay", () => {
  it("swallows applyOptions so the post-build axis pass is not undone", () => {
    const s = fakeSeries();
    reuseSeries(s).applyOptions({ priceLineVisible: true } as never);
    expect(s.applyOptions).not.toHaveBeenCalled();
  });

  it("swallows createPriceLine so static guides do not stack once per quote", () => {
    const s = fakeSeries();
    const wrapped = reuseSeries(s);
    for (let i = 0; i < 50; i++) wrapped.createPriceLine({ price: 25 } as never);
    expect(s.createPriceLine).not.toHaveBeenCalled();
  });

  it("still forwards the data write and the reads a builder makes", () => {
    const s = fakeSeries();
    const wrapped = reuseSeries(s);
    wrapped.setData([{ time: "2026-08-07", value: 3 }] as never);
    wrapped.options();
    expect(s.setData).toHaveBeenCalledWith([{ time: "2026-08-07", value: 3 }]);
    expect(s.options).toHaveBeenCalled();
  });
});
