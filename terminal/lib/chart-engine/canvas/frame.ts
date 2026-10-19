// Mastermind Chart Engine — one-frame compositor for the native Canvas2D engine.
// Paint order: background → grid → session shading → bottom primitives → series →
// price lines → markers → normal primitives → watermark → top primitives → in-pane
// axes. Overlay: crosshair. No lightweight-charts.

import type { EngineSeriesKind, EngineSeriesOptions, EngineSeriesRow, EngineTime } from "../api";
import type { EngineProjection } from "../primitive";
import { axisWidthForLabels, layoutPriceLabels, layoutTimeLabels, type Measure as AxisMeasure } from "./axes";
import {
  layoutMarkers,
  layoutPriceLines,
  layoutWatermark,
  paintDecorations,
  type RowsIndex,
} from "./decorations";
import { priceAxisWidthFor } from "./layout";
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
import { priceTicks, timeTicks, TIME_TICK_WEIGHT, type TimeTick } from "./ticks";
import type { PriceScaleState as TickPriceScale } from "./scales";

/** Single named palette for canvas/ fallbacks (F-14). Never used as up/down. */
export const CANVAS_NEUTRAL_DEFAULTS = {
  seriesColor: "#848484",
  gridColor: "rgba(128,128,128,0.2)",
  crosshairColor: "rgba(180,180,180,0.6)",
  textColor: "#848484",
  axisLabelBackground: "rgba(0,0,0,0.65)",
  axisBorderColor: "rgba(128,128,128,0.4)",
} as const;

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
  if (v === 1 || v === "dashed") return "dashed";
  if (v === 2 || v === "dotted") return "dotted";
  return "solid";
}

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
    lineWidth: typeof opts.lineWidth === "number" && opts.lineWidth > 0 ? opts.lineWidth : 1,
    lineStyle: lineStyleOf(opts),
    topFillColor: fill,
    bottomFillColor: bottomFill,
    topLineColor: optStr(opts, "topLineColor") ?? line,
    bottomLineColor: optStr(opts, "bottomLineColor") ?? line,
    baseValueColor: optStr(opts, "baseValueColor") ?? defaults.seriesColor,
  };
}

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
  for (const col of columnAggregate(series.rows, from, to, columns, ohlcAccessor())) {
    const g = columnCandle(col, xOf, yOf);
    if (g) out.push(g);
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
  const cols = () => lodColumns(series, slice[0], slice[1], Math.max(1, Math.floor(proj.widthPx)), proj.xOfLogical, proj.yOfPrice);

  if (series.kind === "candles" || series.kind === "bars") {
    if (useLod) {
      paintSeriesKind(ctx, "candles", cols(), style, view);
      return;
    }
    if (series.kind === "candles") {
      const geo = candleGeometry(series.rows, proj, series.options);
      const candles: CandleGeom[] = geo.visual ? cols() : geo.bodies.map((b, i) => {
        const w = geo.wicks[i];
        return {
          x: b.x, halfWidth: b.width / 2, openY: b.yOpen, closeY: b.yClose,
          highY: w?.yHigh ?? b.yOpen, lowY: w?.yLow ?? b.yClose, up: b.up, visible: w?.visible ?? true,
        };
      });
      paintSeriesKind(ctx, "candles", candles, style, view);
      return;
    }
    const ticks = barGeometry(series.rows, proj, series.options).ticks;
    const bars: BarGeom[] = ticks.map((t) => ({
      x: t.x, halfWidth: Math.abs(t.closeX - t.x), openY: t.yOpen, closeY: t.yClose,
      highY: t.yHigh, lowY: t.yLow, up: t.up, visible: true,
      openTickLength: Math.abs(t.x - t.openX), closeTickLength: Math.abs(t.closeX - t.x),
    }));
    paintSeriesKind(ctx, "bars", bars, style, view);
    return;
  }

  if (series.kind === "histogram") {
    const columns: HistogramColumn[] = useLod
      ? cols().map((c) => ({ x: c.x, halfWidth: c.halfWidth, topY: Math.min(c.openY, c.closeY), baseY: Math.max(c.openY, c.closeY), up: c.up }))
      : histogramGeometry(series.rows, proj, series.options).columns.map((c) => ({
        x: c.x, halfWidth: c.width / 2, topY: c.y, baseY: c.yBase, up: c.y <= c.yBase,
      }));
    paintSeriesKind(ctx, "histogram", { columns }, style, view);
    return;
  }

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

function layoutFont(options: ChartModel["options"]): { font: string; textColor: string; bg: string | null } {
  const layout = (options.layout && typeof options.layout === "object" ? options.layout : {}) as Record<string, unknown>;
  const fontSize = typeof layout.fontSize === "number" && layout.fontSize > 0 ? layout.fontSize : 11;
  const fontFamily = typeof layout.fontFamily === "string" ? layout.fontFamily : "sans-serif";
  const textColor = typeof layout.textColor === "string" ? layout.textColor : CANVAS_NEUTRAL_DEFAULTS.textColor;
  const nested = layout.background && typeof layout.background === "object"
    ? (layout.background as { color?: unknown }).color : undefined;
  const bg = typeof layout.backgroundColor === "string" ? layout.backgroundColor
    : typeof nested === "string" ? nested : null;
  return { font: `${fontSize}px ${fontFamily}`, textColor, bg };
}

function measureFor(ctx: CanvasRenderingContext2D): AxisMeasure {
  return (text, font) => {
    ctx.font = font;
    return { width: typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * 7, height: 12 };
  };
}

function paintGrid(ctx: CanvasRenderingContext2D, model: ChartModel, paneIndex: number, w: number, h: number): void {
  const grid = model.options.grid;
  if (!grid || typeof grid !== "object") return;
  const g = grid as { vertLines?: unknown; horzLines?: unknown };
  const scale = displayScale(model, paneIndex, displayedPriceScaleId(model)) as TickPriceScale;
  if (bagVisible(g.horzLines)) {
    ctx.strokeStyle = bagColor(g.horzLines, CANVAS_NEUTRAL_DEFAULTS.gridColor);
    ctx.lineWidth = 1;
    for (const tick of priceTicks(scale, { minLabelGapPx: Math.max(18, h / 8) })) {
      ctx.beginPath();
      ctx.moveTo(0, tick.y);
      ctx.lineTo(w, tick.y);
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
          t.weight,
          locale,
        );
        return typeof label === "string" && label !== "" ? { ...t, label } : t;
      } catch {
        return t;
      }
    });
  }
  return ticks;
}

