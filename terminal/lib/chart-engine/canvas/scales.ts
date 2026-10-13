// Native chart-engine scale math (P3 canvas renderer).
//
// Price and time projection for the Canvas2D implementation of api.ts. Pure
// functions: a PriceScaleState / TimeScaleState in, coordinates or a next state
// out. Logarithmic conversion and wheel-zoom compounding are delegated to
// axisZoom.ts so this module never re-derives those formulas.
//
// Coordinate convention (mirrors LWC, documented for sibling lanes):
//   x = (i - visibleFrom + 0.5) * barSpacing
//   barSpacing = widthPx / (visibleTo - visibleFrom)
//   y grows downward; price→y uses PriceScaleState.margins via the inverse of
//   axisValueAtCoordinate (top of the internal band → `to`, bottom → `from`).
//
// from/to live in the DISPLAY domain of the mode: prices for normal and log
// (log is a mapping, labels stay in price), percent for percent, indexed-to-100
// units for indexed100. percent / indexed100 are relative to baseValue (the
// first visible series value, matching LWC).

import {
  axisLogFormulaForRange,
  axisLogToPrice,
  axisPriceToLog,
  axisValueAtCoordinate,
  wheelDeltaToZoomFactor,
  zoomAxisRange,
  type AxisLogFormula,
  type AxisMargins,
  type AxisRange,
} from "../axisZoom";
import { clampBarSpacingValue } from "./modelTime";
import type { EnginePriceScaleMode } from "../options";

/** Fractional bar index; 0 = first row of the primary series. */
export type LogicalIndex = number;

export type PriceScaleMode = EnginePriceScaleMode;

export type PriceScaleState = {
  mode: PriceScaleMode;
  inverted: boolean;
  /** Display-domain low (price for normal/log, % for percent, indexed units for indexed100). */
  from: number;
  /** Display-domain high. Must be > from for a usable scale. */
  to: number;
  heightPx: number;
  margins: { top: number; bottom: number };
  /** First visible series value; percent and indexed100 are relative to this. */
  baseValue?: number;
  /** When true, autoscaleRange rewrites from/to from visible extents. */
  autoScale?: boolean;
};

/**
 * Accept the contract strings and LWC's numeric PriceScaleMode
 * (0 Normal, 1 Log, 2 Percent, 3 IndexedTo100 — dev:12328 / types PriceScaleMode).
 */
export function coercePriceScaleMode(mode: unknown): PriceScaleMode | undefined {
  if (mode === "normal" || mode === 0) return "normal";
  if (mode === "log" || mode === 1) return "log";
  if (mode === "percent" || mode === 2) return "percent";
  if (mode === "indexed100" || mode === 3) return "indexed100";
  return undefined;
}

/** Merge a price-scale option bag (mode / invertScale / autoScale / scaleMargins) into state. */
export function applyPriceScaleOptionBag(state: PriceScaleState, opts: Record<string, unknown>): void {
  const mode = coercePriceScaleMode(opts.mode);
  if (mode !== undefined) state.mode = mode;
  if (typeof opts.invertScale === "boolean") state.inverted = opts.invertScale;
  if (typeof opts.autoScale === "boolean") state.autoScale = opts.autoScale;
  if (opts.scaleMargins && typeof opts.scaleMargins === "object") {
    const mg = opts.scaleMargins as { top?: number; bottom?: number };
    if (typeof mg.top === "number" && Number.isFinite(mg.top)) state.margins.top = mg.top;
    if (typeof mg.bottom === "number" && Number.isFinite(mg.bottom)) state.margins.bottom = mg.bottom;
  }
}

export type TimeScaleState = {
  visibleFrom: number;
  visibleTo: number;
  barSpacing: number;
  rightOffset: number;
  widthPx: number;
};

export type PriceExtents = { min: number; max: number };

export type AutoscaleOptions = {
  /** Minimum price increment; used as the floor on degenerate padding. */
  minMove?: number;
  /** A price that must remain inside the autoscaled range (e.g. 0 for an oscillator). */
  lockTo?: number;
};

