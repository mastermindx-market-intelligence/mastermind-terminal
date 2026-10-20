// Mastermind Chart Engine — one-frame compositor for the native Canvas2D engine.
// Paint order: background → grid → session shading → bottom primitives → series →
// price lines → markers → normal primitives → watermark → top primitives → in-pane
// axes. Overlay: crosshair. No lightweight-charts.

import type { EngineSeriesKind, EngineSeriesOptions, EngineSeriesRow, EngineTime } from "../api";
import type { EngineProjection } from "../primitive";
import { layoutTimeLabels, type Measure as AxisMeasure } from "./axes";
import {
  layoutMarkers,
  layoutPriceLines,
  layoutWatermark,
  paintDecorations,
  type RowsIndex,
} from "./decorations";
import type { ChartModel, SeriesModel } from "./model";
import {
  displayedPriceScaleId,
  priceScaleMath,
  seriesClose,
  seriesIndexOfTime,
  seriesTimeSource,
  timeToMs,
} from "./model";
import {
  paintSeries as paintSeriesKind,
  type BarGeom,
  type CandleGeom,
  type HistogramColumn,
  type LineVertex,
  type PaintContext,
  type SeriesPaintStyle,
} from "./paint";
import { columnAggregate, LineDecimator, type VisualColumn } from "./lod";
import type { PrimitiveHost } from "./primitives";
import {
  areaGeometry,
  barGeometry,
  baselineGeometry,
  candleGeometry,
  histogramGeometry,
  lineGeometry,
  visibleSlice,
} from "./series";
import {
  axisLabelView,
  contrastColors,
  labelVisible,
  drawPriceAxisLabel,
  fixLabelOverlap,
  optimalPriceAxisWidth,
  priceAxisRendererOptions,
  roundRectPath,
  yMidCorrection,
  type AxisLabelView,
  type PriceAxisRendererOptions,
} from "./priceAxis";
import { snapLogicalToBar } from "./crosshair";
import { timeAxisOwnerBottom, timeAxisOwnerPane } from "./inputBridge";
import { formatterSourceOf, scaleFormatter, type ScaleFormatter } from "./priceFormat";
import { dateOf, lwcPriceMarks, timeTicks, TIME_TICK_WEIGHT, type PriceMark, type TimeTick } from "./ticks";
import type { PriceScaleState } from "./scales";

/** Single named palette for canvas/ fallbacks (F-14). Never used as up/down. */
export const CANVAS_NEUTRAL_DEFAULTS = {
  seriesColor: "#848484",
  gridColor: "rgba(128,128,128,0.2)",
  crosshairColor: "rgba(180,180,180,0.6)",
  textColor: "#848484",
  axisLabelBackground: "rgba(0,0,0,0.65)",
  axisBorderColor: "rgba(128,128,128,0.4)",
  /** LWC priceScale borderColor default. */
  priceScaleBorderColor: "#2B2B43",
} as const;

/** LWC crosshair defaults (vertLine/horzLine color and labelBackgroundColor). */
export const LWC_CROSSHAIR = { lineColor: "#9598A1", labelBackground: "#131722" } as const;

export type NeutralDefaults = typeof CANVAS_NEUTRAL_DEFAULTS;

const NOOP = (): void => undefined;

export function ensurePaintCtx(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  const c = ctx as CanvasRenderingContext2D & Record<string, unknown>;
  if (typeof c.setLineDash !== "function") c.setLineDash = NOOP;
  if (typeof c.clip !== "function") c.clip = NOOP;
  if (typeof c.arc !== "function") c.arc = NOOP;
  if (typeof c.measureText !== "function") {
    c.measureText = (text: string) => ({ width: String(text).length * 7 }) as TextMetrics;
  }
  if (typeof c.fillText !== "function") c.fillText = NOOP;
  if (typeof c.fill !== "function") c.fill = NOOP;
  return ctx;
}

function optStr(opts: EngineSeriesOptions, key: string): string | undefined {
  const v = opts[key];
  return typeof v === "string" ? v : undefined;
}

function bagColor(bag: unknown, fallback: string): string {
  if (bag && typeof bag === "object" && typeof (bag as { color?: unknown }).color === "string") {
    return (bag as { color: string }).color;
  }
  return fallback;
}

function bagVisible(bag: unknown): boolean {
  return !(bag && typeof bag === "object" && (bag as { visible?: unknown }).visible === false);
}

function lineStyleOf(opts: EngineSeriesOptions): SeriesPaintStyle["lineStyle"] {
  const v = opts.lineStyle;
  // LWC LineStyle: 0 Solid, 1 Dotted, 2 Dashed, 3 LargeDashed, 4 SparseDotted.
  if (v === 1 || v === "dotted") return "dotted";
  if (v === 2 || v === "dashed") return "dashed";
  if (v === 3 || v === "largeDashed") return "largeDashed";
  if (v === 4 || v === "sparseDotted") return "sparseDotted";
  return "solid";
}

// LWC's line/area/baseline default; colours are deliberately NOT mirrored (colour law).
const DEFAULT_LINE_WIDTH = 3;

export function resolveSeriesPaintStyle(
  opts: EngineSeriesOptions,
  kind: EngineSeriesKind,
  defaults: NeutralDefaults,
): SeriesPaintStyle | null {
  const color = optStr(opts, "color") ?? optStr(opts, "lineColor");
  const directional = kind === "candles" || kind === "bars" || kind === "histogram";
  const up = optStr(opts, "upColor") ?? (directional ? color : undefined);
  const down = optStr(opts, "downColor") ?? (directional ? color : undefined);
  if (directional && up == null && down == null) return null;
  const line = optStr(opts, "lineColor") ?? color ?? defaults.seriesColor;
  const fill = optStr(opts, "topColor") ?? optStr(opts, "topFillColor1") ?? line;
  const bottomFill = optStr(opts, "bottomColor") ?? optStr(opts, "bottomFillColor1") ?? line;
  // PATCH3P2 F5: a directional series given only ONE side is monochrome in that colour,
  // exactly like the `color`-only case; CANVAS_NEUTRAL_DEFAULTS.seriesColor must never be
  // reached as an up/down colour through the asymmetric path.
  const monoSide = up ?? down;
  const mono = directional && monoSide != null ? monoSide : line;
  const upC = up ?? mono;
  const downC = down ?? mono;
  return {
    upColor: upC,
    downColor: downC,
    wickUpColor: optStr(opts, "wickUpColor") ?? optStr(opts, "wickColor") ?? upC,
    wickDownColor: optStr(opts, "wickDownColor") ?? optStr(opts, "wickColor") ?? downC,
    borderUpColor: optStr(opts, "borderUpColor") ?? optStr(opts, "borderColor") ?? upC,
    borderDownColor: optStr(opts, "borderDownColor") ?? optStr(opts, "borderColor") ?? downC,
    lineColor: line,
    lineWidth: typeof opts.lineWidth === "number" && opts.lineWidth > 0 ? opts.lineWidth : DEFAULT_LINE_WIDTH,
    lineStyle: lineStyleOf(opts),
    topFillColor: fill,
    bottomFillColor: bottomFill,
    topLineColor: optStr(opts, "topLineColor") ?? line,
    bottomLineColor: optStr(opts, "bottomLineColor") ?? line,
    baseValueColor: optStr(opts, "baseValueColor") ?? defaults.seriesColor,
  };
}

