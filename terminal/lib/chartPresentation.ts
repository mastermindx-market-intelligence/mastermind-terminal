// Bounded read-only projection of interpretation-relevant chart presentation.
// No arbitrary labels, user prose, theme strings, or mutation authority.

export const CHART_PRESENTATION_SCHEMA = "chart.presentation.v1" as const;
export const CHART_PRESENTATION_MAX_BYTES = 4096;
export const CHART_PRESENTATION_MAX_COMPARISONS = 4;

const CHART_TYPES = new Set([
  "candles", "hollow", "heikin", "bars",
  "line", "line-markers", "step", "area", "baseline",
]);
const MODES = new Map<number, string>([
  [0, "normal"], [1, "log"], [2, "percent"], [3, "indexed_to_100"],
]);
const COMPARE_MODES = new Set(["percent", "price"]);
const LINE_STYLES = new Map<number, string>([[0, "solid"], [1, "dotted"], [2, "dashed"]]);

type ProjectionSettings = {
  mode: number;
  invertScale: boolean;
  scaleLeft: boolean;
  autoScale: boolean;
  priceLineVisible: boolean;
  lastValueVisible: boolean;
  gridHVisible: boolean;
  gridVVisible: boolean;
  showOHLC: boolean;
  showVolume: boolean;
  showIndicatorTitles: boolean;
  showWatermark: boolean;
  candleBodyVisible: boolean;
  candleBordersVisible: boolean;
  candleWicksVisible: boolean;
  precision: string;
  extHours: boolean;
  extendedLineVisible: boolean;
  visualContext: boolean;
  visualRegime: boolean;
  visualVolume: boolean;
  visualLevels: boolean;
  visualEvents: boolean;
};

type ComparisonInput = {
  symbol: string;
  mode: string;
  color: string;
  lineStyle: number;
  lineWidth: number;
  visible: boolean;
};

export type ChartPresentationInput = {
  symbol: string;
  tf: string;
  paneId: number;
  chartType: string;
  settings: ProjectionSettings;
  extendedEligible: boolean;
  replay: boolean;
  dayTradeMode: boolean;
  comparisons: readonly ComparisonInput[];
};

const token = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v
  && ![...v].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

const bool = (v: unknown): v is boolean => typeof v === "boolean";

function unavailable(reason: string) {
  return { schema: CHART_PRESENTATION_SCHEMA, status: "unavailable" as const, reason };
}

function bytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
}

export function buildChartPresentation(input: ChartPresentationInput): Record<string, unknown> {
  if (
    !token(input.symbol, 64)
    || !token(input.tf, 32)
    || !Number.isSafeInteger(input.paneId)
    || input.paneId < 0
    || input.paneId >= 4
  ) return unavailable("presentation_identity_invalid");

  if (!CHART_TYPES.has(input.chartType))
    return unavailable("presentation_chart_type_invalid");

  const s = input.settings;
  if (!s || typeof s !== "object") return unavailable("presentation_settings_invalid");
  const mode = MODES.get(s.mode);
  if (
    !mode
    || !bool(s.invertScale) || !bool(s.scaleLeft) || !bool(s.autoScale)
    || !bool(s.priceLineVisible) || !bool(s.lastValueVisible)
    || !bool(s.gridHVisible) || !bool(s.gridVVisible)
    || !bool(s.showOHLC) || !bool(s.showVolume) || !bool(s.showIndicatorTitles)
    || !bool(s.showWatermark)
    || !bool(s.candleBodyVisible) || !bool(s.candleBordersVisible) || !bool(s.candleWicksVisible)
    || !["auto", "2", "3", "4"].includes(s.precision)
    || !bool(s.extHours) || !bool(s.extendedLineVisible)
    || !bool(s.visualContext) || !bool(s.visualRegime) || !bool(s.visualVolume)
    || !bool(s.visualLevels) || !bool(s.visualEvents)
    || !bool(input.extendedEligible) || !bool(input.replay) || !bool(input.dayTradeMode)
  ) return unavailable("presentation_settings_invalid");

  if (!Array.isArray(input.comparisons) || input.comparisons.length > CHART_PRESENTATION_MAX_COMPARISONS)
    return unavailable("presentation_comparison_invalid");

  const comparisons: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const row of input.comparisons) {
    const style = LINE_STYLES.get(row?.lineStyle);
    if (
      !row
      || !token(row.symbol, 64)
      || seen.has(row.symbol)
      || !COMPARE_MODES.has(row.mode)
      || !/^#[0-9a-fA-F]{6}$/.test(row.color)
      || !style
      || !Number.isInteger(row.lineWidth)
      || row.lineWidth < 1
      || row.lineWidth > 4
      || !bool(row.visible)
    ) return unavailable("presentation_comparison_invalid");
    seen.add(row.symbol);
    comparisons.push({
      symbol: row.symbol,
      mode: row.mode,
      color: row.color.toLowerCase(),
      style,
      width: row.lineWidth,
      visible: row.visible,
    });
  }

  const packet = {
    schema: CHART_PRESENTATION_SCHEMA,
    status: "observed" as const,
    symbol: input.symbol,
    tf: input.tf,
    pane_id: input.paneId,
    chart_type: input.chartType,
    price_scale: {
      mode,
      inverted: s.invertScale,
      side: s.scaleLeft ? "left" : "right",
      auto: s.autoScale,
    },
    session: {
      replay: input.replay,
      day_trade_mode: input.dayTradeMode,
      extended_hours: {
        requested: s.extHours,
        eligible: input.extendedEligible,
        effective: input.extendedEligible && s.extHours,
      },
    },
    display: {
      price_line: s.priceLineVisible,
      last_value: s.lastValueVisible,
      grid_h: s.gridHVisible,
      grid_v: s.gridVVisible,
      ohlc: s.showOHLC,
      volume: s.showVolume,
      indicator_titles: s.showIndicatorTitles,
      watermark: s.showWatermark,
      candle_body: s.candleBodyVisible,
      candle_borders: s.candleBordersVisible,
      candle_wicks: s.candleWicksVisible,
      precision: s.precision,
      extended_price_line: s.extendedLineVisible,
    },
    visual_intelligence: {
      context: s.visualContext,
      regime: s.visualRegime,
      volume: s.visualVolume,
      levels: s.visualLevels,
      events: s.visualEvents,
    },
    comparisons,
    basis: {
      source: "terminal_committed_chart_presentation",
      facts_are: "presentation_state_not_instructions",
      control_authority: "none",
      arbitrary_ui_text: "excluded",
      render_application: "committed_settings_not_pixel_attestation",
    },
  };
  return bytes(packet) <= CHART_PRESENTATION_MAX_BYTES
    ? packet
    : unavailable("presentation_too_large");
}