function paintInPaneAxes(
  ctx: CanvasRenderingContext2D,
  model: ChartModel,
  paneIndex: number,
  w: number,
  h: number,
  isLastPane: boolean,
): void {
  const { font, textColor } = layoutFont(model.options);
  const measure = measureFor(ctx);
  const dpr = model.dpr;
  const scale = displayScale(model, paneIndex, displayedPriceScaleId(model)) as TickPriceScale;
  const pTicks = priceTicks(scale, { minLabelGapPx: 24 });
  const strip = Math.max(40, priceAxisWidthFor(
    [axisWidthForLabels(pTicks.map((t) => t.label), measure, font, 4)],
    0,
  ));
  model.priceAxisStripPx[paneIndex] = strip;
  const placed = layoutPriceLabels(
    pTicks.map((t) => ({ value: t.value, y: t.y, label: t.label })),
    { heightPx: h, widthPx: strip, paddingPx: 4, font, dpr },
    measure,
  );
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const lab of placed) {
    if (lab.hidden) continue;
    const x1 = w - 2;
    const x0 = x1 - lab.width - 6;
    ctx.fillStyle = CANVAS_NEUTRAL_DEFAULTS.axisLabelBackground;
    ctx.fillRect(x0, lab.y - lab.height / 2, lab.width + 6, lab.height);
    ctx.fillStyle = textColor;
    ctx.fillText(lab.text, x1 - 2, lab.y);
  }

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