/**
 * F6 keeps a directional series given no colour from painting anything of its own: every
 * series colour is empty, and painters never paint an empty colour. A part whose ROW
 * carries a colour (LWC per-row `color`/`wickColor`/`borderColor`) still paints — that is
 * how volume, MACD, squeeze and Pine columns arrive, with `{}` series options.
 */
const ROW_COLOURS_ONLY: SeriesPaintStyle = {
  upColor: "",
  downColor: "",
  wickUpColor: "",
  wickDownColor: "",
  borderUpColor: "",
  borderDownColor: "",
  lineColor: "",
  lineWidth: DEFAULT_LINE_WIDTH,
  lineStyle: "solid",
  topFillColor: "",
  bottomFillColor: "",
  topLineColor: "",
  bottomLineColor: "",
  baseValueColor: "",
};

function yOfRow(row: EngineSeriesRow | undefined, key: "high" | "low" | "close", proj: { yOfPrice(p: number): number }): number {
  if (!row) return Number.NaN;
  const bag = row as Record<string, unknown>;
  if (typeof bag[key] === "number") return proj.yOfPrice(bag[key] as number);
  const v = seriesClose(row);
  return v == null ? Number.NaN : proj.yOfPrice(v);
}

function rowsIndexFor(series: SeriesModel, proj: { yOfPrice(p: number): number }): RowsIndex {
  return {
    // PERF-B: O(log n) over the series' cached ms-key index (was a linear scan
    // calling timeToMs per row — the marker layout's dominant per-paint cost).
    indexOfTime: (t: EngineTime) => seriesIndexOfTime(series, t, "exact"),
    highY: (i) => yOfRow(series.rows[i], "high", proj),
    lowY: (i) => yOfRow(series.rows[i], "low", proj),
    closeY: (i) => yOfRow(series.rows[i], "close", proj),
  };
}

function ohlcNum(row: EngineSeriesRow, key: "high" | "low" | "open" | "close"): number | null {
  const r = row as Record<string, unknown>;
  if (typeof r[key] === "number") return r[key] as number;
  return typeof r.value === "number" ? r.value : null;
}

function ohlcAccessor() {
  return {
    high: (row: EngineSeriesRow) => ohlcNum(row, "high"),
    low: (row: EngineSeriesRow) => ohlcNum(row, "low"),
    open: (row: EngineSeriesRow) => ohlcNum(row, "open"),
    close: (row: EngineSeriesRow) => ohlcNum(row, "close"),
  };
}

