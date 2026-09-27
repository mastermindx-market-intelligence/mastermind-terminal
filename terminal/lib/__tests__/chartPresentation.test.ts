import { describe, expect, it } from "vitest";
import { buildChartPresentation, CHART_PRESENTATION_SCHEMA } from "../chartPresentation";

const settings = {
  mode: 1,
  invertScale: true,
  scaleLeft: false,
  autoScale: true,
  priceLineVisible: true,
  lastValueVisible: true,
  gridHVisible: true,
  gridVVisible: false,
  showOHLC: true,
  showVolume: true,
  showIndicatorTitles: true,
  showWatermark: false,
  candleBodyVisible: true,
  candleBordersVisible: false,
  candleWicksVisible: true,
  precision: "auto",
  extHours: true,
  extendedLineVisible: true,
  visualContext: true,
  visualRegime: false,
  visualVolume: true,
  visualLevels: true,
  visualEvents: false,
};

describe("Copilot chart presentation projection", () => {
  it("projects interpretation-relevant view state without arbitrary UI prose", () => {
    const out: any = buildChartPresentation({
      symbol: "NVDA",
      tf: "15m",
      paneId: 0,
      chartType: "candles",
      settings,
      extendedEligible: true,
      replay: false,
      dayTradeMode: true,
      comparisons: [
        { symbol: "QQQ", mode: "percent", color: "#e8a33d", lineStyle: 0, lineWidth: 2, visible: true },
      ],
    });
    expect(out).toMatchObject({
      schema: CHART_PRESENTATION_SCHEMA,
      status: "observed",
      symbol: "NVDA",
      tf: "15m",
      pane_id: 0,
      chart_type: "candles",
      price_scale: { mode: "log", inverted: true, side: "right", auto: true },
      session: {
        replay: false,
        day_trade_mode: true,
        extended_hours: { requested: true, eligible: true, effective: true },
      },
      comparisons: [
        { symbol: "QQQ", mode: "percent", color: "#e8a33d", style: "solid", width: 2, visible: true },
      ],
    });
    expect(JSON.stringify(out)).not.toContain("backgroundTop");
    expect(JSON.stringify(out)).not.toContain("titleMode");
  });

  it("reports percent/indexed scales and keeps extended hours ineffective when ineligible", () => {
    const percent: any = buildChartPresentation({
      symbol: "7203.T",
      tf: "D",
      paneId: 1,
      chartType: "line",
      settings: { ...settings, mode: 2, extHours: true },
      extendedEligible: false,
      replay: false,
      dayTradeMode: false,
      comparisons: [],
    });
    expect(percent.price_scale.mode).toBe("percent");
    expect(percent.session.extended_hours).toEqual({
      requested: true, eligible: false, effective: false,
    });

    const indexed: any = buildChartPresentation({
      symbol: "NVDA", tf: "D", paneId: 0, chartType: "baseline",
      settings: { ...settings, mode: 3 }, extendedEligible: true,
      replay: true, dayTradeMode: false, comparisons: [],
    });
    expect(indexed.price_scale.mode).toBe("indexed_to_100");
    expect(indexed.session.replay).toBe(true);
  });

  it("fails closed on unknown chart types, invalid pane ids, or malformed comparisons", () => {
    expect((buildChartPresentation({
      symbol: "NVDA", tf: "D", paneId: 0, chartType: "magic",
      settings, extendedEligible: true, replay: false, dayTradeMode: false, comparisons: [],
    }) as any).reason).toBe("presentation_chart_type_invalid");

    expect((buildChartPresentation({
      symbol: "NVDA", tf: "D", paneId: 5, chartType: "candles",
      settings, extendedEligible: true, replay: false, dayTradeMode: false, comparisons: [],
    }) as any).reason).toBe("presentation_identity_invalid");

    expect((buildChartPresentation({
      symbol: "NVDA", tf: "D", paneId: 0, chartType: "candles",
      settings, extendedEligible: true, replay: false, dayTradeMode: false,
      comparisons: [{ symbol: "QQQ", mode: "percent", color: "not-a-color", lineStyle: 0, lineWidth: 2, visible: true }],
    }) as any).reason).toBe("presentation_comparison_invalid");
  });
});
