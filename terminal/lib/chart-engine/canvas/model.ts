// Mastermind Chart Engine — owned Canvas2D chart model (P3 / R01).
//
// Pure state + handle factories. No DOM, no renderer vendor. Coordinate math
// matches the programme convention: a bar at logical index i is centred at
//   x = (i - visibleFrom + 0.5) * barSpacing
// with barSpacing = widthPx / (visibleTo - visibleFrom). Price→y is linear in
// the pane's plot area after scaleMargins (defaults {top:0.2,bottom:0.1}).
//
// Seams for sibling lanes:
//   priceScaleMath     — T02 (scales.ts) replaces log/percent/indexed100.
//   futureSlotResolver — future-time cadence past the last primary row.

import type {
  EngineInventory,
  EngineLogicalRange,
  EngineLogicalRangeHandler,
  EngineMismatchDirection,
  EngineMouseEventParams,
  EngineMouseHandler,
  EngineOptions,
  EngineRange,
  EngineSeriesKind,
  EngineSeriesOptions,
  EngineSeriesRow,
  EngineTime,
  MarkerSpec,
  PaneHandle,
  PriceLineHandle,
  PriceLineSpec,
  PriceScaleHandle,
  SeriesHandle,
  TimeScaleHandle,
  WatermarkLine,
  WatermarkSpec,
} from "../api";
import { futureBarTimes, futureCadence, futureSlotOf } from "../futureTime";

export type LogicalIndex = number;
export type TimeScaleState = {
  visibleFrom: number;
  visibleTo: number;
  barSpacing: number;
  rightOffset: number;
  widthPx: number;
};
export type PriceScaleState = {
  mode: "normal" | "log" | "percent" | "indexed100";
  inverted: boolean;
  from: number;
  to: number;
  heightPx: number;
  margins: { top: number; bottom: number };
  autoScale: boolean;
};
export type Projection = {
  generation: number;
  dpr: number;
  widthPx: number;
  heightPx: number;
  xOfLogical(i: number): number;
  logicalOfX(x: number): number;
  yOfPrice(p: number): number;
  priceOfY(y: number): number;
};
export type PriceLineModel = { id: number; spec: PriceLineSpec; removed: boolean };
export type SeriesModel = {
  id: number;
  kind: EngineSeriesKind;
  options: EngineSeriesOptions;
  rows: EngineSeriesRow[];
  markers: MarkerSpec[];
  priceLines: PriceLineModel[];
  primitives: unknown[];
  paneIndex: number;
  priceScaleId: string;
  removed: boolean;
};
export type PaneModel = {
  index: number;
  height: number;
  stretchFactor: number;
  seriesIds: number[];
  scales: Map<string, PriceScaleState>;
  watermark: WatermarkSpec | null;
};

export const DEFAULT_SCALE_MARGINS = { top: 0.2, bottom: 0.1 };

export function xOfLogical(i: number, ts: TimeScaleState): number {
  const span = ts.visibleTo - ts.visibleFrom;
  const spacing = span !== 0 ? ts.widthPx / span : ts.barSpacing;
  return (i - ts.visibleFrom + 0.5) * spacing;
}

export function logicalOfX(x: number, ts: TimeScaleState): number {
  const span = ts.visibleTo - ts.visibleFrom;
  const spacing = span !== 0 ? ts.widthPx / span : ts.barSpacing;
  if (spacing === 0) return ts.visibleFrom;
  return x / spacing + ts.visibleFrom - 0.5;
}

/** Named seam: T02's scales.ts replaces these implementations. R01 is linear/normal. */
export const priceScaleMath = {
  yOfPrice(price: number, scale: PriceScaleState): number {
    const { from, to, heightPx, margins, inverted } = scale;
    const span = to - from;
    if (!(heightPx > 0) || span === 0 || !Number.isFinite(span)) return heightPx / 2;
    const topPx = margins.top * heightPx;
    const plot = heightPx - topPx - margins.bottom * heightPx;
    if (!(plot > 0)) return heightPx / 2;
    const y = topPx + (1 - (price - from) / span) * plot;
    return inverted ? heightPx - y : y;
  },
  priceOfY(y: number, scale: PriceScaleState): number {
    const { from, to, heightPx, margins, inverted } = scale;
    const span = to - from;
    if (!(heightPx > 0) || span === 0 || !Number.isFinite(span)) return (from + to) / 2;
    const topPx = margins.top * heightPx;
    const plot = heightPx - topPx - margins.bottom * heightPx;
    if (!(plot > 0)) return (from + to) / 2;
    const yAdj = inverted ? heightPx - y : y;
    return to - ((yAdj - topPx) / plot) * span;
  },
  autoscale(values: number[]): { from: number; to: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { from: 0, to: 1 };
    if (min === max) return { from: min - 1, to: max + 1 };
    return { from: min, to: max };
  },
};