function rowStr(row: EngineSeriesRow | undefined, key: string): string | undefined {
  const v = row ? (row as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" ? v : undefined;
}

/** The row whose close is the column's close: its per-row colours colour the column. */
function lastValuedRow(series: SeriesModel, col: VisualColumn): EngineSeriesRow | undefined {
  for (let i = col.i1; i >= col.i0; i--) {
    const row = series.rows[i];
    const close = row ? ohlcNum(row, "close") : null;
    if (close != null && Number.isFinite(close)) return row;
  }
  return undefined;
}

function columnCandle(col: VisualColumn, xOf: (i: number) => number, yOf: (p: number) => number): CandleGeom | null {
  if (col.open == null || col.close == null || col.high == null || col.low == null) return null;
  const x0 = xOf(col.i0);
  const x1 = xOf(col.i1);
  return {
    x: (x0 + x1) / 2,
    halfWidth: Math.max(0.5, Math.abs(x1 - x0) / 2 + 0.25),
    openY: yOf(col.open),
    closeY: yOf(col.close),
    highY: yOf(col.high),
    lowY: yOf(col.low),
    up: col.close >= col.open,
    visible: true,
  };
}

function lodColumns(series: SeriesModel, from: number, to: number, columns: number, xOf: (i: number) => number, yOf: (p: number) => number): CandleGeom[] {
  const out: CandleGeom[] = [];
  const opts = series.options;
  for (const col of columnAggregate(series.rows, from, to, columns, ohlcAccessor())) {
    const g = columnCandle(col, xOf, yOf);
    if (!g) continue;
    const row = lastValuedRow(series, col);
    if (series.kind === "bars") {
      // A bar is one stroke colour; drawn as a column it colours every part alike.
      const color = rowStr(row, "color");
      out.push({ ...g, color, wickColor: color, borderColor: color });
    } else {
      out.push({
        ...g,
        color: rowStr(row, "color"),
        borderColor: rowStr(row, "borderColor"),
        wickColor: rowStr(row, "wickColor"),
        wickVisible: opts.wickVisible !== false,
        borderVisible: opts.borderVisible !== false,
      });
    }
  }
  return out;
}

/**
 * Dense histogram columns span the base to the column's extreme (its true min/max), so a
 * zoomed-out volume or MACD histogram still stands on its baseline.
 */
function lodHistogram(series: SeriesModel, from: number, to: number, columns: number, xOf: (i: number) => number, yOf: (p: number) => number): HistogramColumn[] {
  const base = typeof series.options.base === "number" && Number.isFinite(series.options.base) ? series.options.base : 0;
  const baseY = yOf(base);
  const out: HistogramColumn[] = [];
  for (const col of columnAggregate(series.rows, from, to, columns, ohlcAccessor())) {
    const g = columnCandle(col, xOf, yOf);
    if (!g || col.close == null) continue;
    out.push({
      x: g.x,
      halfWidth: g.halfWidth,
      topY: Math.min(g.highY, baseY),
      baseY: Math.max(g.lowY, baseY),
      up: col.close >= base,
      color: rowStr(lastValuedRow(series, col), "color"),
    });
  }
  return out;
}

function paintKind(
  ctx: PaintContext,
  series: SeriesModel,
  proj: EngineProjection,
  style: SeriesPaintStyle,
  view: { dpr: number; clipRect: { x: number; y: number; width: number; height: number } },
): void {
  const slice = visibleSlice(series.rows, proj);
  const visibleCount = slice[1] >= slice[0] ? slice[1] - slice[0] + 1 : 0;
  const useLod = proj.widthPx > 0 && visibleCount / proj.widthPx > 1;
  const columnCount = Math.max(1, Math.floor(proj.widthPx));
  const cols = () => lodColumns(series, slice[0], slice[1], columnCount, proj.xOfLogical, proj.yOfPrice);

  if (series.kind === "candles" || series.kind === "bars") {
    if (useLod) {
      paintSeriesKind(ctx, "candles", cols(), style, view);
      return;
    }
    if (series.kind === "candles") {
      const geo = candleGeometry(series.rows, proj, series.options);
      const candles: CandleGeom[] = geo.visual ? cols() : geo.bodies.map((b, i) => {
        const w = geo.wicks[i];
        // `visible` is the whole candle; wickVisible:false hides only the wick (LWC).
        return {
          x: b.x, halfWidth: b.width / 2, openY: b.yOpen, closeY: b.yClose,
          highY: w?.yHigh ?? b.yOpen, lowY: w?.yLow ?? b.yClose, up: b.up, visible: true,
          color: b.color, borderColor: b.borderColor, wickColor: w?.color,
          wickVisible: w?.visible ?? true, borderVisible: b.borderVisible,
        };
      });
      paintSeriesKind(ctx, "candles", candles, style, view);
      return;
    }
    const geo = barGeometry(series.rows, proj, series.options);
    if (geo.visual) {
      paintSeriesKind(ctx, "candles", cols(), style, view);
      return;
    }
    const bars: BarGeom[] = geo.ticks.map((t) => ({
      x: t.x, halfWidth: Math.abs(t.closeX - t.x), openY: t.yOpen, closeY: t.yClose,
      highY: t.yHigh, lowY: t.yLow, up: t.up, visible: true, color: t.color,
      openTickLength: Math.abs(t.x - t.openX), closeTickLength: Math.abs(t.closeX - t.x),
    }));
    paintSeriesKind(ctx, "bars", bars, style, view);
    return;
  }

  if (series.kind === "histogram") {
    const geo = useLod ? null : histogramGeometry(series.rows, proj, series.options);
    const columns: HistogramColumn[] = !geo || geo.visual
      ? lodHistogram(series, slice[0], slice[1], columnCount, proj.xOfLogical, proj.yOfPrice)
      : geo.columns.map((c) => ({
        x: c.x, halfWidth: c.width / 2, topY: c.y, baseY: c.yBase, up: c.y <= c.yBase,
        color: rowStr(series.rows[c.index], "color"),
      }));
    paintSeriesKind(ctx, "histogram", { columns }, style, view);
    return;
  }

  // Not mirrored: LWC's per-point `color` on line/area/baseline rows. Every production
  // per-row colour is on a histogram; these kinds paint in their series colours.
  // Only called when useLod. PERF-C: decimate while projecting, so a fitted
  // window allocates the ~4 emitted points per pixel, not one per visible row.
  const toPoints = (): LineVertex[] => {
    const decimator = new LineDecimator(1);
    for (let i = slice[0]; i <= slice[1]; i++) {
      const v = seriesClose(series.rows[i]);
      if (v != null) decimator.push(proj.xOfLogical(i), proj.yOfPrice(v));
    }
    return decimator.finish();
  };
  if (series.kind === "line") {
    const points = useLod ? toPoints() : lineGeometry(series.rows, proj, series.options).segments.flatMap((s) => s.vertices);
    paintSeriesKind(ctx, "line", { points }, style, view);
    return;
  }
  if (series.kind === "area") {
    const geo = areaGeometry(series.rows, proj, series.options);
    paintSeriesKind(ctx, "area", { line: { points: useLod ? toPoints() : geo.segments.flatMap((s) => s.vertices) }, baseY: geo.baselineY }, style, view);
    return;
  }
  const geo = baselineGeometry(series.rows, proj, series.options);
  const points = useLod ? toPoints() : [...geo.above.segments.flatMap((s) => s.vertices), ...geo.below.segments.flatMap((s) => s.vertices)];
  paintSeriesKind(ctx, "baseline", { line: { points }, baseY: geo.baseY }, style, view);
}

// LWC layout defaults (fontSize 12, the system-UI stack): the price and time axes and
// every axis label read the same layout font, as LWC's do.
const LWC_FONT_SIZE = 12;
const LWC_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

type LayoutFont = { font: string; fontSize: number; fontFamily: string; textColor: string; bg: string | null };

function layoutFont(options: ChartModel["options"]): LayoutFont {
  const layout = (options.layout && typeof options.layout === "object" ? options.layout : {}) as Record<string, unknown>;
  const fontSize = typeof layout.fontSize === "number" && layout.fontSize > 0 ? layout.fontSize : LWC_FONT_SIZE;
  const fontFamily = typeof layout.fontFamily === "string" && layout.fontFamily !== "" ? layout.fontFamily : LWC_FONT_FAMILY;
  const textColor = typeof layout.textColor === "string" ? layout.textColor : CANVAS_NEUTRAL_DEFAULTS.textColor;
  const nested = layout.background && typeof layout.background === "object"
    ? (layout.background as { color?: unknown }).color : undefined;
  const bg = typeof layout.backgroundColor === "string" ? layout.backgroundColor
    : typeof nested === "string" ? nested : null;
  return { font: `${fontSize}px ${fontFamily}`, fontSize, fontFamily, textColor, bg };
}

function measureFor(ctx: CanvasRenderingContext2D): AxisMeasure {
  return (text, font) => {
    ctx.font = font;
    return { width: typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * 7, height: 12 };
  };
}

function priceScaleOptions(model: ChartModel, priceScaleId: string): Record<string, unknown> {
  const bag = (model.options as Record<string, unknown>)[priceScaleId === "left" ? "leftPriceScale" : "rightPriceScale"];
  return bag && typeof bag === "object" ? (bag as Record<string, unknown>) : {};
}

/**
 * Whether the chart draws a price axis at all. mm draws the displayed scale's axis on the
 * right edge; LWC draws a left-only axis on the left (not mirrored: the strip stays right).
 */
export function priceAxisVisible(model: ChartModel): boolean {
  const o = model.options as { leftPriceScale?: { visible?: unknown }; rightPriceScale?: { visible?: unknown } };
  return o.rightPriceScale?.visible !== false || o.leftPriceScale?.visible === true;
}

/** LWC priceScaleCrosshairLabelVisible: the crosshair's price label can exist. */
function crosshairPriceLabelVisible(model: ChartModel): boolean {
  const ch = model.options.crosshair;
  const bag = ch && typeof ch === "object" ? (ch as { mode?: unknown; horzLine?: unknown }) : {};
  const horz = bag.horzLine && typeof bag.horzLine === "object" ? (bag.horzLine as { visible?: unknown; labelVisible?: unknown }) : {};
  return bag.mode !== 2 && horz.visible !== false && horz.labelVisible !== false;
}

/**
 * LWC barStyle(...).barColor for the row at idx: the colour the last-value label and the
 * series price line take. An empty colour (a series given none) means no label, no line.
 */
function seriesBarColor(s: SeriesModel, idx: number, style: SeriesPaintStyle): string {
  const row = s.rows[idx];
  const own = (key: string) => rowStr(row, key);
  if (s.kind === "candles" || s.kind === "bars") {
    const open = row ? ohlcNum(row, "open") : null;
    const close = row ? ohlcNum(row, "close") : null;
    const up = open != null && close != null ? open <= close : true;
    return own("color") ?? (up ? style.upColor : style.downColor);
  }
  if (s.kind === "area") return own("lineColor") ?? style.lineColor;
  if (s.kind === "baseline") {
    const base = s.options.baseValue && typeof s.options.baseValue === "object"
      ? (s.options.baseValue as { price?: unknown }).price : undefined;
    const close = seriesClose(row);
    const above = close != null && close >= (typeof base === "number" ? base : 0);
    return above ? own("topLineColor") ?? style.topLineColor : own("bottomLineColor") ?? style.bottomLineColor;
  }
  return own("color") ?? style.lineColor;
}

function paintStyleOf(s: SeriesModel): SeriesPaintStyle {
  return resolveSeriesPaintStyle(s.options, s.kind, CANVAS_NEUTRAL_DEFAULTS) ?? ROW_COLOURS_ONLY;
}

/** A series' own (possibly overlay) scale, as its projection reads it. */
function seriesScale(model: ChartModel, s: SeriesModel): PriceScaleState {
  return displayScale(model, s.paneIndex, s.priceScaleId);
}

/** LWC SeriesPriceAxisView + CustomPriceLinePriceAxisView for one series. */
function seriesAxisViews(
  model: ChartModel,
  s: SeriesModel,
  displayed: { sid: string; fmt: ScaleFormatter },
): AxisLabelView[] {
  if (!seriesPaintable(s) || !model.hasFirstValue(s)) return [];
  const out: AxisLabelView[] = [];
  const scale = seriesScale(model, s);
  const fmt = s.priceScaleId === displayed.sid ? displayed.fmt : scaleFormatter(model, s.paneIndex, s.priceScaleId, scale.mode);
  const opts = s.options;
  const idx = model.lastValueIndex(s, false);
  const price = idx >= 0 ? seriesClose(s.rows[idx]) : null;
  if (idx >= 0 && price != null && Number.isFinite(price)) {
    const priceLineColor = typeof opts.priceLineColor === "string" ? opts.priceLineColor : "";
    const colors = contrastColors(priceLineColor || seriesBarColor(s, idx, paintStyleOf(s)));
    if (colors) {
      const text = opts.lastValueVisible === false ? "" : fmt.formatPrice(price, scale);
      const title = typeof opts.title === "string" ? opts.title.trim() : "";
      out.push(axisLabelView({
        coordinate: priceScaleMath.yOfPrice(price, scale),
        background: colors.background,
        axis: { text, visible: text.length !== 0, color: colors.foreground },
        pane: { text: title, visible: title.length > 0, color: colors.foreground },
      }));
    }
  }
  for (const line of s.priceLines) {
    if (line.removed) continue;
    const spec = line.spec as Record<string, unknown> & { price: number };
    if (spec.axisLabelVisible === false || typeof spec.price !== "number" || !Number.isFinite(spec.price)) continue;
    const color = typeof spec.color === "string" ? spec.color : "";
    const labelColor = typeof spec.axisLabelColor === "string" ? spec.axisLabelColor : "";
    const colors = contrastColors(labelColor || color);
    if (!colors) continue;
    const textColor = typeof spec.axisLabelTextColor === "string" && spec.axisLabelTextColor !== ""
      ? spec.axisLabelTextColor : colors.foreground;
    const title = typeof spec.title === "string" ? spec.title : "";
    out.push(axisLabelView({
      coordinate: priceScaleMath.yOfPrice(spec.price, scale),
      background: colors.background,
      axis: { text: fmt.formatPrice(spec.price, scale), visible: true, color: textColor },
      pane: { text: title, visible: title !== "", color: textColor },
    }));
  }
  return out;
}

/** Everything one pane's price axis draws and measures, computed once per paint. */
export type PaneAxisState = {
  sid: string;
  scale: PriceScaleState;
  ro: PriceAxisRendererOptions;
  fmt: ScaleFormatter;
  hasFirst: boolean;
  marks: PriceMark[];
  views: AxisLabelView[];
  center: number;
  axisVisible: boolean;
  borderVisible: boolean;
  borderColor: string;
  textColor: string;
  ticksVisible: boolean;
  alignLabels: boolean;
  /** LWC PriceAxisWidget.optimalWidth for this pane (0 when the axis is not drawn). */
  optimalWidth: number;
};

export function paneAxisState(raw: CanvasRenderingContext2D, model: ChartModel, paneIndex: number): PaneAxisState {
  const ctx = ensurePaintCtx(raw);
  const sid = displayedPriceScaleId(model);
  const scale = displayScale(model, paneIndex, sid);
  const font = layoutFont(model.options);
  const ro = priceAxisRendererOptions(font.fontSize, font.fontFamily);
  const so = priceScaleOptions(model, sid);
  const fmt = scaleFormatter(model, paneIndex, sid, scale.mode);
  const pane = model.panes[paneIndex];
  const h = pane?.height ?? 0;
  let hasFirst = false;
  for (const id of pane?.seriesIds ?? []) {
    const s = model.getSeries(id);
    if (s && !s.removed && s.priceScaleId === sid && model.hasFirstValue(s)) {
      hasFirst = true;
      break;
    }
  }
  const marks = hasFirst && scale.heightPx > 0
    ? lwcPriceMarks(scale, {
      fontSize: font.fontSize,
      base: fmt.base,
      formatTickmarks: (logicals) => fmt.formatLogicalTickmarks(logicals),
      entireTextOnly: so.entireTextOnly === true,
    })
    : [];
  const views: AxisLabelView[] = [];
  for (const id of pane?.seriesIds ?? []) {
    const s = model.getSeries(id);
    if (!s || s.removed) continue;
    const overlay = s.priceScaleId !== "left" && s.priceScaleId !== "right";
    if (s.priceScaleId !== sid && !overlay) continue;
    for (const v of seriesAxisViews(model, s, { sid, fmt })) views.push(v);
  }
  const source = formatterSourceOf(model, paneIndex, sid);
  let center = h / 2;
  if (source && seriesPaintable(source) && model.hasFirstValue(source)) {
    const idx = model.lastValueIndex(source, false);
    const price = idx >= 0 ? seriesClose(source.rows[idx]) : null;
    if (price != null && Number.isFinite(price)) center = priceScaleMath.yOfPrice(price, seriesScale(model, source));
  }
  const axisVisible = priceAxisVisible(model);
  let optimalWidth = 0;
  if (axisVisible) {
    const texts: string[] = [];
    if (marks.length > 0) texts.push(marks[0].label, marks[marks.length - 1].label);
    for (const v of views) texts.push(v.axis.text);
    if (hasFirst && h > 0 && crosshairPriceLabelVisible(model)) {
      const top = priceScaleMath.priceOfY(1, scale);
      const bottom = priceScaleMath.priceOfY(h - 2, scale);
      if (Number.isFinite(top) && Number.isFinite(bottom)) {
        texts.push(
          fmt.formatPrice(Math.floor(Math.min(top, bottom)) + 0.11111111111111, scale),
          fmt.formatPrice(Math.ceil(Math.max(top, bottom)) - 0.11111111111111, scale),
        );
      }
    }
    const minimumWidth = typeof so.minimumWidth === "number" && so.minimumWidth > 0 ? so.minimumWidth : 0;
    optimalWidth = optimalPriceAxisWidth(ctx, ro, texts, minimumWidth);
  }
  return {
    sid,
    scale,
    ro,
    fmt,
    hasFirst,
    marks,
    views,
    center,
    axisVisible,
    borderVisible: so.borderVisible !== false,
    borderColor: typeof so.borderColor === "string" ? so.borderColor : CANVAS_NEUTRAL_DEFAULTS.priceScaleBorderColor,
    textColor: typeof so.textColor === "string" ? so.textColor : font.textColor,
    ticksVisible: so.ticksVisible === true,
    alignLabels: so.alignLabels !== false,
    optimalWidth,
  };
}

/** LWC PriceAxisWidget non-cursor draw over the strip [x0, x0 + width]: background,
 *  border, ticks, mark labels, then the back labels. */
function paintPriceAxisStrip(
  ctx: CanvasRenderingContext2D,
  axis: PaneAxisState,
  x0: number,
  width: number,
  h: number,
  bg: string | null,
  dpr: number,
): void {
  ctx.clearRect(x0, 0, width, h);
  if (!axis.axisVisible || width <= 0) return;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x0, 0, width, h);
  }
  const { ro } = axis;
  const x0B = Math.round(x0 * dpr);
  if (axis.borderVisible) {
    const borderB = Math.max(1, Math.floor(ro.borderSize * dpr));
    ctx.fillStyle = axis.borderColor;
    ctx.fillRect(x0B / dpr, 0, borderB / dpr, h);
    if (axis.ticksVisible) {
      const tickH = Math.max(1, Math.floor(dpr));
      const tickOffset = Math.floor(dpr * 0.5);
      const tickLen = Math.round(ro.tickLength * dpr);
      for (const mark of axis.marks) {
        ctx.fillRect(x0B / dpr, (Math.round(mark.y * dpr) - tickOffset) / dpr, tickLen / dpr, tickH / dpr);
      }
    }
  }
  ctx.font = ro.font;
  ctx.fillStyle = axis.textColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const textX = x0 + Math.round(ro.tickLength + ro.paddingInner);
  for (let i = axis.marks.length; i--;) {
    const mark = axis.marks[i];
    ctx.fillText(mark.label, textX, mark.y + yMidCorrection(ctx, mark.label));
  }
  for (const view of axis.views) {
    if (!view.axis.visible) continue;
    drawPriceAxisLabel(ctx, {
      view, part: "axis", ro, align: "left", x0, mediaWidth: width, dpr,
      ticksVisible: axis.ticksVisible, paneBackground: bg ?? "",
    });
  }
}

