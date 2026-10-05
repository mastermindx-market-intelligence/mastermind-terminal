import { describe, expect, it } from "vitest";
import {
  buildChartPriceWindow,
  CHART_PRICE_WINDOW_MAX_BARS,
  CHART_PRICE_WINDOW_SCHEMA,
} from "../chartPriceWindow";

const bars = Array.from({ length: 20 }, (_, i) => ({
  time: "2026-09-" + String(i + 1).padStart(2, "0"),
  o: 100 + i,
  h: 102 + i,
  l: 99 + i,
  c: 101 + i,
  v: 1000 + i,
}));
const source = (rows = bars, replay = false) => ({ symbol: "NVDA", tf: "D", bars: rows, replay });

describe("Copilot active rendered price window", () => {
  it("returns the loaded tail in chronological order when viewport is unavailable", () => {
    const out: any = buildChartPriceWindow(source(), "NVDA", "D", null);
    expect(out.schema).toBe(CHART_PRICE_WINDOW_SCHEMA);
    expect(out.status).toBe("observed");
    expect(out.selection.scope).toBe("loaded_tail");
    expect(out.selection.returned_bars).toBe(CHART_PRICE_WINDOW_MAX_BARS);
    expect(out.selection.omitted_older_bars).toBe(8);
    expect(out.bars.map((row: any) => row.source_index)).toEqual(
      Array.from({ length: 12 }, (_, i) => 8 + i),
    );
    expect(out.bars.at(-1)).toMatchObject({
      time: "2026-09-20",
      open: 119,
      high: 121,
      low: 118,
      close: 120,
      volume: 1019,
      age_bars_from_loaded_end: 0,
    });
  });

  it("returns only the visible tail rather than substituting off-screen loaded bars", () => {
    const from = Date.parse("2026-09-04T00:00:00Z") / 1000;
    const to = Date.parse("2026-09-09T00:00:00Z") / 1000;
    const out: any = buildChartPriceWindow(
      source(), "NVDA", "D", { from, to },
    );
    expect(out.selection).toMatchObject({
      scope: "visible_tail",
      eligible_bars: 6,
      returned_bars: 6,
      omitted_older_bars: 0,
    });
    expect(out.bars.map((row: any) => row.time)).toEqual([
      "2026-09-04", "2026-09-05", "2026-09-06",
      "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
    expect(out.bars.at(-1).age_bars_from_loaded_end).toBe(11);
  });

  it("does not fall back to latest bars when the visible window has no loaded overlap", () => {
    const out: any = buildChartPriceWindow(
      source(), "NVDA", "D",
      {
        from: Date.parse("2025-01-01T00:00:00Z") / 1000,
        to: Date.parse("2025-01-10T00:00:00Z") / 1000,
      },
    );
    expect(out).toMatchObject({
      schema: CHART_PRICE_WINDOW_SCHEMA,
      status: "unavailable",
      reason: "price_window_visible_range_has_no_loaded_bars",
    });
  });

  it("labels replay-sliced source data without claiming market liveness", () => {
    const out: any = buildChartPriceWindow(
      source(bars.slice(0, 7), true), "NVDA", "D", null,
    );
    expect(out.source_bar_count).toBe(7);
    expect(out.basis.data_status).toBe("replay_slice");
    expect(out.basis.last_bar_closed).toBe("unknown");
    expect(out.bars.at(-1).source_index).toBe(6);
  });

  it("rejects a rendered source whose chart identity no longer matches the pane", () => {
    const out: any = buildChartPriceWindow(
      { ...source(), symbol: "AAPL" }, "NVDA", "D", null,
    );
    expect(out).toMatchObject({
      schema: CHART_PRICE_WINDOW_SCHEMA,
      status: "unavailable",
      reason: "price_window_identity_invalid",
    });
  });

  it("fails closed on malformed or non-monotone rendered bars", () => {
    const malformed = [...bars.slice(0, 4), { ...bars[4], h: Number.NaN }];
    expect((buildChartPriceWindow(
      source(malformed), "NVDA", "D", null,
    ) as any).reason).toBe("price_window_ohlc_invalid");

    const reordered = [bars[0], bars[2], bars[1]];
    expect((buildChartPriceWindow(
      source(reordered), "NVDA", "D", null,
    ) as any).reason).toBe("price_window_time_order_invalid");
  });
});
