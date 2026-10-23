import { afterEach, describe, expect, it, vi } from "vitest";
import { boatsChartRefresh, boatsRefreshLogicalRange } from "../boatsChartRefresh";
const now = Date.parse("2026-10-19T01:15:20Z");
const epoch = Date.parse("2026-10-18T21:15:00Z") / 1000;
const body = () => ({ t: "AAPL", tf: "1m", bars: [[epoch, 100, 102, 99, 101, 12]],
  boats_history: { observed_at_utc: ["2026-10-19T01:15:10Z"] } });
afterEach(() => vi.restoreAllMocks());
describe("current-night chart refresh acceptance", () => {
  it("never promotes pending or degraded daytime history even with valid BOATS capture", () => {
    const fresh = body();
    const daytime = { assembled_at: new Date(now).toISOString(),
      refresh_pending: true, refresh_error: null, assembly_complete: false,
      meaning: "daytime_assembly_not_market_data_freshness" };
    expect(boatsChartRefresh({ ...fresh, daytime_cache: daytime }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...fresh, daytime_cache: { ...daytime, refresh_pending: false,
      refresh_error: "daytime feed offline" } }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...fresh, daytime_cache: { ...daytime, refresh_pending: false,
      assembly_complete: true } }, "AAPL", "1m", null, 0, now)?.bars).toHaveLength(1);
  });
  it("uses the authoritative complete snapshot without changing its volume", () => {
    const b = body(); const before = JSON.stringify(b);
    expect(boatsChartRefresh(b, "AAPL", "1m", null, 0, now)?.bars[0]).toEqual({ time: epoch, o: 100, h: 102, l: 99, c: 101, v: 12 });
    expect(JSON.stringify(b)).toBe(before);
  });
  it("rejects an unexpectedly short successful response before replacing 300 painted bars", () => {
    const longHistory = Array.from({ length: 300 }, (_, i) =>
      ({ time: epoch - (299 - i) * 60 }));
    const short = { ...body(), bars: [
      [epoch - 60, 100, 102, 99, 101, 12],
      [epoch, 100, 102, 99, 101, 12],
    ], daytime_cache: { refresh_pending: false, assembly_complete: true } };
    expect(boatsChartRefresh(short, "AAPL", "1m", null, 0, now, 0, longHistory)).toBeNull();
    // Ordinary capped-prefix rollover does not need an identical bar count.
    const rolled = Array.from({ length: 260 }, (_, i) =>
      [epoch - (259 - i) * 60, 100, 102, 99, 101, 12]);
    expect(boatsChartRefresh({ ...short, bars: rolled }, "AAPL", "1m",
      null, 0, now, 0, longHistory)?.bars).toHaveLength(260);
    // Source-confirmed empty windows are explicit cancellations, not a short nonempty tail.
    expect(boatsChartRefresh({ ...short, bars: [] }, "AAPL", "1m",
      null, 0, now, 0, longHistory)?.bars).toEqual([]);
  });
  it("rejects a delayed response for another symbol or timeframe", () => {
    expect(boatsChartRefresh(body(), "MSFT", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh(body(), "AAPL", "5m", null, 0, now)).toBeNull();
  });
  it("rejects failed, future and regressing capture responses", () => {
    expect(boatsChartRefresh({ ...body(), error: "unavailable" }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh(body(), "AAPL", "1m", null, now, now)).toBeNull();
    expect(boatsChartRefresh(body(), "AAPL", "1m", null, 0, now - 60_000)).toBeNull();
  });
  it("allows a source-confirmed empty window and rejects malformed or repeated bars", () => {
    expect(boatsChartRefresh({ ...body(), bars: [] }, "AAPL", "1m", null, 0, now)?.bars).toEqual([]);
    expect(boatsChartRefresh({ ...body(), bars: [body().bars[0], body().bars[0]] }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...body(), bars: [[epoch, 100, 99, 99, 101, 12]] }, "AAPL", "1m", null, 0, now)).toBeNull();
  });
  it("preserves only a qualified trade newer than the capture and does not invent volume", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const q = { extSource: "tiingo_boats", extBasis: "LIVE", extVenue: "BOATS", extPriceKind: "LAST_TRADE", extSession: "overnight",
      extPrice: 105, extTs: now / 1000, extReceivedTs: now / 1000, extPublishedTs: now / 1000, extExpiresTs: now / 1000 + 30 };
    expect(boatsChartRefresh(body(), "AAPL", "1m", q, 0, now)?.bars[0]).toMatchObject({ c: 105, h: 105, v: 12 });
    expect(boatsChartRefresh(body(), "AAPL", "1m", q, 0, now)?.appliedTradeMs).toBe(now);
    expect(boatsChartRefresh(body(), "AAPL", "1m", null, 0, now)?.appliedTradeMs).toBe(0);
    expect(boatsChartRefresh(body(), "AAPL", "1m", { ...q, extTs: now / 1000 - 15 }, 0, now)?.bars[0].c).toBe(101);
  });
  it("uses the live window capture clock in preference to an older baseline", () => {
    const b = body(); Object.assign(b.boats_history, { live_history: { observed_at_utc: "2026-10-19T01:15:20Z" } });
    expect(boatsChartRefresh(b, "AAPL", "1m", null, now - 1, now)?.captureMs).toBe(now);
  });
  it("retains an already observed trade until a newer REST capture can reconcile it", () => {
    expect(boatsChartRefresh(body(), "AAPL", "1m", null, 0, now, now - 1)).toBeNull();
  });
});