function paintGrid(ctx: CanvasRenderingContext2D, model: ChartModel, axis: PaneAxisState, w: number, h: number): void {
  const grid = model.options.grid;
  if (!grid || typeof grid !== "object") return;
  const g = grid as { vertLines?: unknown; horzLines?: unknown };
  if (bagVisible(g.horzLines)) {
    ctx.strokeStyle = bagColor(g.horzLines, CANVAS_NEUTRAL_DEFAULTS.gridColor);
    ctx.lineWidth = 1;
    for (const mark of axis.marks) {
      ctx.beginPath();
      ctx.moveTo(0, mark.y);
      ctx.lineTo(w, mark.y);
      ctx.stroke();
    }
  }
  if (bagVisible(g.vertLines)) {
    ctx.strokeStyle = bagColor(g.vertLines, CANVAS_NEUTRAL_DEFAULTS.gridColor);
    ctx.lineWidth = 1;
    // PERF-B: cached time accessor — no per-frame map over every row time.
    const primary = model.primarySeries();
    for (const tick of timeTicks(primary ? seriesTimeSource(primary) : [], model.time, { minGapPx: 48, hourFormat: "24" })) {
      ctx.beginPath();
      ctx.moveTo(tick.x, 0);
      ctx.lineTo(tick.x, h);
      ctx.stroke();
    }
  }
}