export function timeToMs(t: EngineTime): number {
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  if (typeof t === "object") return Date.UTC(t.year, t.month - 1, t.day, 12, 0, 0);
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  return Date.parse(t.includes("T") ? t : `${t}T12:00:00Z`);
}

export function asCadenceTime(t: EngineTime): string | number {
  if (typeof t === "object") {
    return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  }
  return t;
}

export type FutureSlotResolver = (
  time: EngineTime,
  primaryTimes: readonly EngineTime[],
) => { logical: number; time: EngineTime } | null;

/** Named seam: replace `.resolve` to plug a different future-time cadence. */
export const futureSlotResolver: { resolve: FutureSlotResolver } = {
  resolve(time, primaryTimes) {
    if (primaryTimes.length < 2) return null;
    const times = primaryTimes.map(asCadenceTime);
    const slot = futureSlotOf(futureCadence(times), asCadenceTime(time));
    if (slot < 0) return null;
    const ft = futureBarTimes(times)[slot];
    return ft == null ? null : { logical: primaryTimes.length + slot, time: ft };
  },
};

function freshScale(heightPx: number): PriceScaleState {
  return {
    mode: "normal",
    inverted: false,
    from: 0,
    to: 1,
    heightPx,
    margins: { ...DEFAULT_SCALE_MARGINS },
    autoScale: true,
  };
}

function freshPane(index: number, height: number): PaneModel {
  return {
    index,
    height,
    stretchFactor: 1,
    seriesIds: [],
    scales: new Map([
      ["right", freshScale(height)],
      ["left", freshScale(height)],
    ]),
    watermark: null,
  };
}

function rowNumbers(row: EngineSeriesRow): number[] {
  if ("high" in row && typeof (row as { high: unknown }).high === "number") {
    const b = row as { open: number; high: number; low: number; close: number };
    return [b.open, b.high, b.low, b.close];
  }
  if ("value" in row && typeof (row as { value: unknown }).value === "number") {
    return [(row as { value: number }).value];
  }
  return [];
}

export function seriesClose(row: EngineSeriesRow): number | null {
  if ("close" in row && typeof (row as { close: unknown }).close === "number") return (row as { close: number }).close;
  if ("value" in row && typeof (row as { value: unknown }).value === "number") return (row as { value: number }).value;
  return null;
}

export type ModelHooks = { onInvalidate: () => void; onStructure: () => void };
export type PaneElementLookup = (index: number) => HTMLElement | null;
type MouseKind = "crosshair" | "click" | "dblclick";

export class ChartModel {
  alive = true;
  generation = 0;
  dpr = 1;
  options: EngineOptions = {};
  panes: PaneModel[] = [];
  series = new Map<number, SeriesModel>();
  seriesOrder: number[] = [];
  time: TimeScaleState = { visibleFrom: 0, visibleTo: 1, barSpacing: 1, rightOffset: 0, widthPx: 0 };
  totalHeight = 0;
  paneElementLookup: PaneElementLookup | null = null;
  readonly crosshairHandlers = new Set<EngineMouseHandler>();
  readonly clickHandlers = new Set<EngineMouseHandler>();
  readonly dblClickHandlers = new Set<EngineMouseHandler>();
  private readonly rangeHandlers = new Set<EngineLogicalRangeHandler>();
  private rangeExplicit = false;
  private nextSeriesId = 1;
  private nextLineId = 1;
  private readonly hooks: ModelHooks;
  private tsHandle: TimeScaleHandle | null = null;
  // Handle identity: the contract (C02) promises that pane.getSeries() and
  // series.priceLines() return the SAME handle objects the engine handed out.
  private readonly seriesHandles = new Map<number, ModelSeriesHandle>();
  private readonly lineHandles = new Map<number, ModelPriceLineHandle>();
  // Programmatic crosshair (ChartEngine.setCrosshairPosition): drawn by the
  // renderer, never echoed to crosshair subscribers (LWC semantics).
  externalCrosshair: { price: number; time: EngineTime; seriesId: number } | null = null;

  constructor(hooks: ModelHooks) {
    this.hooks = hooks;
    this.panes.push(freshPane(0, 0));
  }

  bump(): void {
    if (!this.alive) return;
    this.generation += 1;
    this.hooks.onInvalidate();
  }

  structure(): void {
    if (!this.alive) return;
    this.hooks.onStructure();
    this.bump();
  }