function paintDecorForSeries(
  ctx: CanvasRenderingContext2D,
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
      priceLines: layoutPriceLines(series.priceLines.filter((l) => !l.removed).map((l) => l.spec), {
        projection: proj, plotRect, axisRect: { x: w - 52, y: 0, width: 52, height: h }, measure,
      }),
    }, { dpr: proj.dpr });
    return;
  }
  paintDecorations(ctx, {
    markers: layoutMarkers(series.markers, {
      projection: proj, rowsIndex: rowsIndexFor(series, proj),
      barSpacing: Math.abs(proj.xOfLogical(1) - proj.xOfLogical(0)) || 1, dpr: proj.dpr,
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
};

export function paintPaneFrame(args: PanePaintArgs): void {
  const { ctx: raw, model, paneIndex, primHost } = args;
  const pane = model.panes[paneIndex];
  if (!pane) return;
  const ctx = ensurePaintCtx(raw);
  const w = model.time.widthPx;
  const h = pane.height;
  const { bg } = layoutFont(model.options);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }
  paintGrid(ctx, model, paneIndex, w, h);

  // PATCH3P2 F12 — delete the dead session-shading branch. The list was hardcoded
  // `[]` so layoutSessionShading always returned `[]` and paintDecorations({sessionShading})
  // never ran. The full fix also needs a `pane.sessionShading` field on the model
  // (MODEL2-owned — see PROPOSED_PATCHES).
  const paneProj = args.generation === undefined
    ? engineProjectionForPane(model, paneIndex)
    : { ...engineProjectionForPane(model, paneIndex), generation: args.generation };
  const plotRect = { x: 0, y: 0, width: w, height: h };
  void plotRect; // unused now; kept for the named binding when the model-side lands

  withClip(ctx, w, h, () => primHost.paintPane(ctx, paneIndex, paneProj, "bottom"));

  const view = { dpr: model.dpr, clipRect: { x: 0, y: 0, width: w, height: h } };
  for (const sid of pane.seriesIds) {
    const s = model.getSeries(sid);
    if (!seriesPaintable(s)) continue;
    const proj = engineProjectionFor(model, s);
    const style = resolveSeriesPaintStyle(s.options, s.kind, CANVAS_NEUTRAL_DEFAULTS);
    if (style) paintKind(ctx as unknown as PaintContext, s, proj, style, view);
  }

  for (const part of ["priceLines", "markers"] as const) {
    for (const sid of pane.seriesIds) {
      const s = model.getSeries(sid);
      if (!seriesPaintable(s)) continue;
      paintDecorForSeries(ctx, s, engineProjectionFor(model, s), w, h, part);
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

  withClip(ctx, w, h, () => primHost.paintPane(ctx, paneIndex, paneProj, "top"));
  paintInPaneAxes(ctx, model, paneIndex, w, h, paneIndex === model.panes.length - 1);
}

export type OverlayPaintArgs = {
  ctx: CanvasRenderingContext2D;
  model: ChartModel;
  point: { x: number; y: number } | null;
};

export function paintOverlayFrame(args: OverlayPaintArgs): void {
  const { ctx: raw, model, point } = args;
  const ctx = ensurePaintCtx(raw);
  const w = model.time.widthPx;
  const h = model.totalHeight;
  ctx.clearRect(0, 0, w, h);
  if (!point) return;
  const ch = model.options.crosshair;
  const bag = ch && typeof ch === "object" ? ch as { vertLine?: unknown; horzLine?: unknown } : {};
  ctx.lineWidth = 1;
  ctx.strokeStyle = bagColor(bag.vertLine, CANVAS_NEUTRAL_DEFAULTS.crosshairColor);
  ctx.beginPath();
  ctx.moveTo(point.x, 0);
  ctx.lineTo(point.x, h);
  ctx.stroke();
  ctx.strokeStyle = bagColor(bag.horzLine, CANVAS_NEUTRAL_DEFAULTS.crosshairColor);
  ctx.beginPath();
  ctx.moveTo(0, point.y);
  ctx.lineTo(w, point.y);
  ctx.stroke();
  const { font, textColor } = layoutFont(model.options);
  const label = String(point.x.toFixed(0));
  const tw = typeof ctx.measureText === "function" ? ctx.measureText(label).width : label.length * 7;
  ctx.font = font;
  ctx.fillStyle = CANVAS_NEUTRAL_DEFAULTS.axisLabelBackground;
  ctx.fillRect(point.x - tw / 2 - 2, h - 14, tw + 4, 12);
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, point.x, h - 2);
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