// F-4 localization: read the caller's `localization.locale` so the canvas engine
// honours the same locale the LWC adapter forwards. Non-empty strings only;
// anything else (undefined, "", non-string) collapses to the previous "en-US"
// default so untouched engines stay byte-identical.
function localizationLocaleOf(model: ChartModel): string {
  const bag = model.options.localization;
  if (!bag || typeof bag !== "object") return "en-US";
  const loc = (bag as { locale?: unknown }).locale;
  return typeof loc === "string" && loc !== "" ? loc : "en-US";
}

// The caller's tickMarkFormatter is written against lightweight-charts' TickMarkType
// (chartTimeAxis.ts switches on DayOfMonth / Time / TimeWithSeconds), so the mark it is
// handed must use that numbering, not this renderer's tick weight: weight 3 (day) read as
// TickMarkType.Time labelled day ticks "12:00 AM" on the 12-hour setting. The values
// mirror TickMarkType (Year 0, Month 1, DayOfMonth 2, Time 3) without importing it.
// Hour and minute ticks are Time, as LWC types them; this renderer places no
// second-level tick, so TimeWithSeconds (4) never occurs.
const TICK_MARK_TYPE = { year: 0, month: 1, dayOfMonth: 2, time: 3 } as const;

export function tickMarkTypeOfWeight(weight: number): number {
  if (weight >= TIME_TICK_WEIGHT.year) return TICK_MARK_TYPE.year;
  if (weight >= TIME_TICK_WEIGHT.month) return TICK_MARK_TYPE.month;
  if (weight >= TIME_TICK_WEIGHT.day) return TICK_MARK_TYPE.dayOfMonth;
  return TICK_MARK_TYPE.time;
}