  private recomputeSpacing(): void {
    const span = this.time.visibleTo - this.time.visibleFrom;
    this.time.barSpacing = span !== 0 ? this.time.widthPx / span : this.time.barSpacing;
  }

  layoutHeights(totalHeight: number): void {
    this.totalHeight = Math.max(0, totalHeight);
    const n = this.panes.length;
    if (n === 0) return;
    const stretches = this.panes.map((p) => Math.max(1e-6, p.stretchFactor));
    const sum = stretches.reduce((a, b) => a + b, 0);
    let used = 0;
    for (let i = 0; i < n; i++) {
      const h = i === n - 1 ? Math.max(0, this.totalHeight - used) : Math.floor(this.totalHeight * (stretches[i] / sum));
      this.panes[i].height = h;
      used += h;
      for (const scale of this.panes[i].scales.values()) scale.heightPx = h;
    }
  }

  setWidth(widthPx: number): void {
    this.time.widthPx = Math.max(0, widthPx);
    this.recomputeSpacing();
  }

  primarySeries(): SeriesModel | null {
    for (const id of this.seriesOrder) {
      const s = this.series.get(id);
      if (s && !s.removed) return s;
    }
    return null;
  }

  getSeries(id: number): SeriesModel | undefined {
    return this.series.get(id);
  }

  scale(paneIndex: number, id: string): PriceScaleState {
    const pane = this.panes[paneIndex] ?? this.panes[0];
    let s = pane?.scales.get(id);
    if (!s) {
      s = freshScale(pane?.height ?? 0);
      pane?.scales.set(id, s);
    }
    return s;
  }

  xOfLogical(i: number): number { return xOfLogical(i, this.time); }
  logicalOfX(x: number): number { return logicalOfX(x, this.time); }

  autoscaleScale(paneIndex: number, priceScaleId: string): PriceScaleState {
    const scale = this.scale(paneIndex, priceScaleId);
    if (scale.mode !== "normal" || !scale.autoScale) return scale;
    const vals: number[] = [];
    const pane = this.panes[paneIndex];
    if (pane) {
      for (const sid of pane.seriesIds) {
        const s = this.series.get(sid);
        if (!s || s.removed || s.priceScaleId !== priceScaleId) continue;
        vals.push(...this.visibleValues(s));
      }
    }
    const next = priceScaleMath.autoscale(vals);
    scale.from = next.from;
    scale.to = next.to;
    return scale;
  }

  visibleValues(s: SeriesModel): number[] {
    const start = Math.max(0, Math.floor(this.time.visibleFrom));
    const end = Math.min(s.rows.length - 1, Math.ceil(this.time.visibleTo));
    const vals: number[] = [];
    for (let i = start; i <= end; i++) vals.push(...rowNumbers(s.rows[i]));
    return vals;
  }

  projectionFor(series: SeriesModel): Projection {
    const pane = this.panes[series.paneIndex];
    const scale = this.autoscaleScale(series.paneIndex, series.priceScaleId);
    const ts = this.time;
    return {
      generation: this.generation,
      dpr: this.dpr,
      widthPx: ts.widthPx,
      heightPx: pane?.height ?? 0,
      xOfLogical: (i) => xOfLogical(i, ts),
      logicalOfX: (x) => logicalOfX(x, ts),
      yOfPrice: (p) => priceScaleMath.yOfPrice(p, scale),
      priceOfY: (y) => priceScaleMath.priceOfY(y, scale),
    };
  }

  ensurePane(requested: number): number {
    const idx = Math.min(this.panes.length, Math.max(0, requested));
    if (idx < this.panes.length) return idx;
    this.panes.push(freshPane(idx, 0));
    this.layoutHeights(this.totalHeight);
    this.structure();
    return idx;
  }

  addSeries(kind: EngineSeriesKind, options?: EngineSeriesOptions, paneIndex?: number): SeriesHandle {
    if (!this.alive) return new ModelSeriesHandle(kind, this, -1);
    const pane = this.ensurePane(paneIndex ?? 0);
    const opts = { ...(options ?? {}) };
    const priceScaleId = typeof opts.priceScaleId === "string" ? opts.priceScaleId : "right";
    if (!this.panes[pane].scales.has(priceScaleId)) {
      this.panes[pane].scales.set(priceScaleId, freshScale(this.panes[pane].height));
    }
    const id = this.nextSeriesId++;
    const model: SeriesModel = {
      id, kind, options: opts, rows: [], markers: [], priceLines: [], primitives: [],
      paneIndex: pane, priceScaleId, removed: false,
    };
    this.series.set(id, model);
    this.seriesOrder.push(id);
    this.panes[pane].seriesIds.push(id);
    this.bump();
    const handle = new ModelSeriesHandle(kind, this, id);
    this.seriesHandles.set(id, handle);
    return handle;
  }

