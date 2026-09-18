import { describe, expect, it, vi } from "vitest";
import { IND_ORDER, type IndKey } from "@/lib/indicators";
import {
  LIVE_BAR_PROJECTION,
  LIVE_INPLACE_SERIES_KEYS,
  LIVE_REBUILD_KEYS,
  acceptsLiveStamp,
  liveQuoteStamp,
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
  });
});

// ── out-of-order packets ─────────────────────────────────────────────────────
describe("acceptsLiveStamp — a superseded tick must never repaint over a newer one", () => {
  it("refuses a strictly older packet", () => {
    expect(acceptsLiveStamp(1_000, 999)).toBe(false);
  });
  it("accepts a newer packet, and a corrected print under the same instant", () => {
    expect(acceptsLiveStamp(1_000, 1_001)).toBe(true);
    expect(acceptsLiveStamp(1_000, 1_000)).toBe(true);
  });
  it("accepts anything when either side has no clock — a basis that ships none must not freeze", () => {
    expect(acceptsLiveStamp(null, 42)).toBe(true);
    expect(acceptsLiveStamp(42, null)).toBe(true);
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
    const chart = { addSeries, priceScale: vi.fn(() => "scale") };
    const facade = seriesReuseChart(chart, owned, "ichimoku") as typeof chart;

    (facade.addSeries as any)().setData([{ time: "2026-08-07", value: 1 }]);
    (facade.addSeries as any)().setData([{ time: "2026-08-07", value: 2 }]);

    expect(addSeries).not.toHaveBeenCalled();
    expect(owned[0].setData).toHaveBeenCalledWith([{ time: "2026-08-07", value: 1 }]);
    expect(owned[1].setData).toHaveBeenCalledWith([{ time: "2026-08-07", value: 2 }]);
  });

  it("forwards every other chart call to the real chart", () => {
    const chart = { addSeries: vi.fn(), priceScale: vi.fn(() => "scale") };
    const facade = seriesReuseChart(chart, [fakeSeries()], "vol") as typeof chart;
    expect(facade.priceScale("volume" as never)).toBe("scale");
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