export function timeAxisTicks(model: ChartModel): TimeTick[] {
  const primary = model.primarySeries();
  const ts = (model.options.timeScale ?? {}) as Record<string, unknown>;
  const locale = localizationLocaleOf(model);
  // PERF-B: cached time accessor — no per-frame map over every row time.
  let ticks = timeTicks(primary ? seriesTimeSource(primary) : [], model.time, { minGapPx: 56, hourFormat: "24", locale });
  if (ts.timeVisible === false) {
    ticks = ticks.filter((t) => t.weight >= TIME_TICK_WEIGHT.day);
  } else if (ts.secondsVisible === true && primary) {
    ticks = ticks.map((t) => {
      if (t.weight > TIME_TICK_WEIGHT.hour) return t;
      const ms = timeToMs(primary.rows[t.index]?.time ?? 0);
      if (!Number.isFinite(ms)) return t;
      const sec = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
      return { ...t, label: `${t.label}:${sec}` };
    });
  }
  const fmt = ts.tickMarkFormatter;
  if (typeof fmt === "function" && primary) {
    ticks = ticks.map((t) => {
      const row = primary.rows[t.index];
      try {
        const label = (fmt as (time: EngineTime, mark: number, locale: string) => string)(
          row?.time ?? t.label,
          tickMarkTypeOfWeight(t.weight),
          locale,
        );
        // As in LWC, only a non-string (null) keeps the renderer's label; "" is a
        // deliberate blank (chartTimeAxis.ts suppresses orphan day numbers with it).
        return typeof label === "string" ? { ...t, label } : t;
      } catch {
        return t;
      }
    });
  }
  return ticks;
}

function paintInPaneTimeAxis(
  ctx: CanvasRenderingContext2D,
  model: ChartModel,
  w: number,
  h: number,
  isLastPane: boolean,
): void {
  const { font, textColor } = layoutFont(model.options);
  const measure = measureFor(ctx);
  const dpr = model.dpr;

  const ts = (model.options.timeScale ?? {}) as Record<string, unknown>;
  if (isLastPane && ts.visible !== false) {
    if (ts.borderVisible !== false) {
      ctx.strokeStyle = typeof ts.borderColor === "string" ? ts.borderColor : CANVAS_NEUTRAL_DEFAULTS.axisBorderColor;
      ctx.beginPath();
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(w, h - 0.5);
      ctx.stroke();
    }
    const tTicks = timeAxisTicks(model);
    const tPlaced = layoutTimeLabels(
      tTicks.map((t) => ({ x: t.x, label: t.label, weight: t.weight })),
      { widthPx: w, paddingPx: 4, font, dpr, minGapPx: 48 },
      measure,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const lab of tPlaced) {
      if (lab.hidden) continue;
      ctx.fillStyle = CANVAS_NEUTRAL_DEFAULTS.axisLabelBackground;
      ctx.fillRect(lab.x - lab.width / 2 - 2, h - lab.height - 2, lab.width + 4, lab.height);
      ctx.fillStyle = textColor;
      ctx.fillText(lab.text, lab.x, h - 2);
    }
  }
}

function withClip(ctx: CanvasRenderingContext2D, w: number, h: number, paint: () => void): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

function displayScale(model: ChartModel, paneIndex: number, priceScaleId: string) {
  return model.autoscaleScale(paneIndex, priceScaleId);
}

export function engineProjectionFor(
  model: ChartModel,
  series: SeriesModel,
): EngineProjection {
  const pane = model.panes[series.paneIndex];
  const scale = displayScale(model, series.paneIndex, series.priceScaleId);
  const ts = model.time;
  return {
    generation: model.generation,
    dpr: model.dpr,
    widthPx: ts.widthPx,
    heightPx: pane?.height ?? 0,
    xOfLogical: (i) => model.xOfLogical(i),
    logicalOfX: (x) => model.logicalOfX(x),
    yOfPrice: (p) => priceScaleMath.yOfPrice(p, scale),
    priceOfY: (y) => priceScaleMath.priceOfY(y, scale),
    timeToX: (t) => model.timeToCoordinate(t),
    xToTime: (x) => model.coordinateToTime(x),
  };
}

export function engineProjectionForPane(model: ChartModel, paneIndex: number): EngineProjection {
  const sid = model.panes[paneIndex]?.seriesIds[0];
  const series = sid != null ? model.getSeries(sid) : undefined;
  if (series && !series.removed) return engineProjectionFor(model, series);
  return engineProjectionFor(model, {
    id: -1, kind: "line", options: {}, rows: [], markers: [], priceLines: [], primitives: [],
    paneIndex, priceScaleId: "right", removed: false,
  });
}

type PriceLineSpecs = Parameters<typeof layoutPriceLines>[0];

/**
 * The strokes LWC draws in the pane for one series: its price line (SeriesPriceLinePaneView)
 * and its custom price lines (CustomPriceLinePaneView). Titles and axis labels belong to
 * the price axis views, so the specs carry neither.
 */
function seriesPriceLineSpecs(model: ChartModel, s: SeriesModel): PriceLineSpecs {
  if (!model.hasFirstValue(s)) return [];
  const out: PriceLineSpecs = [];
  const o = s.options;
  if (o.priceLineVisible !== false) {
    const idx = model.lastValueIndex(s, o.priceLineSource !== 1);
    const price = idx >= 0 ? seriesClose(s.rows[idx]) : null;
    if (price != null && Number.isFinite(price)) {
      const own = typeof o.priceLineColor === "string" ? o.priceLineColor : "";
      out.push({
        price,
        color: own || seriesBarColor(s, idx, paintStyleOf(s)),
        lineWidth: typeof o.priceLineWidth === "number" ? o.priceLineWidth : 1,
        lineStyle: o.priceLineStyle ?? 2,
        title: "",
        axisLabelVisible: false,
      });
    }
  }
  for (const line of s.priceLines) {
    if (!line.removed) out.push({ ...line.spec, title: "", axisLabelVisible: false });
  }
  return out;
}