  /** The handle object addSeries() returned for `id` (identity-stable), or null. */
  seriesHandle(id: number): SeriesHandle | null {
    const s = this.series.get(id);
    if (!this.alive || !s || s.removed) return null;
    return this.seriesHandles.get(id) ?? null;
  }
  /** The handle object createPriceLine() returned for `lineId`, or null. */
  priceLineHandle(lineId: number): PriceLineHandle | null {
    return this.alive ? this.lineHandles.get(lineId) ?? null : null;
  }

  paneHandles(): PaneHandle[] {
    return this.alive ? this.panes.map((_, i) => new ModelPaneHandle(this, i)) : [];
  }
  paneHandle(index: number): PaneHandle { return new ModelPaneHandle(this, index); }
  timeScaleHandleFor(): TimeScaleHandle {
    return (this.tsHandle ??= new ModelTimeScaleHandle(this));
  }
  priceScaleHandle(id: string, paneIndex?: number): PriceScaleHandle {
    return new ModelPriceScaleHandle(this, id, paneIndex ?? 0);
  }

  paneSize(paneIndex?: number): { width: number; height: number } {
    if (!this.alive) return { width: 0, height: 0 };
    const idx = paneIndex ?? 0;
    const pane = this.panes[idx];
    if (!pane) throw new Error(`chart-engine: pane ${idx} does not exist`);
    return { width: this.time.widthPx, height: pane.height };
  }

  swapPanes(first: number, second: number): void {
    if (!this.alive || first === second) return;
    const a = this.panes[first];
    const b = this.panes[second];
    if (!a || !b) return;
    this.panes[first] = b;
    this.panes[second] = a;
    this.panes.forEach((p, i) => {
      p.index = i;
      for (const sid of p.seriesIds) {
        const s = this.series.get(sid);
        if (s) s.paneIndex = i;
      }
    });
    this.structure();
  }

  setWatermark(paneIndex: number, spec: WatermarkSpec | WatermarkLine[]): void {
    if (!this.alive) return;
    const pane = this.panes[paneIndex];
    if (!pane) throw new Error(`chart-engine: pane ${paneIndex} does not exist`);
    pane.watermark = Array.isArray(spec) ? { lines: spec } : spec;
    this.bump();
  }

  applyOptions(options: EngineOptions): void {
    if (!this.alive) return;
    this.options = { ...this.options, ...options };
    if (typeof options.width === "number") this.setWidth(options.width);
    if (typeof options.height === "number") this.layoutHeights(options.height);
    const ts = options.timeScale;
    if (ts && typeof ts === "object") {
      const bag = ts as Record<string, unknown>;
      if (typeof bag.rightOffset === "number") this.time.rightOffset = bag.rightOffset;
    }
    this.bump();
  }

  setVisibleLogicalRange(range: EngineLogicalRange): void {
    if (!this.alive) return;
    const { from, to } = range;
    if (from === this.time.visibleFrom && to === this.time.visibleTo) return;
    this.time.visibleFrom = from;
    this.time.visibleTo = to;
    this.rangeExplicit = true;
    this.recomputeSpacing();
    this.generation += 1;
    this.hooks.onInvalidate();
    for (const h of this.rangeHandlers) h({ from, to });
  }

  getVisibleLogicalRange(): EngineLogicalRange | null {
    return this.alive ? { from: this.time.visibleFrom, to: this.time.visibleTo } : null;
  }

  subscribeRange(handler: EngineLogicalRangeHandler): void {
    if (this.alive) this.rangeHandlers.add(handler);
  }
  unsubscribeRange(handler: EngineLogicalRangeHandler): void {
    this.rangeHandlers.delete(handler);
  }

  private handlerSet(kind: MouseKind): Set<EngineMouseHandler> {
    if (kind === "click") return this.clickHandlers;
    if (kind === "dblclick") return this.dblClickHandlers;
    return this.crosshairHandlers;
  }
  subscribe(kind: MouseKind, handler: EngineMouseHandler): void {
    if (this.alive) this.handlerSet(kind).add(handler);
  }
  unsubscribe(kind: MouseKind, handler: EngineMouseHandler): void {
    this.handlerSet(kind).delete(handler);
  }
  emitMouse(kind: MouseKind, param: EngineMouseEventParams): void {
    if (!this.alive) return;
    for (const h of this.handlerSet(kind)) h(param);
  }