export type AutoscaleResult = {
  from: number;
  to: number;
  /** True when extents were unusable; from/to are the last valid range. */
  unavailable?: boolean;
};

export type LogicalRangeOptions = {
  /** Primary-series row count; used to clamp visibleFrom against the right edge. */
  rowCount?: number;
  /** Inclusive floor on bar width in CSS px. */
  minBarSpacing?: number;
  /** Inclusive ceiling on bar width in CSS px. */
  maxBarSpacing?: number;
};

/**
 * Tightest allowed bar spacing. Below 0.5 CSS px a bar is sub-pixel and
 * pan/zoom anchors become unstable. Matches LWC's default minBarSpacing.
 */
export const MIN_BAR_SPACING = 0.5;

/**
 * Default widest bar spacing. A single bar then occupies 50 CSS px. LWC's
 * default max is half the pane width (maxBarSpacing: 0 → width/2); the native
 * engine uses this fixed cap so zoom-in cannot blow a bar up to the full pane.
 */
export const MAX_BAR_SPACING = 50;

/**
 * Degenerate autoscale pad as a fraction of |v|. A constant series at v
 * becomes [v - max(|v| * 0.005, minMove), v + ...].
 */
export const AUTOSCALE_PAD_RATIO = 0.005;

const FALLBACK_RANGE: AxisRange = { from: -0.5, to: 0.5 };

