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
import { EPOCH_SECONDS_MAX } from "../time";
import {
  applyPriceScaleOptionBag,
  autoscaleRange,
  coercePriceScaleMode,
  coordinateToPrice as scaleCoordinateToPrice,
  priceToCoordinate as scalePriceToCoordinate,
  type PriceScaleState,
} from "./scales";
import { EngineRefusalError, assertEnginePrimitive } from "./refusal";
import {
  applyBarSpacingToWindow,
  clampBarSpacingValue,
  clampVisibleWindow,
  correctRightOffset,
  defaultModelClock,
  defaultTimeScaleBehaviour,
  lastBarIsVisible,
  linearScrollOffset,
  maxBarSpacingPx,
  mergeTimeScaleBag,
  nextScrollFrameDelayMs,
  resizeTimeScaleWidth,
  SCROLL_TO_POSITION_MS,
  SCROLL_TO_REALTIME_MS,
  type ModelClock,
  type TimeScaleBehaviour,
  type VisibleWindowClamp,
} from "./modelTime";

export type { ModelClock };
export type { PriceScaleState };

export type LogicalIndex = number;
export type TimeScaleState = {
  visibleFrom: number;
  visibleTo: number;
  barSpacing: number;
  rightOffset: number;
  widthPx: number;
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
  /** Ascending indices of valued (non-whitespace) rows; null = dirty. */
  valuedIdx?: number[] | null;
  // ── PERF-B index caches (one per series, bounded by rows.length; see
  // ensureMsKeys / maintainValuedIdx / maintainExtentsOnInPlace). Lazy: built
  // only when a lookup actually needs them, never rebuilt per tick.
  /** epoch-ms keys parallel to rows (capacity may exceed msKeyCount); null = dirty. */
  msKeys?: Float64Array | null;
  /** Valid prefix length of msKeys (== rows.length when clean). */
  msKeyCount?: number;
  /** False when keys are not strictly ascending finite — lookups fall back to the linear scan. */
  msKeysSorted?: boolean;
  /** Bumped on every rows mutation so extent caches can memo per row-content. */
  rowVersion?: number;
  /** Cached visible-slice price extents for (from, to, rowVersion); null = dirty. */
  extentsCache?: { from: number; to: number; rowVersion: number; min: number; max: number } | null;
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

/** Named seam: T02 scales.ts owns log/percent/indexed100 (and the linear fallback). */
export const priceScaleMath = {
  yOfPrice(price: number, scale: PriceScaleState): number {
    return scalePriceToCoordinate(price, scale);
  },
  priceOfY(y: number, scale: PriceScaleState): number {
    return scaleCoordinateToPrice(y, scale);
  },
  autoscale(values: number[], scale?: PriceScaleState): { from: number; to: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const extents = Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
    const state: PriceScaleState = scale ?? {
      mode: "normal",
      inverted: false,
      from: 0,
      to: 1,
      heightPx: 0,
      margins: { ...DEFAULT_SCALE_MARGINS },
    };
    const next = autoscaleRange(extents, state);
    return { from: next.from, to: next.to };
  },
};

export function timeToMs(t: EngineTime): number {
  __perfCounters.timeToMsCalls += 1;
  if (typeof t === "number") return t <= EPOCH_SECONDS_MAX ? t * 1000 : t;
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

// PERF-B: memoise the O(N) cadence map and the 200-slot future grid per data
// generation. Keyed on the times-array REFERENCE the model passes in (stable
// across in-place ticks and appends), so a custom .resolve override still sees
// the same array while the default resolve stops re-mapping per call.
const cadenceTimesMemo = new WeakMap<readonly EngineTime[], (string | number)[]>();
const futureBarsMemo = new WeakMap<readonly (string | number)[], (string | number)[]>();

function cadenceTimesOf(primaryTimes: readonly EngineTime[]): (string | number)[] {
  let times = cadenceTimesMemo.get(primaryTimes);
  if (!times) {
    times = primaryTimes.map(asCadenceTime);
    cadenceTimesMemo.set(primaryTimes, times);
  }
  return times;
}

function futureBarsOf(times: readonly (string | number)[]): (string | number)[] {
  let bars = futureBarsMemo.get(times);
  if (!bars) {
    bars = futureBarTimes(times);
    futureBarsMemo.set(times, bars);
  }
  return bars;
}

/** Named seam: replace `.resolve` to plug a different future-time cadence. */
export const futureSlotResolver: { resolve: FutureSlotResolver } = {
  resolve(time, primaryTimes) {
    if (primaryTimes.length < 2) return null;
    const times = cadenceTimesOf(primaryTimes);
    const slot = futureSlotOf(futureCadence(times), asCadenceTime(time));
    if (slot < 0) return null;
    const ft = futureBarsOf(times)[slot];
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

/** Ascending valued-row indices: the PlotList index LWC searches (dev:3015-3039). */
export function valuedIndicesOf(rows: EngineSeriesRow[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) if (seriesClose(rows[i]) != null) out.push(i);
  return out;
}

/** First position in `list` whose value is >= target (LWC lowerBound). */
function lowerBoundOf(list: number[], target: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ── PERF-B: O(log n) time lookups over a cached per-series key index ──────────

/**
 * Test-only instrumentation (documented PERF-B hook): cheap increments on the
 * hot lookup/scan paths so N-independence tests can count work. Product code
 * only ever increments; tests reset and read. Never gates behaviour.
 */
export const __perfCounters = {
  /** timeToMs() invocations (row-key conversions and query conversions). */
  timeToMsCalls: 0,
  /** Row visits spent inside a LINEAR fallback scan (disordered/NaN keys only). */
  rowsScanned: 0,
  /** Row visits spent rebuilding the valued index (allowed once per data generation). */
  valuedRowsBuilt: 0,
  /** Row visits spent in a full visible-extents rescan. */
  extentsRowsScanned: 0,
};

/** First key position with keys[i] >= target (Float64Array lowerBound). */
function lowerBoundMs(keys: Float64Array, count: number, target: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First key position with keys[i] > target (Float64Array upperBound). */
function upperBoundMs(keys: Float64Array, count: number, target: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rowVersionOf(s: SeriesModel): number {
  return s.rowVersion ?? 0;
}

function bumpRowVersion(s: SeriesModel): void {
  s.rowVersion = rowVersionOf(s) + 1;
}

/**
 * Ensure s.msKeys covers s.rows (lazy, once per data generation; an append
 * extends the tail in O(1) amortised). Keys are epoch-ms via timeToMs so
 * lookups answer in exactly the domain the previous linear scans used.
 * Disorder or a non-finite key clears msKeysSorted and every lookup falls
 * back to the original scan (correctness over speed for invalid data).
 */
function ensureMsKeys(s: SeriesModel): void {
  const n = s.rows.length;
  if (s.msKeys != null && s.msKeyCount === n) return;
  if (s.msKeys == null || s.msKeysSorted !== true || (s.msKeyCount ?? 0) > n) {
    let keys = s.msKeys;
    if (keys == null || keys.length < n) {
      let cap = Math.max(16, n);
      cap += cap >> 1; // growth headroom so appends extend in place
      keys = new Float64Array(cap);
    }
    let sorted = true;
    for (let i = 0; i < n; i++) {
      const ms = timeToMs(s.rows[i].time);
      keys[i] = ms;
      if (!Number.isFinite(ms) || (i > 0 && !(ms > keys[i - 1]))) sorted = false;
    }
    s.msKeys = keys;
    s.msKeyCount = n;
    s.msKeysSorted = sorted;
    return;
  }
  // Clean sorted prefix shorter than rows: appended rows only — extend the tail.
  let keys = s.msKeys as Float64Array;
  if (keys.length < n) {
    let cap = Math.max(16, n);
    cap += cap >> 1;
    const grown = new Float64Array(cap);
    grown.set(keys.subarray(0, s.msKeyCount ?? 0));
    keys = grown;
    s.msKeys = keys;
  }
  let sorted = s.msKeysSorted === true;
  for (let i = s.msKeyCount ?? 0; i < n; i++) {
    const ms = timeToMs(s.rows[i].time);
    keys[i] = ms;
    if (!Number.isFinite(ms) || !(ms > keys[i - 1])) sorted = false;
  }
  s.msKeyCount = n;
  s.msKeysSorted = sorted;
}

/**
 * O(log n) row lookup on the cached ms-key index, with the ORIGINAL linear
 * scan as the fallback for disordered/non-finite keys. Semantics are pinned
 * against that scan: exact = first row whose ms equals the query's;
 * nearest keeps the EARLIER row on ties; nearest-left/right as in lod.
 */
export function seriesIndexOfTime(
  s: SeriesModel,
  time: EngineTime,
  mode: "exact" | "nearest" | "nearest-left" | "nearest-right",
): number | null {
  const n = s.rows.length;
  if (n === 0) return null;
  const target = timeToMs(time);
  __perfCounters.timeToMsCalls += 1;
  if (!Number.isFinite(target)) return null;
  ensureMsKeys(s);
  if (s.msKeysSorted !== true) {
    // Fallback: the pre-PERF-B linear scan, byte-for-byte semantics.
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(timeToMs(s.rows[i].time) - target);
      if (d === 0) return i;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    __perfCounters.rowsScanned += n;
    return mode === "exact" ? null : mode === "nearest" || mode === "nearest-left" || mode === "nearest-right"
      ? best >= 0 ? best : null
      : null;
  }
  const keys = s.msKeys as Float64Array;
  if (mode === "exact") {
    const i = lowerBoundMs(keys, n, target);
    return i < n && keys[i] === target ? i : null;
  }
  if (mode === "nearest-left") {
    const i = upperBoundMs(keys, n, target) - 1;
    return i >= 0 ? i : null;
  }
  if (mode === "nearest-right") {
    const i = lowerBoundMs(keys, n, target);
    return i < n ? i : null;
  }
  const left = upperBoundMs(keys, n, target) - 1;
  const right = lowerBoundMs(keys, n, target);
  if (left < 0) return right < n ? right : null;
  if (right >= n) return left;
  return target - keys[left] <= keys[right] - target ? left : right;
}

/** Time-source view over a series for ticks.ts: no per-frame times copy. */
export type SeriesTimeSource = {
  readonly length: number;
  timeAt(i: number): EngineTime;
  /** Cached epoch-ms key at i (NaN when the row's time is malformed). */
  msAt?(i: number): number;
};

/** Cached {timeAt, msAt} accessor over s.rows — O(1) per call after ensureMsKeys. */
export function seriesTimeSource(s: SeriesModel): SeriesTimeSource {
  ensureMsKeys(s);
  const keys = s.msKeys as Float64Array;
  return {
    length: s.rows.length,
    timeAt: (i: number) => s.rows[i].time,
    msAt: keys != null ? (i: number) => keys[i] : undefined,
  };
}

/** Ensure the valued index exists (builds once per data generation). */
function ensureValuedIdx(s: SeriesModel): number[] {
  if (s.valuedIdx == null) {
    s.valuedIdx = valuedIndicesOf(s.rows);
    __perfCounters.valuedRowsBuilt += s.rows.length;
  }
  return s.valuedIdx;
}

/**
 * Maintain s.valuedIdx across a rows mutation WITHOUT a full rebuild.
 * Only the in-place last-row update and the append are O(1); a historical
 * whitespace<->valued flip (or anything else) dirties the cache and the next
 * dataByIndex rebuilds it lazily — exactly the pre-PERF-B behaviour.
 */
function maintainValuedIdx(
  s: SeriesModel,
  at: number,
  wasValued: boolean,
  isValued: boolean,
): void {
  const idx = s.valuedIdx;
  if (idx == null) return; // dirty stays dirty; lazy rebuild later
  if (wasValued && !isValued) {
    const last = idx.length - 1;
    if (last >= 0 && idx[last] === at) idx.pop();
    else s.valuedIdx = null; // interior flip: rebuild lazily
    return;
  }
  if (!wasValued && isValued) {
    const last = idx.length - 1;
    if (last >= 0 && idx[last] > at) {
      s.valuedIdx = null; // interior insertion: rebuild lazily
      return;
    }
    if (last < 0 || idx[last] !== at) idx.push(at);
  }
}

/** Finite numbers the visible-extents scan would consider for `row` (kind-aware). */
function rowExtentNumbers(s: SeriesModel, row: EngineSeriesRow): number[] {
  const out: number[] = [];
  const b = row as { open?: unknown; high?: unknown; low?: unknown; close?: unknown; value?: unknown };
  if (s.kind === "candles" || s.kind === "bars") {
    for (const k of ["high", "low", "open", "close"] as const) {
      const v = b[k];
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
  } else if (typeof b.value === "number" && Number.isFinite(b.value)) {
    out.push(b.value);
  }
  return out;
}

/**
 * O(1) incremental maintenance of the visible-extents cache across an in-place
 * last-row update. If the OLD row held (equalled) a cached extreme the min/max
 * may have been its alone, so the cache is dropped and the next read rescans
 * ONLY the visible slice; otherwise the new row's values can only extend it.
 */
function maintainExtentsOnInPlace(
  s: SeriesModel,
  window: { from: number; to: number },
  oldRow: EngineSeriesRow,
  newRow: EngineSeriesRow,
  prevVersion: number,
  index: number,
): void {
  const c = s.extentsCache;
  if (!c) return;
  if (c.rowVersion !== prevVersion) { s.extentsCache = null; return; }
  if (c.from !== window.from || c.to !== window.to) { s.extentsCache = null; return; }
  if (index < window.from || index > window.to) {
    // The mutated row is OUTSIDE the cached slice (the user is browsing history
    // while the live bar ticks): the slice is unchanged, only its version stamp
    // moves, so the O(1) live commit stays O(1) and no rescan is forced.
    s.extentsCache = { from: c.from, to: c.to, rowVersion: rowVersionOf(s), min: c.min, max: c.max };
    return;
  }
  const oldNums = rowExtentNumbers(s, oldRow);
  for (const v of oldNums) {
    if (v === c.min || v === c.max) { s.extentsCache = null; return; }
  }
  let min = c.min;
  let max = c.max;
  for (const v of rowExtentNumbers(s, newRow)) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  s.extentsCache = { from: window.from, to: window.to, rowVersion: rowVersionOf(s), min, max };
}

/** Current inclusive visible row window for a series (matches visiblePriceExtents). */
function visibleWindowFor(s: SeriesModel, time: TimeScaleState): { from: number; to: number } {
  return {
    from: Math.max(0, Math.floor(time.visibleFrom)),
    to: Math.min(s.rows.length - 1, Math.ceil(time.visibleTo)),
  };
}

/**
 * Apply the kind-specific unions (histogram base / baseline base price) to RAW
 * row extents. Applied per read so option changes take effect without touching
 * the row-scan cache; union BEFORE the finite check, exactly like the
 * pre-PERF-B single-pass scan.
 */
function finishPriceExtents(s: SeriesModel, min: number, max: number): { min: number; max: number } | null {
  if (s.kind === "histogram") {
    const raw = s.options.base;
    const base = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    if (base < min) min = base;
    if (base > max) max = base;
  } else if (s.kind === "baseline") {
    const raw = s.options.baseValue;
    const price = raw && typeof raw === "object" && typeof (raw as { price?: unknown }).price === "number"
      && Number.isFinite((raw as { price: number }).price)
      ? (raw as { price: number }).price
      : (typeof s.options.base === "number" && Number.isFinite(s.options.base) ? s.options.base : 0);
    if (price < min) min = price;
    if (price > max) max = price;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

export type ModelHooks = { onInvalidate: () => void; onStructure: () => void; clock?: ModelClock };
export type PaneElementLookup = (index: number) => HTMLElement | null;
type MouseKind = "crosshair" | "click" | "dblclick";

export class ChartModel {
  alive = true;
  generation = 0;
  dpr = 1;
  /** Per-pane CSS px width of the painted right price-axis strip (empty until the first paint). */
  priceAxisStripPx: number[] = [];
  options: EngineOptions = {};
  panes: PaneModel[] = [];
  series = new Map<number, SeriesModel>();
  seriesOrder: number[] = [];
  time: TimeScaleState = { visibleFrom: 0, visibleTo: 1, barSpacing: 1, rightOffset: 0, widthPx: 0 };
  timeScaleBehaviour: TimeScaleBehaviour = defaultTimeScaleBehaviour();
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
  private readonly clock: ModelClock;
  private scrollAnim: {
    from: number;
    to: number;
    startMs: number;
    durationMs: number;
    span: number;
    handle: unknown;
  } | null = null;
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
    this.clock = hooks.clock ?? defaultModelClock();
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

  /**
   * Clamp a requested window through the single LWC-exact choke-point
   * (modelTime.clampVisibleWindow, PERF-A C1): bar-spacing bounds first, right
   * edge kept, always-on correctOffset bounds, window derived from the clamped
   * spacing and width. An in-bounds request round-trips bitwise.
   */
  private clampWindow(from: number, to: number): VisibleWindowClamp {
    return clampVisibleWindow({
      from,
      to,
      widthPx: this.time.widthPx,
      rowCount: this.primarySeries()?.rows.length ?? 0,
      minBarSpacing: this.timeScaleBehaviour.minBarSpacing,
      maxBarSpacing: this.timeScaleBehaviour.maxBarSpacing,
      fixLeftEdge: this.timeScaleBehaviour.fixLeftEdge,
      fixRightEdge: this.timeScaleBehaviour.fixRightEdge,
      fallbackSpacing: this.time.barSpacing,
    });
  }

  private commitWindow(next: VisibleWindowClamp): void {
    this.time.visibleFrom = next.from;
    this.time.visibleTo = next.to;
    this.time.barSpacing = next.barSpacing;
    this.time.rightOffset = next.rightOffset;
  }

  /**
   * Re-derive spacing from the CURRENT window under the clamp rules. Called by
   * the setData auto-fit (sibling-owned), so the very first frame after a bulk
   * load is already O(visible): a 40k-row fit lands on minBarSpacing and shows
   * width/0.5 bars instead of walking every row (PERF-A F1).
   */
  private recomputeSpacing(): void {
    this.commitWindow(this.clampWindow(this.time.visibleFrom, this.time.visibleTo));
  }

  private syncRightOffsetFromWindow(): void {
    const n = this.primarySeries()?.rows.length ?? 0;
    this.time.rightOffset = this.time.visibleTo - n;
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
    resizeTimeScaleWidth(this.time, widthPx, this.timeScaleBehaviour.lockVisibleTimeRangeOnResize);
    // A width change moves the maxBarSpacing bound (width * 0.5 when the
    // option is 0) and the correctOffset max (width/barSpacing): re-run the
    // same clamp every other window write goes through (PERF-A C1).
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
    if (!scale.autoScale) return scale;
    let min = Infinity;
    let max = -Infinity;
    let baseValue: number | undefined;
    let baseIndex = Infinity;
    const pane = this.panes[paneIndex];
    if (pane) {
      for (const sid of pane.seriesIds) {
        const s = this.series.get(sid);
        if (!s || s.removed || s.priceScaleId !== priceScaleId) continue;
        const ext = this.visiblePriceExtents(s);
        if (ext) {
          if (ext.min < min) min = ext.min;
          if (ext.max > max) max = ext.max;
        }
        const first = this.firstVisibleClose(s);
        if (first && first.index < baseIndex) {
          baseIndex = first.index;
          baseValue = first.value;
        }
      }
    }
    if (baseValue != null) scale.baseValue = baseValue;
    const extents = Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
    const next = autoscaleRange(extents, scale);
    scale.from = next.from;
    scale.to = next.to;
    return scale;
  }

  /**
   * Kind-aware visible min/max (series.ts extentsOf: OHLC for candles/bars,
   * value for points, histogram includes `base` default 0, baseline includes
   * its base price). Inclusive indices follow LWC visibleStrictRange
   * (lwc-reference-semantics.md §1.7): [floor(visibleFrom), ceil(visibleTo)],
   * so a partially visible last bar whose slot intersects the right edge is
   * included.
   */
  visiblePriceExtents(s: SeriesModel): { min: number; max: number } | null {
    const start = Math.max(0, Math.floor(this.time.visibleFrom));
    const end = Math.min(s.rows.length - 1, Math.ceil(this.time.visibleTo));
    if (start > end) return null;
    // PERF-B: memo per (window, rowVersion). The kind unions below depend on
    // options only, so they are re-applied on every read from cached raw extents.
    const c = s.extentsCache;
    if (c && c.from === start && c.to === end && c.rowVersion === rowVersionOf(s)) {
      return finishPriceExtents(s, c.min, c.max);
    }
    let min = Infinity;
    let max = -Infinity;
    const ohlc = s.kind === "candles" || s.kind === "bars";
    for (let i = start; i <= end; i++) {
      const row = s.rows[i];
      if (!row) continue;
      if (ohlc) {
        const b = row as { open?: unknown; high?: unknown; low?: unknown; close?: unknown };
        const open = b.open;
        const high = b.high;
        const low = b.low;
        const close = b.close;
        if (typeof high === "number" && Number.isFinite(high)) { if (high < min) min = high; if (high > max) max = high; }
        if (typeof low === "number" && Number.isFinite(low)) { if (low < min) min = low; if (low > max) max = low; }
        if (typeof open === "number" && Number.isFinite(open)) { if (open < min) min = open; if (open > max) max = open; }
        if (typeof close === "number" && Number.isFinite(close)) { if (close < min) min = close; if (close > max) max = close; }
      } else if ("value" in row && typeof (row as { value: unknown }).value === "number") {
        const v = (row as { value: number }).value;
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    __perfCounters.extentsRowsScanned += end - start + 1;
    s.extentsCache = { from: start, to: end, rowVersion: rowVersionOf(s), min, max };
    return finishPriceExtents(s, min, max);
  }

  visibleValues(s: SeriesModel): number[] {
    const start = Math.max(0, Math.floor(this.time.visibleFrom));
    const end = Math.min(s.rows.length - 1, Math.ceil(this.time.visibleTo));
    const vals: number[] = [];
    for (let i = start; i <= end; i++) {
      const nums = rowNumbers(s.rows[i]);
      for (let j = 0; j < nums.length; j++) vals.push(nums[j]);
    }
    return vals;
  }

  /** First valued close at or after the visible left (LWC firstBar = NearestRight, dev:3559-3566). */
  firstVisibleClose(s: SeriesModel): { index: number; value: number } | null {
    const start = Math.max(0, Math.floor(this.time.visibleFrom));
    // PERF-B: binary over the cached valued index instead of scanning rows.
    const valued = ensureValuedIdx(s);
    const at = lowerBoundOf(valued, start);
    if (at >= valued.length) return null;
    const index = valued[at] as number;
    const v = seriesClose(s.rows[index]);
    return v != null && Number.isFinite(v) ? { index, value: v } : null;
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
    this.hydratePriceScaleGroups(this.panes[idx]);
    this.layoutHeights(this.totalHeight);
    this.structure();
    return idx;
  }

  private hydratePriceScaleGroups(pane: PaneModel): void {
    const right = this.options.rightPriceScale;
    if (right && typeof right === "object") {
      applyPriceScaleOptionBag(this.scale(pane.index, "right"), right as Record<string, unknown>);
    }
    const left = this.options.leftPriceScale;
    if (left && typeof left === "object") {
      applyPriceScaleOptionBag(this.scale(pane.index, "left"), left as Record<string, unknown>);
    }
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
    return this.alive ? this.panes.map((pane) => new ModelPaneHandle(this, pane)) : [];
  }
  paneHandle(index: number): PaneHandle {
    const pane = this.panes[index];
    if (!pane) throw new Error(`chart-engine: pane ${index} does not exist`);
    return new ModelPaneHandle(this, pane);
  }
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
    const ts = options.timeScale;
    if (ts && typeof ts === "object") {
      this.timeScaleBehaviour = mergeTimeScaleBag(this.timeScaleBehaviour, ts as Record<string, unknown>);
    }
    if (typeof options.width === "number") this.setWidth(options.width);
    if (typeof options.height === "number") this.layoutHeights(options.height);
    if (ts && typeof ts === "object") this.applyTimeScaleOptions(ts as Record<string, unknown>);
    if (options.rightPriceScale && typeof options.rightPriceScale === "object") {
      this.applyPriceScaleGroup("right", options.rightPriceScale as Record<string, unknown>);
    }
    if (options.leftPriceScale && typeof options.leftPriceScale === "object") {
      this.applyPriceScaleGroup("left", options.leftPriceScale as Record<string, unknown>);
    }
    this.bump();
  }

  private applyPriceScaleGroup(id: string, opts: Record<string, unknown>): void {
    assertPriceScaleModeSupported(opts);
    for (const pane of this.panes) applyPriceScaleOptionBag(this.scale(pane.index, id), opts);
  }

  setVisibleLogicalRange(range: EngineLogicalRange): void {
    if (!this.alive) return;
    const { from, to } = range;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (!(to - from > 0)) return;
    const next = this.clampWindow(from, to);
    if (next.from === this.time.visibleFrom && next.to === this.time.visibleTo) return;
    this.commitWindow(next);
    this.rangeExplicit = true;
    this.generation += 1;
    this.hooks.onInvalidate();
    for (const h of this.rangeHandlers) h({ from: next.from, to: next.to });
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
    // §1.6 / dev:12931-12936: indexToCoordinate(timeToIndex(t, false)) — null off-grid.
    const idx = this.timeToIndex(time, false);
    return idx == null ? null : this.xOfLogical(idx);
  }

  coordinateToTime(x: number): EngineTime | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    const i = Math.round(this.logicalOfX(x));
    if (i < 0 || i >= primary.rows.length) return null;
    return primary.rows[i].time;
  }

  fitContent(): void {
    if (!this.alive) return;
    const n = this.primarySeries()?.rows.length ?? 0;
    // LWC _internal_fitContent (dev:6404-6413): setVisibleRange(first,
    // last + options.rightOffset, applyDefaultOffset=true). In this model's
    // exclusive convention that is {0, n + rightOffset}; the clamp then lands
    // the spacing at its bound and keeps the requested right edge (dev:6393).
    if (n <= 0) return;
    this.setVisibleLogicalRange({ from: 0, to: n + this.timeScaleBehaviour.rightOffset });
  }
  scrollToRealtime(): void {
    if (!this.alive) return;
    // LWC dev:6347-6350: scrollToOffsetAnimated(timeScaleBehaviour.rightOffset) over 400 ms.
    // Targeting the live rightOffset made this a no-op after any pan.
    this.scrollToPosition(this.timeScaleBehaviour.rightOffset, true, SCROLL_TO_REALTIME_MS);
  }
  private applyRightOffsetNow(position: number, spanOverride?: number): void {
    const n = this.primarySeries()?.rows.length ?? 0;
    const span = spanOverride != null && spanOverride > 0
      ? spanOverride
      : (this.time.visibleTo - this.time.visibleFrom);
    const width = span > 0 ? span : Math.max(1, n);
    this.time.rightOffset = position;
    this.timeScaleBehaviour.rightOffset = position;
    this.setVisibleLogicalRange({ from: n - width + position, to: n + position });
  }

  private cancelScrollAnim(): void {
    if (!this.scrollAnim) return;
    this.clock.cancel(this.scrollAnim.handle);
    this.scrollAnim = null;
  }

  scrollToPosition(position: number, animated = false, durationMs: number = SCROLL_TO_POSITION_MS): void {
    if (!this.alive) return;
    const n = this.primarySeries()?.rows.length ?? 0;
    const clamped = correctRightOffset(
      position,
      n,
      this.time.widthPx,
      this.time.barSpacing,
      this.timeScaleBehaviour.fixLeftEdge,
      this.timeScaleBehaviour.fixRightEdge,
    );
    this.cancelScrollAnim();
    if (!animated) {
      this.applyRightOffsetNow(clamped);
      return;
    }
    const from = this.time.rightOffset;
    const span = this.time.visibleTo - this.time.visibleFrom;
    const tick = (): void => {
      if (!this.alive || !this.scrollAnim) return;
      const elapsed = this.clock.now() - this.scrollAnim.startMs;
      this.applyRightOffsetNow(
        linearScrollOffset(this.scrollAnim.from, this.scrollAnim.to, elapsed, this.scrollAnim.durationMs),
        this.scrollAnim.span,
      );
      const delay = nextScrollFrameDelayMs(elapsed, this.scrollAnim.durationMs);
      if (delay == null) {
        this.scrollAnim = null;
        return;
      }
      this.scrollAnim.handle = this.clock.schedule(tick, delay);
    };
    this.scrollAnim = {
      from,
      to: clamped,
      startMs: this.clock.now(),
      durationMs,
      span,
      handle: null,
    };
    this.scrollAnim.handle = this.clock.schedule(tick, 0);
  }
  applyTimeScaleOptions(opts: Record<string, unknown>): void {
    if (!this.alive) return;
    this.timeScaleBehaviour = mergeTimeScaleBag(this.timeScaleBehaviour, opts);
    const n = this.primarySeries()?.rows.length ?? 0;
    const minS = this.timeScaleBehaviour.minBarSpacing;
    const maxS = maxBarSpacingPx(this.timeScaleBehaviour.maxBarSpacing, this.time.widthPx, minS);
    const spacingTouched =
      opts.barSpacing !== undefined || opts.minBarSpacing !== undefined || opts.maxBarSpacing !== undefined;
    if (spacingTouched) {
      const raw = typeof opts.barSpacing === "number" ? opts.barSpacing : this.time.barSpacing;
      const clamped = clampBarSpacingValue(raw, minS, maxS);
      applyBarSpacingToWindow(this.time, clamped, this.timeScaleBehaviour.rightBarStaysOnScroll);
      // Re-run the full clamp so min/max changes and the always-on offset
      // bounds apply to the resulting window (PERF-A C1).
      this.recomputeSpacing();
      this.syncRightOffsetFromWindow();
    }
    const offsetTouched = opts.rightOffset !== undefined || opts.fixLeftEdge !== undefined || opts.fixRightEdge !== undefined;
    if (offsetTouched) {
      const raw = typeof opts.rightOffset === "number" ? opts.rightOffset : this.time.rightOffset;
      // Always-on correctOffset bounds (dev:6574-6603) via the shared
      // choke-point govern the LIVE window. The option slot keeps the legacy
      // fix-flag clamp (C02 / F-11 pin): fixRightEdge floors the stored option
      // at 0, fixLeftEdge raises it to barsEstimation - n.
      const span = this.time.visibleTo - this.time.visibleFrom;
      const target = n + raw;
      this.commitWindow(this.clampWindow(target - span, target));
      this.timeScaleBehaviour.rightOffset = correctRightOffset(
        raw,
        n,
        this.time.widthPx,
        this.time.barSpacing,
        this.timeScaleBehaviour.fixLeftEdge,
        this.timeScaleBehaviour.fixRightEdge,
      );
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
    // PERF-B: a new data generation invalidates every per-series cache.
    s.valuedIdx = null;
    s.msKeys = null;
    s.msKeyCount = 0;
    s.msKeysSorted = false;
    s.extentsCache = null;
    this.primaryTimesCache = null;
    bumpRowVersion(s);
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
      // PERF-B: O(log n) via the key index (same first-equal-on-ms semantics as
      // the previous findIndex); disordered keys fall back to the same scan.
      let idx = -1;
      if (s.rows.length > 0) {
        ensureMsKeys(s);
        if (s.msKeysSorted === true && Number.isFinite(t)) {
          const keys = s.msKeys as Float64Array;
          const at = lowerBoundMs(keys, s.rows.length, t);
          if (at < s.rows.length && keys[at] === t) idx = at;
        } else {
          idx = s.rows.findIndex((r) => timeToMs(r.time) === t);
          __perfCounters.rowsScanned += s.rows.length;
        }
      }
      if (idx < 0) {
        throw new Error("Cannot update non-existing data point when historicalUpdate is true");
      }
      const wasValued = seriesClose(s.rows[idx]) != null;
      const prevTime = s.rows[idx].time;
      s.rows[idx] = row;
      // An in-row time swap is impossible here (idx matched on ms equality), so
      // the key index stays valid; only a whitespace<->valued flip dirties it.
      const isValued = seriesClose(row) != null;
      if (wasValued !== isValued) s.valuedIdx = null;
      if (prevTime !== row.time) this.primaryTimesCache = null;
      bumpRowVersion(s);
      s.extentsCache = null; // interior row replaced: conservative full rescan of the visible slice
    } else if (s.rows.length === 0) {
      s.rows.push(row);
      if (seriesClose(row) != null) maintainValuedIdx(s, 0, false, true);
      s.msKeys = null; // lazily rebuilt (single push is O(1) anyway)
      s.extentsCache = null;
      bumpRowVersion(s);
    } else {
      const last = s.rows[s.rows.length - 1];
      const lastT = timeToMs(last.time);
      if (t < lastT) {
        throw new Error(`Cannot update oldest data, last time=${String(last.time)}, new time=${String(row.time)}`);
      }
      if (t === lastT) {
        // LIVE TICK: O(1) amortised — no index rebuild, extents maintained in place.
        const wasValued = seriesClose(last) != null;
        const windowBefore = visibleWindowFor(s, this.time);
        s.rows[s.rows.length - 1] = row;
        // An equal-ms time with a different representation can change how the
        // future cadence renders (`typeof last === "number"`), so drop the
        // snapshot; it rebuilds lazily on the next future-slot request.
        if (last.time !== row.time) this.primaryTimesCache = null;
        const prevVersion = rowVersionOf(s);
        bumpRowVersion(s);
        maintainValuedIdx(s, s.rows.length - 1, wasValued, seriesClose(row) != null);
        maintainExtentsOnInPlace(s, windowBefore, last, row, prevVersion, s.rows.length - 1);
      } else {
        const nBefore = s.rows.length;
        const follow = this.primarySeries()?.id === id
          && lastBarIsVisible(this.time.visibleFrom, this.time.visibleTo, nBefore);
        s.rows.push(row);
        if (follow) {
          if (this.timeScaleBehaviour.shiftVisibleRangeOnNewBar) {
            this.time.visibleFrom += 1;
            this.time.visibleTo += 1;
          } else {
            this.time.rightOffset -= 1;
          }
        }
        // PERF-B: extend a CLEAN key index tail in O(1) amortised; a dirty one
        // stays dirty (rebuilt lazily on the next lookup, never per tick).
        if (s.msKeys != null && s.msKeysSorted === true && (s.msKeyCount ?? 0) === nBefore) {
          let keys = s.msKeys;
          if (keys.length <= nBefore) {
            let cap = Math.max(16, s.rows.length);
            cap += cap >> 1;
            const grown = new Float64Array(cap);
            grown.set(keys.subarray(0, nBefore));
            keys = grown;
            s.msKeys = grown;
          }
          keys[nBefore] = t;
          if (!(t > keys[nBefore - 1])) s.msKeysSorted = false;
          s.msKeyCount = s.rows.length;
        }
        if (seriesClose(row) != null) maintainValuedIdx(s, nBefore, false, true);
        bumpRowVersion(s);
        // Window may shift (shiftVisibleRangeOnNewBar) — drop rather than risk a
        // stale min/max; the next read rescans ONLY the visible slice.
        s.extentsCache = null;
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
    this.cancelScrollAnim();
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

  /**
   * Exact logical index of `time` on the primary series (dev:6037-6053).
   * Off-grid — including future times — is null unless findNearest.
   * PERF-B: O(log n) via the cached ms-key index (semantics pinned by the
   * pre-change scan: first exact ms match; nearest keeps the earlier row).
   */
  timeToIndex(time: EngineTime, findNearest?: boolean): number | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    return seriesIndexOfTime(primary, time, findNearest ? "nearest" : "exact");
  }

  /** Time at a logical index on the primary series. Out-of-range logicals clamp to the first/last row (no future leak). */
  timeAtLogical(logical: number): EngineTime | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length === 0) return null;
    const n = primary.rows.length;
    const i = Math.round(logical);
    if (i < 0) return primary.rows[0].time;
    if (i >= n) return primary.rows[n - 1].time;
    return primary.rows[i].time;
  }

  /** True iff round-to-nearest-bar logical lands on an existing primary-series row. */
  hasBarAtLogical(logical: number): boolean {
    if (!this.alive || !Number.isFinite(logical)) return false;
    const primary = this.primarySeries();
    if (!primary) return false;
    const i = Math.round(logical);
    return i >= 0 && i < primary.rows.length;
  }

  /** Drawing-only: logical index of a synthetic future slot, or null when `time` is not past the last bar. */
  futureSlotLogical(time: EngineTime): number | null {
    if (!this.alive) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length < 2) return null;
    return futureSlotResolver.resolve(time, this.primaryTimesSnapshot(primary))?.logical ?? null;
  }

  /** Drawing-only: time of a synthetic future slot at `logical`, or null when that slot is a real bar. */
  logicalToFutureTime(logical: number): EngineTime | null {
    if (!this.alive || !Number.isFinite(logical)) return null;
    const primary = this.primarySeries();
    if (!primary || primary.rows.length < 2) return null;
    const n = primary.rows.length;
    const i = Math.round(logical);
    if (i < n) return null;
    return futureBarsOf(cadenceTimesOf(this.primaryTimesSnapshot(primary)))[i - n] ?? null;
  }

  /**
   * PERF-B: stable times-array snapshot of the primary rows, cached per data
   * generation (rows-array identity + length). In-place ticks hit; appends
   * extend the tail lazily; setData rebuilds. The stable reference is what
   * makes the cadence/futures WeakMap memos in futureSlotResolver hit.
   */
  private primaryTimesCache: { rowsRef: EngineSeriesRow[]; n: number; times: EngineTime[] } | null = null;

  private primaryTimesSnapshot(primary: SeriesModel): EngineTime[] {
    const n = primary.rows.length;
    const c = this.primaryTimesCache;
    if (c && c.rowsRef === primary.rows) {
      if (c.n === n) return c.times;
      // Same rows array, more rows (append): extend the tail in place.
      for (let i = c.n; i < n; i++) c.times.push(primary.rows[i].time);
      c.n = n;
      return c.times;
    }
    const times = primary.rows.map((r) => r.time);
    this.primaryTimesCache = { rowsRef: primary.rows, n, times };
    return times;
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
    // LWC searches the valued PlotList (dev:3015-3039, dev:13128-13136): a
    // whitespace index is a miss, and nearest-left/right skip whitespace rows.
    // Mirror that over the valued subset of s.rows. The default direction
    // preserves the canvas precedent of rounding non-integer logicals to the
    // nearest integer (P-1: chartEngineCanvasC02.test.ts:105 pins this).
    const valuedAt = ensureValuedIdx(s);
    const n = valuedAt.length;
    if (n === 0) return null;
    const lo = lowerBoundOf(valuedAt, logicalIndex);
    const hit = lo < n && (valuedAt[lo] as number) === logicalIndex ? (valuedAt[lo] as number) : -1;
    if (mismatchDirection === "nearest-left") {
      if (hit >= 0) return s.rows[hit] as EngineSeriesRow;
      return lo > 0 ? (s.rows[valuedAt[lo - 1] as number] as EngineSeriesRow) : null;
    }
    if (mismatchDirection === "nearest-right") {
      if (hit >= 0) return s.rows[hit] as EngineSeriesRow;
      return lo < n ? (s.rows[valuedAt[lo] as number] as EngineSeriesRow) : null;
    }
    const rounded = Math.round(logicalIndex);
    const at = lowerBoundOf(valuedAt, rounded);
    return at < n && (valuedAt[at] as number) === rounded ? (s.rows[rounded] as EngineSeriesRow) : null;
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
    assertEnginePrimitive(primitive);
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
  // A PaneHandle denotes ONE pane for its lifetime. We hold the PaneModel object
  // directly (ChartModel.swapPanes moves the same PaneModel between slots), so
  // every method keeps acting on that same pane across reorders.
  //
  // Disposal ladder (mirrors LwcPaneHandle):
  //   • engine destroyed  → quiet no-op (C02 "disposed"; matches the prior
  //                          baseline of `m.panes[idx] ?? null`)
  //   • pane removed but  → throw the existing "no longer exists" error
  //     engine alive         (the orchestrator's binding; tests pin it).
  constructor(private readonly m: ChartModel, private readonly pane: PaneModel) {}
  private resolve(): PaneModel | null {
    if (!this.m.alive) return null;
    const i = this.m.panes.indexOf(this.pane);
    return i === -1 ? null : this.pane;
  }
  private require(): PaneModel {
    if (!this.m.alive) {
      throw new Error(`chart-engine: pane ${this.pane.index} no longer exists`);
    }
    const i = this.m.panes.indexOf(this.pane);
    if (i === -1) {
      throw new Error(`chart-engine: pane ${this.pane.index} no longer exists`);
    }
    return this.pane;
  }
  index(): number {
    // Disposed: return -1 to mirror LwcPaneHandle. A live pane that's been
    // removed also returns -1 (the underlying PaneModel is no longer in the
    // chart's array). The acting methods distinguish disposed (no-op) from
    // removed-alive (throw) via `this.m.alive`.
    if (!this.m.alive) return -1;
    return this.m.panes.indexOf(this.pane);
  }
  height(): number { return this.resolve()?.height ?? 0; }
  setHeight(px: number): void {
    const p = this.resolve();
    if (!p) return;
    p.height = px;
    p.stretchFactor = Math.max(1e-6, px);
    for (const scale of p.scales.values()) scale.heightPx = px;
    this.m.bump();
  }
  setStretchFactor(factor: number): void {
    const p = this.resolve();
    if (!p) return;
    p.stretchFactor = factor;
    this.m.layoutHeights(this.m.totalHeight);
    this.m.structure();
  }
  stretchFactor(): number { return this.resolve()?.stretchFactor ?? 0; }
  getHTMLElement(): HTMLElement | null {
    if (!this.m.alive) return null;
    const i = this.m.panes.indexOf(this.pane);
    if (i === -1) return null;
    return this.m.paneElementLookup?.(i) ?? null;
  }
  getSeries(): SeriesHandle[] {
    const p = this.resolve();
    if (!p) return [];
    const out: SeriesHandle[] = [];
    for (const sid of p.seriesIds) {
      const h = this.m.seriesHandle(sid);
      if (h) out.push(h);
    }
    return out;
  }
  priceScale(priceScaleId: string): PriceScaleHandle {
    // priceScaleHandle needs the pane's CURRENT index — not the snapshot in
    // this.pane.index (which only updates after a layout pass). Resolve live.
    const i = this.index();
    return this.m.priceScaleHandle(priceScaleId, i === -1 ? 0 : i);
  }
  unwrap<T>(): T {
    return this.pane as unknown as T;
  }
}

/**
 * ONE option gate also covers the scale handle: an `mode` the renderer cannot
 * coerce is a typed refusal, never a silent no-op (PAINT2-rev F4). The token and
 * the reason string mirror options.ts:79-88 / :109-115 so both paths answer alike.
 */
function assertPriceScaleModeSupported(opts: Record<string, unknown>): void {
  if (!("mode" in opts) || opts.mode === undefined) return;
  if (coercePriceScaleMode(opts.mode) !== undefined) return;
  const token = `priceScaleMode:${String(opts.mode)}`;
  throw new EngineRefusalError(`unsupported option groups: ${token}`, [token]);
}

/**
 * The price scale a pane actually DISPLAYS. ChartPanel's scaleLeft hides "right" and shows
 * "left" and moves the price series with it (ChartPanel.tsx:9735-9736), so paint and gestures
 * must resolve the SAME id or the axis the user sees is not the axis the user drags.
 */
export function displayedPriceScaleId(model: ChartModel): string {
  const opts = model.options as {
    leftPriceScale?: { visible?: boolean };
    rightPriceScale?: { visible?: boolean };
  };
  if (opts.leftPriceScale?.visible === true && opts.rightPriceScale?.visible === false) return "left";
  return "right";
}

class ModelPriceScaleHandle implements PriceScaleHandle {
  constructor(private readonly m: ChartModel, private readonly id: string, private readonly paneIdx: number) {}
  width(): number { return 0; }
  applyOptions(opts: Record<string, unknown>): void {
    if (!this.m.alive) return;
    assertPriceScaleModeSupported(opts);
    applyPriceScaleOptionBag(this.m.scale(this.paneIdx, this.id), opts);
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
  scrollToPosition(position: number, animated?: boolean): void { this.m.scrollToPosition(position, animated === true); }
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
    return {
      ...this.m.timeScaleBehaviour,
      barSpacing: this.m.time.barSpacing,
    };
  }
  unwrap<T>(): T { return this.m.time as unknown as T; }
}