  timeToCoordinate(time: EngineTime): number | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    const target = timeToMs(time);
    if (!Number.isFinite(target)) return null;
    const times = primary.rows.map((r) => timeToMs(r.time));
    const lo = Math.min(times[0], times[times.length - 1]);
    const hi = Math.max(times[0], times[times.length - 1]);
    if (target < lo || target > hi) {
      const fut = futureSlotResolver.resolve(time, primary.rows.map((r) => r.time));
      return fut ? this.xOfLogical(fut.logical) : null;
    }
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(times[i] - target);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return this.xOfLogical(best);
  }

  coordinateToTime(x: number): EngineTime | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    const n = primary.rows.length;
    const i = Math.round(this.logicalOfX(x));
    if (i < 0) return null;
    if (i < n) return primary.rows[i].time;
    const futures = futureBarTimes(primary.rows.map((r) => asCadenceTime(r.time)));
    return futures[i - n] ?? null;
  }

  fitContent(): void {
    if (this.alive) this.setVisibleLogicalRange({ from: 0, to: Math.max(1, this.primarySeries()?.rows.length ?? 0) });
  }
  scrollToRealtime(): void {
    if (!this.alive) return;
    const n = this.primarySeries()?.rows.length ?? 0;
    const span = this.time.visibleTo - this.time.visibleFrom;
    const width = span > 0 ? span : Math.max(1, n);
    const right = this.time.rightOffset;
    this.setVisibleLogicalRange({ from: n - width + right, to: n + right });
  }
  scrollToPosition(position: number): void {
    if (!this.alive) return;
    this.time.rightOffset = position;
    this.scrollToRealtime();
  }
  applyTimeScaleOptions(opts: Record<string, unknown>): void {
    if (!this.alive) return;
    if (typeof opts.rightOffset === "number") this.time.rightOffset = opts.rightOffset;
    if (typeof opts.barSpacing === "number") {
      this.time.barSpacing = opts.barSpacing;
      if (this.time.widthPx > 0 && opts.barSpacing > 0) {
        this.time.visibleTo = this.time.visibleFrom + this.time.widthPx / opts.barSpacing;
      }
    }
    this.bump();
  }

  moveSeries(id: number, paneIndex: number): void {
    const s = this.series.get(id);
    if (!this.alive || !s || s.removed) return;
    const dest = this.ensurePane(paneIndex);
    if (s.paneIndex === dest) return;
    const from = this.panes[s.paneIndex];
    if (from) from.seriesIds = from.seriesIds.filter((sid) => sid !== id);
    s.paneIndex = dest;
    this.panes[dest].seriesIds.push(id);
    if (!this.panes[dest].scales.has(s.priceScaleId)) {
      this.panes[dest].scales.set(s.priceScaleId, freshScale(this.panes[dest].height));
    }
    this.structure();
  }

  removeSeries(id: number): void {
    const s = this.series.get(id);
    if (!s || s.removed) return;
    s.removed = true;
    s.markers = [];
    s.primitives = [];
    for (const pl of s.priceLines) pl.removed = true;
    const pane = this.panes[s.paneIndex];
    if (pane) pane.seriesIds = pane.seriesIds.filter((sid) => sid !== id);
    this.bump();
  }

  setSeriesData(id: number, rows: EngineSeriesRow[]): void {
    const s = this.series.get(id);
    if (!this.alive || !s || s.removed) return;
    s.rows = rows.slice();
    if (!this.rangeExplicit && this.primarySeries()?.id === id) {
      this.time.visibleFrom = 0;
      this.time.visibleTo = Math.max(1, s.rows.length);
      this.recomputeSpacing();
    }
    this.bump();
  }

  updateSeriesRow(id: number, row: EngineSeriesRow, historicalUpdate?: boolean): void {
    const s = this.series.get(id);
    if (!this.alive || !s || s.removed) return;
    const t = timeToMs(row.time);
    if (historicalUpdate) {
      const idx = s.rows.findIndex((r) => timeToMs(r.time) === t);
      if (idx >= 0) s.rows[idx] = row;
      else { s.rows.push(row); s.rows.sort((a, b) => timeToMs(a.time) - timeToMs(b.time)); }
    } else if (s.rows.length === 0) {
      s.rows.push(row);
    } else {
      const lastT = timeToMs(s.rows[s.rows.length - 1].time);
      if (t === lastT) s.rows[s.rows.length - 1] = row;
      else if (t > lastT) s.rows.push(row);
      else {
        const idx = s.rows.findIndex((r) => timeToMs(r.time) === t);
        if (idx >= 0) s.rows[idx] = row;
      }
    }
    this.bump();
  }

  inventory(): EngineInventory {
    if (!this.alive) return { alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0 };
    const seriesByPane = this.panes.map((p) => p.seriesIds.length);
    let priceLines = 0;
    for (const s of this.series.values()) {
      if (s.removed) continue;
      for (const pl of s.priceLines) if (!pl.removed) priceLines += 1;
    }
    return {
      alive: true,
      panes: this.panes.length,
      series: seriesByPane.reduce((a, b) => a + b, 0),
      seriesByPane,
      priceLines,
      watermarks: this.panes.filter((p) => p.watermark != null).length,
    };
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.crosshairHandlers.clear();
    this.clickHandlers.clear();
    this.dblClickHandlers.clear();
    this.rangeHandlers.clear();
    this.paneElementLookup = null;
    this.tsHandle = null;
  }

  createPriceLine(seriesId: number, spec: PriceLineSpec): PriceLineHandle {
    const s = this.series.get(seriesId);
    if (!this.alive || !s || s.removed) return new ModelPriceLineHandle(this, seriesId, -1);
    const id = this.nextLineId++;
    s.priceLines.push({ id, spec: { ...spec }, removed: false });
    this.bump();
    const handle = new ModelPriceLineHandle(this, seriesId, id);
    this.lineHandles.set(id, handle);
    return handle;
  }

  /** Exact logical index of `time` in the primary series; nearest when asked; future slot via the cadence seam. */
  timeToIndex(time: EngineTime, findNearest?: boolean): number | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    const target = timeToMs(time);
    if (!Number.isFinite(target)) return null;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < primary.rows.length; i++) {
      const d = Math.abs(timeToMs(primary.rows[i].time) - target);
      if (d === 0) return i;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    const fut = futureSlotResolver.resolve(time, primary.rows.map((r) => r.time));
    if (fut) return fut.logical;
    return findNearest && best >= 0 ? best : null;
  }

  /** Time at a logical index: a primary row, or a future cadence slot past the last row. */
  timeAtLogical(logical: number): EngineTime | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    const n = primary.rows.length;
    const i = Math.round(logical);
    if (i < 0) return primary.rows[0].time;
    if (i < n) return primary.rows[i].time;
    const futures = futureBarTimes(primary.rows.map((r) => asCadenceTime(r.time)));
    return futures[i - n] ?? null;
  }
}