function finiteNumber(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

/**
 * LWC divides by the base verbatim, so base 0 yields Infinity/NaN and the
 * scale goes empty (dev:4192, dev:5055-5057). We deliberately substitute 1
 * to keep the scale finite and the round-trip invertible; documented
 * deviation, pinned by chartEngineCanvasPatch3Model.test.ts F-6.
 */
function usableBase(baseValue: number | undefined): number {
  const base = finiteNumber(baseValue, 1);
  return base === 0 ? 1 : base;
}

function finiteRange(from: number, to: number): AxisRange {
  if (Number.isFinite(from) && Number.isFinite(to) && to !== from) {
    return from < to ? { from, to } : { from: to, to: from };
  }
  return { ...FALLBACK_RANGE };
}

function logFormulaOf(state: PriceScaleState): AxisLogFormula {
  return axisLogFormulaForRange({ from: state.from, to: state.to });
}

/** Convert a raw price into the scale's display domain. */
export function priceToDisplay(price: number, state: PriceScaleState): number {
  if (!Number.isFinite(price)) return NaN;
  switch (state.mode) {
    case "log":
      return axisPriceToLog(price, logFormulaOf(state));
    case "percent": {
      const base = usableBase(state.baseValue);
      // LWC dev:4191-4194: a negative base flips the sign so the series stays
      // upright on screen (dossier:278-281). Without this, an oscillator or
      // a below-zero spread renders upside down.
      const result = 100 * (price - base) / base;
      return base < 0 ? -result : result;
    }
    case "indexed100": {
      const base = usableBase(state.baseValue);
      // LWC dev:4207-4210: same sign-flip rule as percent for negative base.
      const result = 100 * (price - base) / base + 100;
      return base < 0 ? -result : result;
    }
    default:
      return price;
  }
}

/** Inverse of priceToDisplay. */
export function displayToPrice(display: number, state: PriceScaleState): number {
  if (!Number.isFinite(display)) return NaN;
  switch (state.mode) {
    case "log":
      return axisLogToPrice(display, logFormulaOf(state));
    case "percent": {
      const base = usableBase(state.baseValue);
      // LWC dev:4185-4189: mirror the sign-flip when base < 0.
      const value = base < 0 ? -display : display;
      return (value / 100) * base + base;
    }
    case "indexed100": {
      const base = usableBase(state.baseValue);
      // LWC dev:4200-4205: index base is 100, so the offset flips with base.
      let value = display - 100;
      if (base < 0) value = -value;
      return (value / 100) * base + base;
    }
    default:
      return display;
  }
}

/** Visible range in the linear mapping domain (log-space when mode is log). */
export function displayRangeOf(state: PriceScaleState): AxisRange {
  if (state.mode === "log") {
    const formula = logFormulaOf(state);
    return {
      from: axisPriceToLog(state.from, formula),
      to: axisPriceToLog(state.to, formula),
    };
  }
  return { from: state.from, to: state.to };
}

/**
 * Inverse of axisValueAtCoordinate without the [0, height-1] clamp, so prices
 * slightly outside the window still round-trip. In-range y matches the helper.
 */
export function coordinateOfDisplay(display: number, state: PriceScaleState): number {
  const range = displayRangeOf(state);
  const { from, to } = range;
  const height = state.heightPx;
  const margins: AxisMargins = state.margins;
  if (
    ![from, to, display, height, margins.top, margins.bottom].every(Number.isFinite)
    || to === from
    || height <= 1
  ) {
    return height / 2;
  }
  const topPx = margins.top * height;
  const bottomPx = margins.bottom * height;
  const internalHeight = height - topPx - bottomPx;
  if (internalHeight <= 1) return height / 2;
  const ratio = (display - from) / (to - from);
  const inverseCoordinate = bottomPx + ratio * (internalHeight - 1);
  return state.inverted ? inverseCoordinate : height - 1 - inverseCoordinate;
}

function displayAtCoordinate(y: number, state: PriceScaleState): number {
  const range = displayRangeOf(state);
  const height = state.heightPx;
  const margins = state.margins;
  if (
    ![range.from, range.to, y, height, margins.top, margins.bottom].every(Number.isFinite)
    || range.to <= range.from
    || height <= 1
  ) {
    return (range.from + range.to) / 2;
  }
  const topPx = margins.top * height;
  const bottomPx = margins.bottom * height;
  const internalHeight = height - topPx - bottomPx;
  if (internalHeight <= 1) return (range.from + range.to) / 2;
  // axisValueAtCoordinate clamps y to [0, height-1]. Round-trip of in-range
  // prices stays inside that band; out-of-band y uses the unclamped twin so
  // priceToCoordinate remains invertible.
  if (y >= 0 && y <= height - 1) {
    return axisValueAtCoordinate(range, y, height, margins, state.inverted);
  }
  const inverseCoordinate = state.inverted ? y : height - 1 - y;
  const ratio = (inverseCoordinate - bottomPx) / (internalHeight - 1);
  return range.from + (range.to - range.from) * ratio;
}

export function priceToCoordinate(price: number, state: PriceScaleState): number {
  return coordinateOfDisplay(priceToDisplay(price, state), state);
}

export function coordinateToPrice(y: number, state: PriceScaleState): number {
  return displayToPrice(displayAtCoordinate(y, state), state);
}

function padConstant(v: number, minMove: number): { min: number; max: number } {
  let pad = Math.max(Math.abs(v) * AUTOSCALE_PAD_RATIO, minMove);
  if (!(pad > 0) || !Number.isFinite(pad)) pad = 1;
  return { min: v - pad, max: v + pad };
}

/**
 * Next from/to for the data extents. Margins are honoured by the coordinate
 * mapping (they shrink the drawable band); the returned range is the data
 * window in the mode's display domain so min/max sit on the internal edges.
 *
 * Degenerate inputs never yield NaN:
 *   null / non-finite extents → { unavailable: true } and the last valid range
 *   min == max (single bar, all-equal) → [v ± max(|v| * 0.005, minMove)]
 */
export function autoscaleRange(
  extents: PriceExtents | null,
  state: PriceScaleState,
  options: AutoscaleOptions = {},
): AutoscaleResult {
  const kept = finiteRange(state.from, state.to);
  if (
    extents == null
    || !Number.isFinite(extents.min)
    || !Number.isFinite(extents.max)
  ) {
    return { from: kept.from, to: kept.to, unavailable: true };
  }

  let minP = Math.min(extents.min, extents.max);
  let maxP = Math.max(extents.min, extents.max);
  if (options.lockTo != null && Number.isFinite(options.lockTo)) {
    minP = Math.min(minP, options.lockTo);
    maxP = Math.max(maxP, options.lockTo);
  }

  const minMove = options.minMove != null && Number.isFinite(options.minMove)
    ? Math.abs(options.minMove)
    : 0;

  if (minP === maxP) {
    const padded = padConstant(minP, minMove);
    minP = padded.min;
    maxP = padded.max;
  }

  let from: number;
  let to: number;
  if (state.mode === "percent" || state.mode === "indexed100") {
    from = priceToDisplay(minP, state);
    to = priceToDisplay(maxP, state);
  } else {
    from = minP;
    to = maxP;
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { from: kept.from, to: kept.to, unavailable: true };
  }
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (from === to) {
    const padded = padConstant(from, minMove);
    from = padded.min;
    to = padded.max;
  }
  return { from, to };
}

function applyDisplayRange(state: PriceScaleState, range: AxisRange): PriceScaleState {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to === range.from) {
    return state;
  }
  if (state.mode === "log") {
    const formula = logFormulaOf(state);
    const from = axisLogToPrice(range.from, formula);
    const to = axisLogToPrice(range.to, formula);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return state;
    return { ...state, from, to };
  }
  return { ...state, from: range.from, to: range.to };
}