function paintDecorForSeries(
  ctx: CanvasRenderingContext2D,
  model: ChartModel,
  series: SeriesModel,
  proj: EngineProjection,
  w: number,
  h: number,
  part: "priceLines" | "markers",
): void {
  const plotRect = { x: 0, y: 0, width: w, height: h };
  const measure = (text: string) => (typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * 7);
  if (part === "priceLines") {
    paintDecorations(ctx, {
      priceLines: layoutPriceLines(seriesPriceLineSpecs(model, series), {
        projection: proj, plotRect, axisRect: { x: w, y: 0, width: 0, height: h }, measure,
      }),
    }, { dpr: proj.dpr });
    return;
  }
  const font = layoutFont(model.options);
  paintDecorations(ctx, {
    markers: layoutMarkers(series.markers, {
      projection: proj, rowsIndex: rowsIndexFor(series, proj),
      barSpacing: Math.abs(proj.xOfLogical(1) - proj.xOfLogical(0)) || 1, dpr: proj.dpr,
      fontSize: font.fontSize, font: font.font,
    }).markers,
  }, { dpr: proj.dpr });
}

/** A series the caller hid (ChartPanel.tsx:2471 hides a compare series with
 *  applyOptions({ visible: false })) paints nothing at all: not its own geometry,
 *  not its price lines, not its markers. Autoscale and the crosshair are out of
 *  scope here - they read the model, not this frame. */
function seriesPaintable(s: SeriesModel | undefined): s is SeriesModel {
  return s != null && !s.removed && s.options.visible !== false;
}

export type PanePaintArgs = {
  ctx: CanvasRenderingContext2D;
  model: ChartModel;
  paneIndex: number;
  primHost: PrimitiveHost;
  /**
   * GAP-PRIMFIX C03-A04 - the frame generation the invalidator stamped for this
   * paint. deliverPrimitiveUpdates hands primitives that same counter, so
   * threading it into the pane projection is what makes a primitive's paint()
   * and its update()-cached hit coordinates agree on which generation they came
   * from. Callers that have no frame (snapshot, direct unit use) omit it and keep
   * model.generation, the pre-existing value.
   */
  generation?: number;
  /** The pane's price-axis state the frame already measured the axis width from. */
  axis?: PaneAxisState;
};

export function paintPaneFrame(args: PanePaintArgs): void {
  const { ctx: raw, model, paneIndex, primHost } = args;
  const pane = model.panes[paneIndex];
  if (!pane) return;
  const ctx = ensurePaintCtx(raw);
  const w = model.time.widthPx;
  const h = pane.height;
  const { bg } = layoutFont(model.options);
  const axis = args.axis ?? paneAxisState(ctx, model, paneIndex);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  paintGrid(ctx, model, axis, w, h);

  // PATCH3P2 F12 — delete the dead session-shading branch. The list was hardcoded
  // `[]` so layoutSessionShading always returned `[]` and paintDecorations({sessionShading})
  // never ran. The full fix also needs a `pane.sessionShading` field on the model
  // (MODEL2-owned — see PROPOSED_PATCHES).
  const paneProj = args.generation === undefined
    ? engineProjectionForPane(model, paneIndex)
    : { ...engineProjectionForPane(model, paneIndex), generation: args.generation };

  withClip(ctx, w, h, () => primHost.paintPane(ctx, paneIndex, paneProj, "bottom"));

  const view = { dpr: model.dpr, clipRect: { x: 0, y: 0, width: w, height: h } };
  for (const sid of pane.seriesIds) {
    const s = model.getSeries(sid);
    if (!seriesPaintable(s)) continue;
    const proj = engineProjectionFor(model, s);
    paintKind(ctx as unknown as PaintContext, s, proj, paintStyleOf(s), view);
  }

  for (const part of ["priceLines", "markers"] as const) {
    for (const sid of pane.seriesIds) {
      const s = model.getSeries(sid);
      if (!seriesPaintable(s)) continue;
      paintDecorForSeries(ctx, model, s, engineProjectionFor(model, s), w, h, part);
    }
  }

  withClip(ctx, w, h, () => primHost.paintPane(ctx, paneIndex, paneProj, "normal"));

  if (pane.watermark) {
    const measure = (text: string) => (
      typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * 7
    );
    paintDecorations(ctx, {
      watermark: layoutWatermark(pane.watermark, { x: 0, y: 0, width: w, height: h }, measure),
    }, { dpr: model.dpr });
  }

  // LWC PriceAxisWidget._alignLabels, then the pane halves of the same views
  // (PanePriceAxisView: right-aligned against the axis, separator in the pane colour).
  if (axis.alignLabels) fixLabelOverlap(axis.views.filter(labelVisible), h, axis.center, axis.ro);
  if (axis.axisVisible) {
    for (const v of axis.views) {
      if (!v.pane.visible) continue;
      drawPriceAxisLabel(ctx, {
        view: v, part: "pane", ro: axis.ro, align: "right", x0: 0, mediaWidth: w, dpr: model.dpr,
        ticksVisible: axis.ticksVisible, paneBackground: bg ?? "",
      });
    }
  }

  withClip(ctx, w, h, () => primHost.paintPane(ctx, paneIndex, paneProj, "top"));
  paintInPaneTimeAxis(ctx, model, w, h, paneIndex === timeAxisOwnerPane(model.panes.map((p) => p.height)));
  // The strip paints last so series and labels that overflow the plot never show in it.
  paintPriceAxisStrip(ctx, axis, w, model.chartWidthPx() - w, h, bg, model.dpr);
}

export type OverlayPaintArgs = {
  ctx: CanvasRenderingContext2D;
  model: ChartModel;
  point: { x: number; y: number } | null;
  /** Last settled price-axis state per pane; the crosshair price label uses its formatter. */
  axes?: readonly (PaneAxisState | undefined)[];
};

// LWC LineStyle: Solid 0, Dotted 1, Dashed 2, LargeDashed 3 (the crosshair default), SparseDotted 4.
function crosshairDash(style: unknown, lw: number): number[] {
  switch (style) {
    case 0: return [];
    case 1: return [lw, lw];
    case 2: return [2 * lw, 2 * lw];
    case 4: return [lw, 4 * lw];
    default: return [6 * lw, 6 * lw];
  }
}