class ModelPriceLineHandle implements PriceLineHandle {
  constructor(private readonly m: ChartModel, private readonly seriesId: number, private readonly lineId: number) {}
  private line(): PriceLineModel | null {
    if (!this.m.alive) return null;
    const s = this.m.getSeries(this.seriesId);
    return s && !s.removed ? s.priceLines.find((l) => l.id === this.lineId && !l.removed) ?? null : null;
  }
  applyOptions(opts: Partial<PriceLineSpec>): void {
    const line = this.line();
    if (!line) return;
    line.spec = { ...line.spec, ...opts };
    this.m.bump();
  }
  options(): Record<string, unknown> {
    const line = this.line();
    return line ? { ...line.spec } : {};
  }
  remove(): void {
    const s = this.m.getSeries(this.seriesId);
    const line = s?.priceLines.find((l) => l.id === this.lineId);
    if (!line || line.removed) return;
    line.removed = true;
    this.m.bump();
  }
  unwrap<T>(): T {
    const s = this.m.getSeries(this.seriesId);
    return (s?.priceLines.find((l) => l.id === this.lineId) ?? { id: this.lineId, spec: { price: 0 }, removed: true }) as unknown as T;
  }
}

class ModelSeriesHandle implements SeriesHandle {
  constructor(readonly kind: EngineSeriesKind, private readonly m: ChartModel, private readonly id: number) {}
  private live(): SeriesModel | null {
    if (!this.m.alive) return null;
    const s = this.m.getSeries(this.id);
    return s && !s.removed ? s : null;
  }
  setData(rows: EngineSeriesRow[]): void { this.m.setSeriesData(this.id, rows); }
  update(row: EngineSeriesRow, historicalUpdate?: boolean): void { this.m.updateSeriesRow(this.id, row, historicalUpdate); }
  applyOptions(opts: EngineSeriesOptions): void {
    const s = this.live();
    if (!s) return;
    Object.assign(s.options, opts);
    if (typeof opts.priceScaleId === "string") s.priceScaleId = opts.priceScaleId;
    this.m.bump();
  }
  setMarkers(marks: MarkerSpec[]): void {
    const s = this.live();
    if (!s) return;
    s.markers = marks.slice();
    this.m.bump();
  }
  options(): EngineSeriesOptions {
    const s = this.live();
    return s ? { ...s.options } : {};
  }
  data(): readonly EngineSeriesRow[] {
    const s = this.live();
    return s ? s.rows.slice() : [];
  }
  dataByIndex(logicalIndex: number, mismatchDirection: EngineMismatchDirection = "none"): EngineSeriesRow | null {
    const s = this.live();
    if (!s || s.rows.length === 0 || !Number.isFinite(logicalIndex)) return null;
    const n = s.rows.length;
    const i = Math.round(logicalIndex);
    if (i >= 0 && i < n) return s.rows[i];
    if (mismatchDirection === "nearest-left" && i >= n) return s.rows[n - 1];
    if (mismatchDirection === "nearest-right" && i < 0) return s.rows[0];
    return null;
  }
  createPriceLine(opts: PriceLineSpec): PriceLineHandle { return this.m.createPriceLine(this.id, opts); }
  removePriceLine(line: PriceLineHandle): void {
    if (!this.live()) return;
    line.remove();
  }
  priceLines(): PriceLineHandle[] {
    const s = this.live();
    if (!s) return [];
    const out: PriceLineHandle[] = [];
    for (const l of s.priceLines) {
      if (l.removed) continue;
      const h = this.m.priceLineHandle(l.id);
      if (h) out.push(h);
    }
    return out;
  }
  priceScale(): PriceScaleHandle {
    const s = this.live();
    return this.m.priceScaleHandle(s?.priceScaleId ?? "right", s?.paneIndex ?? 0);
  }
  priceToCoordinate(price: number): number | null {
    const s = this.live();
    return s ? this.m.projectionFor(s).yOfPrice(price) : null;
  }
  coordinateToPrice(y: number): number | null {
    const s = this.live();
    return s ? this.m.projectionFor(s).priceOfY(y) : null;
  }
  paneIndex(): number { return this.live()?.paneIndex ?? 0; }
  pane(): PaneHandle { return this.m.paneHandle(this.paneIndex()); }
  moveToPane(paneIndex: number): void { this.m.moveSeries(this.id, paneIndex); }
  attachPrimitive(primitive: unknown): void {
    const s = this.live();
    if (!s) return;
    s.primitives.push(primitive);
    this.m.bump();
  }
  detachPrimitive(primitive: unknown): void {
    const s = this.live();
    if (!s) return;
    s.primitives = s.primitives.filter((p) => p !== primitive);
    this.m.bump();
  }
  remove(): void { this.m.removeSeries(this.id); }
  unwrap<T>(): T {
    return (this.m.getSeries(this.id) ?? { id: this.id, kind: this.kind, removed: true }) as unknown as T;
  }
}