/**
 * Wheel-zoom the price scale around the display value under anchorY.
 * Uses wheelDeltaToZoomFactor + zoomAxisRange so equal-and-opposite deltas
 * restore the baseline (T02-A04). Log zooms in log-space.
 */
export function zoomPriceRange(
  state: PriceScaleState,
  anchorY: number,
  wheelDelta: number,
  deltaMode: number,
): PriceScaleState {
  const factor = wheelDeltaToZoomFactor(wheelDelta, deltaMode);
  const range = displayRangeOf(state);
  if (!(range.to > range.from)) return state;
  const anchor = displayAtCoordinate(anchorY, state);
  return applyDisplayRange(state, zoomAxisRange(range, anchor, factor));
}

/** Translate the price window by dyPx (positive = content moves down). */
export function panPriceRange(state: PriceScaleState, dyPx: number): PriceScaleState {
  if (!Number.isFinite(dyPx) || dyPx === 0) return state;
  const range = displayRangeOf(state);
  const height = state.heightPx;
  const topPx = state.margins.top * height;
  const bottomPx = state.margins.bottom * height;
  const internalHeight = height - topPx - bottomPx;
  if (!(range.to > range.from) || internalHeight <= 1) return state;
  const invShift = state.inverted ? -dyPx : dyPx;
  const delta = (range.to - range.from) * invShift / (internalHeight - 1);
  if (!Number.isFinite(delta)) return state;
  return applyDisplayRange(state, { from: range.from + delta, to: range.to + delta });
}

export function barSpacingOf(state: TimeScaleState): number {
  const span = state.visibleTo - state.visibleFrom;
  if (state.widthPx > 0 && span > 0) return state.widthPx / span;
  if (state.barSpacing > 0 && Number.isFinite(state.barSpacing)) return state.barSpacing;
  return 1;
}

/** x of the centre of the bar at logical index i. */
export function xOfLogical(index: number, state: TimeScaleState): number {
  return (index - state.visibleFrom + 0.5) * barSpacingOf(state);
}

/** Inverse of xOfLogical. */
export function logicalOfX(x: number, state: TimeScaleState): number {
  return state.visibleFrom + x / barSpacingOf(state) - 0.5;
}

function clampBarSpacing(spacing: number, minSpacing: number, maxSpacing: number): number {
  // PERF-A F6: delegate to the single modelTime clamp so every spacing bound
  // in canvas/ has one source (identical semantics to the former local body).
  return clampBarSpacingValue(spacing, minSpacing, maxSpacing);
}