describe("history refresh viewport", () => {
  const rows = (times: number[]) => times.map(time => ({ time }));
  it("preserves fractional zoom and right whitespace on an unchanged candle grid", () => {
    expect(boatsRefreshLogicalRange(rows([100, 200, 300]), rows([100, 200, 300]), { from: -0.5, to: 8.25 }))
      .toEqual({ from: -0.5, to: 8.25 });
  });
  it("keeps time anchors when older bars arrive or a capped prefix is removed", () => {
    expect(boatsRefreshLogicalRange(rows([200, 300]), rows([100, 200, 300]), { from: 0, to: 3 }))
      .toEqual({ from: 1, to: 4 });
    expect(boatsRefreshLogicalRange(rows([100, 200, 300]), rows([200, 300, 400]), { from: 1, to: 3 }))
      .toEqual({ from: 0, to: 2 });
  });
  it("does not scroll merely because a new developing candle appeared", () => {
    expect(boatsRefreshLogicalRange(rows([100, 200]), rows([100, 200, 300]), { from: 0, to: 5 }))
      .toEqual({ from: 0, to: 5 });
  });
});

describe("daytime completion before any captured overnight history", () => {
  const daytime = () => ({ t: "AAPL", tf: "1m",
    bars: [[Date.parse("2026-10-16T15:59:00Z") / 1000, 100, 102, 99, 101, 12]],
    boats_history: { observed_at_utc: [] },
    daytime_cache: { assembled_at: new Date(now).toISOString(), refresh_pending: false,
      refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness" },
  });
  it("adopts a completed daytime baseline without inventing an overnight observation clock", () => {
    const out = boatsChartRefresh(daytime(), "AAPL", "1m", null, 0, now);
    expect(out?.bars).toHaveLength(1);
    expect(out?.captureMs).toBe(0);
  });
  it("never replaces previously captured overnight data or an accepted trade without its receipt", () => {
    expect(boatsChartRefresh(daytime(), "AAPL", "1m", null, now - 1, now)).toBeNull();
    expect(boatsChartRefresh(daytime(), "AAPL", "1m", null, 0, now, now - 1)).toBeNull();
    expect(boatsChartRefresh(daytime(), "AAPL", "1m", { extSource: "tiingo_boats" }, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...daytime(), bars: body().bars }, "AAPL", "1m", null, 0, now)).toBeNull();
  });
  it("rejects pending, failed, future or empty daytime completions", () => {
    const b = daytime();
    expect(boatsChartRefresh({ ...b, daytime_cache: { ...b.daytime_cache, refresh_pending: true } }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...b, daytime_cache: { ...b.daytime_cache, refresh_error: "failed" } }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...b, daytime_cache: { ...b.daytime_cache, assembled_at: new Date(now + 60_000).toISOString() } }, "AAPL", "1m", null, 0, now)).toBeNull();
    expect(boatsChartRefresh({ ...b, bars: [] }, "AAPL", "1m", null, 0, now)).toBeNull();
  });
  it("accepts newer daytime bars with an unchanged overnight capture clock", () => {
    const b = body();
    const capture = Date.parse(b.boats_history.observed_at_utc[0]);
    b.bars.unshift(daytime().bars[0]);
    expect(boatsChartRefresh(b, "AAPL", "1m", null, capture, now)?.bars).toHaveLength(2);
  });
});

it("keeps the chart's initial overnight bars even before the refresh effect has a capture", () => {
  const daytime = { t: "AAPL", tf: "1m",
    bars: [[Date.parse("2026-10-16T15:59:00Z") / 1000, 100, 102, 99, 101, 12]],
    boats_history: { observed_at_utc: [] },
    daytime_cache: { assembled_at: new Date(now).toISOString(), refresh_pending: false,
      refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness" } };
  const previous = [{ time: epoch, o: 100, h: 102, l: 99, c: 101, v: 12 }];
  expect(boatsChartRefresh(daytime, "AAPL", "1m", null, 0, now, 0, previous)).toBeNull();
  expect(boatsChartRefresh(daytime, "AAPL", "1m", null, 0, now, 0,
    [{ ...previous[0], time: daytime.bars[0][0] }])?.captureMs).toBe(0);
});

it("does not replay a qualified quote older than the chart's already accepted trade", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const quote = { extSource: "tiingo_boats", extBasis: "LIVE", extVenue: "BOATS", extPriceKind: "LAST_TRADE", extSession: "overnight",
    extPrice: 103, extTs: now / 1000 - 5, extReceivedTs: now / 1000, extPublishedTs: now / 1000, extExpiresTs: now / 1000 + 25 };
  expect(boatsChartRefresh(body(), "AAPL", "1m", quote, 0, now)?.appliedTradeMs).toBe(now - 5_000);
  expect(boatsChartRefresh(body(), "AAPL", "1m", quote, 0, now, now)).toBeNull();
  const equal = boatsChartRefresh(body(), "AAPL", "1m", { ...quote, extTs: now / 1000 }, 0, now, now);
  expect(equal?.appliedTradeMs).toBe(now);
  expect(equal?.bars[0].c).toBe(103);
});