class ModelPaneHandle implements PaneHandle {
  constructor(private readonly m: ChartModel, private readonly idx: number) {}
  private pane(): PaneModel | null { return this.m.alive ? this.m.panes[this.idx] ?? null : null; }
  index(): number { return this.idx; }
  height(): number { return this.pane()?.height ?? 0; }
  setHeight(px: number): void {
    const p = this.pane();
    if (!p) return;
    p.height = px;
    p.stretchFactor = Math.max(1e-6, px);
    for (const scale of p.scales.values()) scale.heightPx = px;
    this.m.bump();
  }
  setStretchFactor(factor: number): void {
    const p = this.pane();
    if (!p) return;
    p.stretchFactor = factor;
    this.m.layoutHeights(this.m.totalHeight);
    this.m.structure();
  }
  stretchFactor(): number { return this.pane()?.stretchFactor ?? 0; }
  getHTMLElement(): HTMLElement | null {
    return this.m.alive ? this.m.paneElementLookup?.(this.idx) ?? null : null;
  }
  getSeries(): SeriesHandle[] {
    const p = this.pane();
    if (!p) return [];
    const out: SeriesHandle[] = [];
    for (const sid of p.seriesIds) {
      const h = this.m.seriesHandle(sid);
      if (h) out.push(h);
    }
    return out;
  }
  priceScale(priceScaleId: string): PriceScaleHandle {
    return this.m.priceScaleHandle(priceScaleId, this.idx);
  }
  unwrap<T>(): T {
    return (this.pane() ?? { index: this.idx, height: 0, stretchFactor: 0, seriesIds: [] }) as unknown as T;
  }
}

