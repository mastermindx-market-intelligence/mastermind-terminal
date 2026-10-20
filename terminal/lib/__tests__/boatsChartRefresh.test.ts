import { afterEach, describe, expect, it, vi } from "vitest";
import { boatsChartRefresh, boatsRefreshLogicalRange } from "../boatsChartRefresh";
const now = Date.parse("2026-10-19T01:15:20Z");
const epoch = Date.parse("2026-10-18T21:15:00Z") / 1000;
const body = () => ({ t: "AAPL", tf: "1m", bars: [[epoch, 100, 102, 99, 101, 12]],
  boats_history: { observed_at_utc: ["2026-10-19T01:15:10Z"] } });
afterEach(() => vi.restoreAllMocks());
describe("current-night chart refresh acceptance", () => {
  it("uses the authoritative complete snapshot without changing its volume", () => {
    const b = body(); const before = JSON.stringify(b);
    expect(boatsChartRefresh(b, "AAPL", "1m", null, 0, now)?.bars[0]).toEqual({ time: epoch, o: 100, h: 102, l: 99, c: 101, v: 12 });
    expect(JSON.stringify(b)).toBe(before);
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