function clampLogicalWindow(
  visibleFrom: number,
  visibleTo: number,
  state: TimeScaleState,
  rowCount: number | undefined,
): { visibleFrom: number; visibleTo: number } {
  const span = visibleTo - visibleFrom;
  if (!(span > 0)) return { visibleFrom: state.visibleFrom, visibleTo: state.visibleTo };
  let from = visibleFrom;
  let to = visibleTo;
  // Never let the right edge sit left of logical 0 (all data is off to the right).
  if (to < 0) {
    from += -to;
    to = 0;
  }
  // Never let the left edge sit right of lastBar + rightOffset (all data off to the left).
  const maxFrom = (rowCount != null && Number.isFinite(rowCount) ? rowCount : Number.POSITIVE_INFINITY)
    + state.rightOffset;
  if (from > maxFrom) {
    to -= from - maxFrom;
    from = maxFrom;
  }
  return { visibleFrom: from, visibleTo: to };
}

function commitLogicalRange(
  state: TimeScaleState,
  visibleFrom: number,
  visibleTo: number,
  options: LogicalRangeOptions,
): TimeScaleState {
  const width = state.widthPx;
  const minSpacing = finiteNumber(options.minBarSpacing, MIN_BAR_SPACING);
  const maxSpacing = finiteNumber(options.maxBarSpacing, MAX_BAR_SPACING);
  let from = visibleFrom;
  let to = visibleTo;
  let span = to - from;
  if (!(span > 0) || !(width > 0)) return state;

  const spacing = clampBarSpacing(width / span, minSpacing, maxSpacing);
  span = width / spacing;
  // Preserve the midpoint when spacing had to be clamped (no pointer anchor).
  const mid = (from + to) / 2;
  from = mid - span / 2;
  to = from + span;

  const clamped = clampLogicalWindow(from, to, state, options.rowCount);
  return {
    ...state,
    visibleFrom: clamped.visibleFrom,
    visibleTo: clamped.visibleTo,
    barSpacing: width / (clamped.visibleTo - clamped.visibleFrom),
  };
}

/**
 * Zoom the logical window around anchorX. `factor` is a range multiplier
 * (factor < 1 zooms in, matching wheelDeltaToZoomFactor). The logical index
 * under anchorX is held fixed before edge clamps fire.
 */
export function zoomLogicalRange(
  state: TimeScaleState,
  anchorX: number,
  factor: number,
  options: LogicalRangeOptions = {},
): TimeScaleState {
  if (!Number.isFinite(factor) || factor <= 0) return state;
  const spacing = barSpacingOf(state);
  const width = state.widthPx;
  if (!(width > 0) || !(spacing > 0)) return state;
  const anchorLogical = logicalOfX(anchorX, state);
  const nextSpacing = clampBarSpacing(
    spacing / factor,
    finiteNumber(options.minBarSpacing, MIN_BAR_SPACING),
    finiteNumber(options.maxBarSpacing, MAX_BAR_SPACING),
  );
  const span = width / nextSpacing;
  // logicalOfX(anchorX) = visibleFrom + anchorX/spacing - 0.5 stays put.
  const visibleFrom = anchorLogical - anchorX / nextSpacing + 0.5;
  const visibleTo = visibleFrom + span;
  const clamped = clampLogicalWindow(visibleFrom, visibleTo, state, options.rowCount);
  return {
    ...state,
    visibleFrom: clamped.visibleFrom,
    visibleTo: clamped.visibleTo,
    barSpacing: width / (clamped.visibleTo - clamped.visibleFrom),
  };
}

/** Translate the time window by dxPx (positive = content moves right). */
export function panLogicalRange(
  state: TimeScaleState,
  dxPx: number,
  options: LogicalRangeOptions = {},
): TimeScaleState {
  if (!Number.isFinite(dxPx) || dxPx === 0) return state;
  const spacing = barSpacingOf(state);
  const shift = dxPx / spacing;
  return commitLogicalRange(
    state,
    state.visibleFrom - shift,
    state.visibleTo - shift,
    options,
  );
}

export const timeScaleMath = {
  xOfLogical,
  logicalOfX,
  barSpacingOf,
  zoomLogicalRange,
  panLogicalRange,
};