class ModelPriceScaleHandle implements PriceScaleHandle {
  constructor(private readonly m: ChartModel, private readonly id: string, private readonly paneIdx: number) {}
  width(): number { return 0; }
  applyOptions(opts: Record<string, unknown>): void {
    if (!this.m.alive) return;
    const scale = this.m.scale(this.paneIdx, this.id);
    if (typeof opts.invertScale === "boolean") scale.inverted = opts.invertScale;
    if (typeof opts.autoScale === "boolean") scale.autoScale = opts.autoScale;
    if (opts.scaleMargins && typeof opts.scaleMargins === "object") {
      const mg = opts.scaleMargins as { top?: number; bottom?: number };
      if (typeof mg.top === "number") scale.margins.top = mg.top;
      if (typeof mg.bottom === "number") scale.margins.bottom = mg.bottom;
    }
    if (opts.mode === "log" || opts.mode === 1) scale.mode = "log";
    else if (opts.mode === "percent" || opts.mode === 2) scale.mode = "percent";
    else if (opts.mode === "indexed100" || opts.mode === 3) scale.mode = "indexed100";
    this.m.bump();
  }
  options(): Record<string, unknown> {
    if (!this.m.alive) return {};
    const scale = this.m.scale(this.paneIdx, this.id);
    return {
      mode: scale.mode,
      invertScale: scale.inverted,
      autoScale: scale.autoScale,
      scaleMargins: { ...scale.margins },
    };
  }
  getVisibleRange(): EngineRange<number> | null {
    if (!this.m.alive) return null;
    const scale = this.m.autoscaleScale(this.paneIdx, this.id);
    if (!Number.isFinite(scale.from) || !Number.isFinite(scale.to)) return null;
    return { from: scale.from, to: scale.to };
  }
  setVisibleRange(range: EngineRange<number>): void {
    if (!this.m.alive) return;
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return;
    const scale = this.m.scale(this.paneIdx, this.id);
    scale.from = Math.min(range.from, range.to);
    scale.to = Math.max(range.from, range.to);
    scale.autoScale = false;
    this.m.bump();
  }
  setAutoScale(on: boolean): void {
    if (!this.m.alive) return;
    const scale = this.m.scale(this.paneIdx, this.id);
    if (scale.autoScale === on) return;
    scale.autoScale = on;
    this.m.bump();
  }
  unwrap<T>(): T { return this.m.scale(this.paneIdx, this.id) as unknown as T; }
}

class ModelTimeScaleHandle implements TimeScaleHandle {
  constructor(private readonly m: ChartModel) {}
  getVisibleLogicalRange(): EngineLogicalRange | null { return this.m.getVisibleLogicalRange(); }
  setVisibleLogicalRange(range: EngineLogicalRange): void { this.m.setVisibleLogicalRange(range); }
  subscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void { this.m.subscribeRange(handler); }
  unsubscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void { this.m.unsubscribeRange(handler); }
  timeToCoordinate(time: EngineTime): number | null { return this.m.timeToCoordinate(time); }
  coordinateToTime(x: number): EngineTime | null { return this.m.coordinateToTime(x); }
  scrollToRealtime(): void { this.m.scrollToRealtime(); }
  scrollToPosition(position: number, animated?: boolean): void { void animated; this.m.scrollToPosition(position); }
  applyOptions(opts: Record<string, unknown>): void { this.m.applyTimeScaleOptions(opts); }
  fitContent(): void { this.m.fitContent(); }
  getVisibleRange(): EngineRange<EngineTime> | null {
    const lr = this.m.getVisibleLogicalRange();
    if (!lr) return null;
    // The visible window is [from, to) in bar slots; the last visible bar is to - 1.
    const from = this.m.timeAtLogical(lr.from);
    const to = this.m.timeAtLogical(Math.max(lr.from, lr.to - 1));
    return from != null && to != null ? { from, to } : null;
  }
  setVisibleRange(range: EngineRange<EngineTime>): void {
    const from = this.m.timeToIndex(range.from, true);
    const to = this.m.timeToIndex(range.to, true);
    if (from == null || to == null) return;
    this.m.setVisibleLogicalRange({ from: Math.min(from, to), to: Math.max(from, to) + 1 });
  }
  logicalToCoordinate(logical: number): number | null {
    return this.m.alive && Number.isFinite(logical) ? this.m.xOfLogical(logical) : null;
  }
  coordinateToLogical(x: number): number | null {
    return this.m.alive && Number.isFinite(x) ? this.m.logicalOfX(x) : null;
  }
  width(): number { return this.m.alive ? this.m.time.widthPx : 0; }
  timeToIndex(time: EngineTime, findNearest?: boolean): number | null {
    return this.m.timeToIndex(time, findNearest);
  }
  options(): Record<string, unknown> {
    if (!this.m.alive) return {};
    const ts = this.m.options.timeScale;
    return {
      rightOffset: this.m.time.rightOffset,
      barSpacing: this.m.time.barSpacing,
      ...(ts && typeof ts === "object" ? (ts as Record<string, unknown>) : {}),
    };
  }
  unwrap<T>(): T { return this.m.time as unknown as T; }
}