// LWC DateTimeFormatter with the default "dd MMM 'yy" date format; time scale options add the
// clock after a three-space gap. localization.timeFormatter replaces the whole label.
function crosshairTimeText(model: ChartModel, time: EngineTime): string | null {
  const loc = (model.options.localization ?? {}) as { timeFormatter?: unknown };
  if (typeof loc.timeFormatter === "function") return String((loc.timeFormatter as (t: EngineTime) => unknown)(time));
  const d = dateOf(time);
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).toLocaleString(localizationLocaleOf(model), { month: "short" });
  const date = `${pad(d.getUTCDate())} ${month} '${pad(d.getUTCFullYear() % 100)}`;
  const ts = (model.options.timeScale ?? {}) as Record<string, unknown>;
  if (ts.timeVisible !== true) return date;
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${date}   ${ts.secondsVisible === true ? `${clock}:${pad(d.getUTCSeconds())}` : clock}`;
}

/**
 * LWC crosshair: dashed lines (the vertical one snapped to the bar, the horizontal one only in
 * the hovered pane), the price label in the axis strip and the time label on the time axis,
 * both coloured from labelBackgroundColor. Nothing is drawn over the price axis strip.
 */
export function paintOverlayFrame(args: OverlayPaintArgs): void {
  const { ctx: raw, model, point, axes } = args;
  const ctx = ensurePaintCtx(raw);
  const w = model.time.widthPx;
  const h = model.totalHeight;
  ctx.clearRect(0, 0, model.chartWidthPx(), h);
  if (!point || !(point.x >= 0 && point.x < w && point.y >= 0 && point.y < h)) return;
  const ch = (model.options.crosshair && typeof model.options.crosshair === "object" ? model.options.crosshair : {}) as {
    mode?: unknown; vertLine?: unknown; horzLine?: unknown;
  };
  if (ch.mode === 2) return;
  let paneIndex = 0;
  let top = 0;
  while (paneIndex < model.panes.length - 1 && point.y >= top + model.panes[paneIndex].height) {
    top += model.panes[paneIndex].height;
    paneIndex++;
  }
  const paneH = model.panes[paneIndex]?.height ?? h;
  const dpr = model.dpr || 1;
  const x = model.xOfLogical(snapLogicalToBar(model.logicalOfX(point.x)));
  const line = (bag: unknown, draw: (crisp: (c: number) => number) => void) => {
    const color = bagColor(bag, LWC_CROSSHAIR.lineColor);
    if (!bagVisible(bag) || color === "") return;
    const width = bag && typeof bag === "object" && typeof (bag as { width?: unknown }).width === "number"
      ? (bag as { width: number }).width : 1;
    const devW = Math.max(1, Math.floor(width * dpr));
    const odd = devW % 2 ? 0.5 : 0;
    ctx.save();
    ctx.lineWidth = devW / dpr;
    ctx.strokeStyle = color;
    ctx.setLineDash(crosshairDash((bag as { style?: unknown } | undefined)?.style, devW / dpr));
    ctx.beginPath();
    draw((c) => (Math.round(c * dpr) + odd) / dpr);
    ctx.stroke();
    ctx.restore();
  };
  if (Number.isFinite(x)) line(ch.vertLine, (crisp) => { ctx.moveTo(crisp(x), 0); ctx.lineTo(crisp(x), h); });
  line(ch.horzLine, (crisp) => { ctx.moveTo(0, crisp(point.y)); ctx.lineTo(w, crisp(point.y)); });

  const { font, fontSize: fs } = layoutFont(model.options);
  ctx.font = font;
  const labelOf = (bag: unknown) => {
    if (bag && typeof bag === "object" && (bag as { labelVisible?: unknown }).labelVisible === false) return null;
    const bg = bag && typeof bag === "object" && typeof (bag as { labelBackgroundColor?: unknown }).labelBackgroundColor === "string"
      ? (bag as { labelBackgroundColor: string }).labelBackgroundColor : LWC_CROSSHAIR.labelBackground;
    return contrastColors(bg);
  };
  const axis = axes?.[paneIndex];
  const priceColors = labelOf(ch.horzLine);
  if (priceColors && axis && axis.axisVisible && axis.hasFirst && model.chartWidthPx() > w) {
    const yLocal = point.y - top;
    const view = axisLabelView({
      coordinate: point.y, background: priceColors.background,
      additionalPaddingTop: (2 / 12) * fs, additionalPaddingBottom: (2 / 12) * fs,
      axis: { text: axis.fmt.formatPrice(priceScaleMath.priceOfY(yLocal, axis.scale), axis.scale), visible: yLocal < paneH, color: priceColors.foreground },
    });
    if (view.axis.visible) {
      drawPriceAxisLabel(ctx, {
        view, part: "axis", ro: axis.ro, align: "left", x0: w, mediaWidth: model.chartWidthPx() - w, dpr,
        ticksVisible: axis.ticksVisible, paneBackground: "",
      });
    }
  }
  const timeColors = labelOf(ch.vertLine);
  const ts = (model.options.timeScale ?? {}) as Record<string, unknown>;
  const time = Number.isFinite(x) ? model.coordinateToTime(x) : null;
  const text = timeColors && ts.visible !== false && time != null ? crosshairTimeText(model, time) : null;
  if (!timeColors || !text) return;
  const padH = (9 / 12) * fs;
  const axisH = Math.ceil(1 + 5 + (3 / 12) * fs + fs + (3 / 12) * fs);
  const labelW = Math.round(ctx.measureText(text.replace(/[1-9]/g, "0")).width) + 2 * padH;
  let x1 = Math.floor(x - labelW / 2) + 0.5;
  if (x1 < 0) x1 = 0;
  else if (x1 + labelW > w) x1 = w - labelW;
  // The label sits on the time axis, which lives at the bottom of its owner pane
  // (the last pane, or the maximised one when the rest are squashed away).
  const y1 = timeAxisOwnerBottom(model.panes.map((p) => p.height)) - axisH;
  ctx.fillStyle = timeColors.background;
  roundRectPath(ctx, x1, y1, labelW, axisH, [0, 0, 2, 2]);
  ctx.fill();
  if (ts.ticksVisible === true) {
    const tickW = Math.max(1, Math.floor(dpr));
    ctx.fillStyle = timeColors.foreground;
    ctx.fillRect((Math.round(x * dpr) - Math.floor(tickW / 2)) / dpr, y1, tickW / dpr, 5);
  }
  ctx.fillStyle = timeColors.foreground;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x1 + padH, y1 + 1 + 5 + (3 / 12) * fs + fs / 2 + yMidCorrection(ctx, "Apr0"));
}

export function deliverPrimitiveUpdates(model: ChartModel, primHost: PrimitiveHost, generation: number): void {
  // PATCH3P2 F11 — route per-pane delivery through the host so the once-per-generation
  // guard (R04-A01) and the record-on-throw error log (R04-A03) survive. The bare
  // `catch {}` here used to swallow errors silently.
  for (let i = 0; i < model.panes.length; i++) {
    const paneProj = { ...engineProjectionForPane(model, i), generation };
    primHost.deliverPane(i, paneProj);
  }
}
