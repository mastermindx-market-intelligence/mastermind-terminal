// Native chart-engine tick generation (P3 canvas renderer).
//
// Pure price-axis and time-axis ticks for the Canvas2D implementation of api.ts.
// Price ticks use 1 / 2 / 2.5 / 5 × 10^n steps on the mode's display domain
// (log distributes those steps on the log-mapped range). Adjacent tick y's are
// at least minLabelGapPx apart; the axes lane still owns collision for arbitrary
// measured label widths.
//
// Time ticks carry year > month > day > hour > minute weights. When two ticks
// collide, the first (already placed) higher-weight tick wins. Labels follow
// chartTimeAxis.formatChartTimeTick: 12-hour clock strings match it exactly,
// calendar / 24-hour labels fill in the nulls that formatter reserves for LWC.

import type { EngineTime } from "../api";
import { timeToMs } from "../../timeWindow";
import {
  barSpacingOf,
  coordinateOfDisplay,
  coordinateToPrice,
  DEFAULT_TICK_MARK_DENSITY,
  displayAtCoordinate,
  displayRangeOf,
  displayToPrice,
  priceToDisplay,
  xOfLogical,
  type PriceScaleMode,
  type PriceScaleState,
  type TimeScaleState,
} from "./scales";

export type PriceTick = { value: number; y: number; label: string };

export type PriceTickOptions = {
  minLabelGapPx: number;
  format?: (value: number) => string;
};

/**
 * Numeric weights so a higher-weight tick always outranks a lower one.
 * year (5) > month (4) > day (3) > hour (2) > minute (1).
 */
export const TIME_TICK_WEIGHT = {
  year: 5,
  month: 4,
  day: 3,
  hour: 2,
  minute: 1,
} as const;

export type TimeTick = {
  index: number;
  x: number;
  label: string;
  weight: number;
};

export type TimeTickOptions = {
  minGapPx: number;
  hourFormat: "12" | "24";
  locale?: string;
};

/**
 * PERF-B: row-time accessor so timeTicks never needs a per-frame copy of every
 * row time. `msAt` serves a cached epoch-ms key (from the model's per-series
 * key index) so the visible slice avoids timeToMs entirely.
 */
export type TimeRowSource = {
  readonly length: number;
  timeAt(i: number): EngineTime;
  /** Cached epoch ms of row i; absent means derive via timeToMs(timeAt(i)). */
  msAt?(i: number): number;
};

const EMPTY_TIME_SOURCE: TimeRowSource = {
  length: 0,
  timeAt: () => {
    throw new Error("timeTicks: empty time source has no rows");
  },
};

/** Normalize the union input (plain array or accessor) to one accessor shape. */
function asTimeSource(rows: readonly EngineTime[] | TimeRowSource): TimeRowSource {
  if (Array.isArray(rows)) {
    return {
      length: rows.length,
      timeAt: (i: number) => rows[i] as EngineTime,
      msAt: (i: number) => timeToMs(rows[i] as EngineTime),
    };
  }
  const src = rows as TimeRowSource;
  return src.length === 0 ? EMPTY_TIME_SOURCE : src;
}

/** Mirrors chartTimeAxis.MAX_DAY_TICK_SPAN_DAYS — keep in lockstep. */
const MAX_DAY_TICK_SPAN_DAYS = 120;

const NICE_MANTISSAS = [1, 2, 2.5, 5, 10];
const MAX_PRICE_TICKS = 64;

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const pow = 10 ** exp;
  const frac = raw / pow;
  for (let i = 0; i < NICE_MANTISSAS.length; i += 1) {
    if (frac <= NICE_MANTISSAS[i]) return NICE_MANTISSAS[i] * pow;
  }
  return 10 * pow;
}

function snapToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toPrecision(12));
}

function defaultPriceLabel(value: number, mode: PriceScaleMode): string {
  if (!Number.isFinite(value)) return "";
  const text = formatCompact(value);
  return mode === "percent" ? `${text}%` : text;
}

function formatCompact(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e7 || abs < 1e-4) return value.toExponential(2);
  return String(Number(value.toPrecision(7)));
}

/**
 * Price-axis ticks. `value` is in the mode's display domain (price for
 * normal/log, percent, indexed-to-100). Adjacent y's are >= minLabelGapPx.
 */
export function priceTicks(state: PriceScaleState, options: PriceTickOptions): PriceTick[] {
  const minGap = options.minLabelGapPx;
  const range = displayRangeOf(state);
  if (!(range.to > range.from) || !(state.heightPx > 1) || !(minGap > 0)) return [];

  const height = state.heightPx;
  const internalHeight = height - (state.margins.top + state.margins.bottom) * height;
  if (internalHeight <= 1) return [];

  const pxPerUnit = (internalHeight - 1) / (range.to - range.from);
  const step = niceStep(minGap / Math.abs(pxPerUnit));
  if (!(step > 0) || !Number.isFinite(step)) return [];

  const ticks: PriceTick[] = [];
  const start = snapToStep(Math.ceil((range.from - step * 1e-12) / step) * step, step);
  const format = options.format
    ?? ((value: number) => defaultPriceLabel(value, state.mode));

  let prevY: number | null = null;
  for (let i = 0, v = start; i < MAX_PRICE_TICKS && v <= range.to + step * 1e-12; i += 1, v += step) {
    const display = snapToStep(v, step);
    if (display < range.from - step * 1e-9 || display > range.to + step * 1e-9) continue;
    const y = coordinateOfDisplay(display, state);
    if (!Number.isFinite(y)) continue;
    if (prevY != null && Math.abs(y - prevY) < minGap) continue;
    const value = state.mode === "log" ? displayToPrice(display, state) : display;
    if (!Number.isFinite(value)) continue;
    const label = format(value);
    if (!label) continue;
    ticks.push({ value, y, label });
    prevY = y;
  }
  return ticks;
}

// ── LWC price tick marks ────────────────────────────────────────────────────
//
// A line-for-line mirror of LWC v5.2.0 PriceTickSpanCalculator (dev:4275) and
// PriceTickMarkBuilder (dev:4337), so mm places the same price-axis marks and grid
// lines as the default engine. Three deliberate guards where LWC would throw or
// spin: a base that is not a product of 2s and 5s (LWC throws 'unexpected base')
// gets no fractional dividers; non-finite or degenerate ranges give no marks; and
// the mark walk stops when a span no longer moves the value or after
// MAX_LWC_MARK_STEPS. Edge marks (ensureEdgeTickMarksVisible, default off) and the
// cache LWC keeps while the scale has no first value are not mirrored: the caller
// paints no marks for a scale without a first value.

/** One LWC price mark. `logical` is in the scale's display domain (a price in log mode). */
export type PriceMark = { logical: number; y: number; label: string };

export type PriceMarkOptions = {
  /** layout.fontSize — the mark pitch is ceil(fontSize × tickMarkDensity). */
  fontSize: number;
  /** The scale formatter base (round(source base), 100 without a source). */
  base: number;
  /** The scale's formatLogicalTickmarks. */
  formatTickmarks: (logicals: readonly number[]) => string[];
  /** priceScale entireTextOnly (default false). */
  entireTextOnly?: boolean;
};

const TICK_SPAN_EPSILON = 1e-14;
const MAX_LWC_MARK_STEPS = 10_000;
const MAX_LWC_DIVIDER_STEPS = 2_000;

function greaterOrEqual(x1: number, x2: number, epsilon: number): boolean {
  return (x2 - x1) <= epsilon;
}

function equalWithin(x1: number, x2: number, epsilon: number): boolean {
  return Math.abs(x1 - x2) < epsilon;
}

/** LWC isBaseDecimal (dev:4035). */
function isBaseDecimal(value: number): boolean {
  if (value < 0) return false;
  if (value > 1e18) return true;
  for (let current = value; current > 1; current /= 10) {
    if ((current % 10) !== 0) return false;
  }
  return true;
}

/** LWC PriceTickSpanCalculator fractional dividers; [] where LWC would throw. */
function fractionalDividersOf(base: number): number[] {
  if (isBaseDecimal(base)) return [2, 2.5, 2];
  const dividers: number[] = [];
  for (let rest = base; rest !== 1;) {
    if ((rest % 2) === 0) {
      dividers.push(2);
      rest /= 2;
    } else if ((rest % 5) === 0) {
      dividers.push(2, 2.5);
      rest /= 5;
    } else {
      return [];
    }
    if (dividers.length > 100) return [];
  }
  return dividers;
}

/** LWC PriceTickSpanCalculator.tickSpan (dev:4301). */
function lwcCalculatorTickSpan(
  base: number,
  integralDividers: readonly number[],
  fractionalDividers: readonly number[],
  high: number,
  low: number,
  maxTickSpan: number,
): number {
  const minMovement = base === 0 ? 0 : 1 / base;
  let span = 10 ** Math.max(0, Math.ceil(Math.log10(high - low)));
  let index = 0;
  let c = integralDividers[0];
  for (let step = 0; step < MAX_LWC_DIVIDER_STEPS; step += 1) {
    const largerMinMovement = greaterOrEqual(span, minMovement, TICK_SPAN_EPSILON)
      && span > minMovement + TICK_SPAN_EPSILON;
    const largerMaxTickSpan = greaterOrEqual(span, maxTickSpan * c, TICK_SPAN_EPSILON);
    const largerOne = greaterOrEqual(span, 1, TICK_SPAN_EPSILON);
    if (!(largerMinMovement && largerMaxTickSpan && largerOne)) break;
    span /= c;
    c = integralDividers[++index % integralDividers.length];
  }
  if (span <= minMovement + TICK_SPAN_EPSILON) span = minMovement;
  span = Math.max(1, span);
  if (fractionalDividers.length > 0 && equalWithin(span, 1, TICK_SPAN_EPSILON)) {
    index = 0;
    c = fractionalDividers[0];
    for (
      let step = 0;
      step < MAX_LWC_DIVIDER_STEPS
        && greaterOrEqual(span, maxTickSpan * c, TICK_SPAN_EPSILON)
        && span > minMovement + TICK_SPAN_EPSILON;
      step += 1
    ) {
      span /= c;
      c = fractionalDividers[++index % fractionalDividers.length];
    }
  }
  return span;
}

/** LWC PriceTickMarkBuilder.tickSpan (dev:4346): the smallest of the three divider orders. */
export function lwcPriceTickSpan(high: number, low: number, scaleHeight: number, markHeight: number, base: number): number {
  const maxTickSpan = (high - low) * markHeight / scaleHeight;
  const fractional = fractionalDividersOf(base);
  return Math.min(
    lwcCalculatorTickSpan(base, [2, 2.5, 2], fractional, high, low, maxTickSpan),
    lwcCalculatorTickSpan(base, [2, 2, 2.5], fractional, high, low, maxTickSpan),
    lwcCalculatorTickSpan(base, [2.5, 2, 2], fractional, high, low, maxTickSpan),
  );
}

/** LWC PriceScale._logicalToCoordinate (dev:5052). */
function lwcLogicalToCoordinate(logical: number, state: PriceScaleState): number {
  const display = state.mode === "log" && logical ? priceToDisplay(logical, state) : logical;
  return coordinateOfDisplay(display, state);
}

/** LWC PriceScale._coordinateToLogical (dev:5064). */
function lwcCoordinateToLogical(y: number, state: PriceScaleState): number {
  return state.mode === "log" ? coordinateToPrice(y, state) : displayAtCoordinate(y, state);
}

/** LWC PriceTickMarkBuilder.rebuildTickMarks (dev:4363) for a scale that has a first value. */
export function lwcPriceMarks(state: PriceScaleState, options: PriceMarkOptions): PriceMark[] {
  const scaleHeight = state.heightPx;
  if (!(scaleHeight > 1) || !(options.fontSize > 0)) return [];
  const density = state.tickMarkDensity ?? DEFAULT_TICK_MARK_DENSITY;
  const markHeight = Math.ceil(options.fontSize * density);
  const bottom = lwcCoordinateToLogical(scaleHeight - 1, state);
  const top = lwcCoordinateToLogical(0, state);
  const extra = options.entireTextOnly ? options.fontSize / 2 : 0;
  const minCoord = extra;
  const maxCoord = scaleHeight - 1 - extra;
  const high = Math.max(bottom, top);
  const low = Math.min(bottom, top);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high === low) return [];

  let span = lwcPriceTickSpan(high, low, scaleHeight, markHeight, options.base);
  if (!(span > 0) || !Number.isFinite(span)) return [];
  let mod = high % span;
  mod += mod < 0 ? span : 0;
  const sign = high >= low ? 1 : -1;
  const marks: { logical: number; y: number }[] = [];
  let prevCoord: number | null = null;
  let steps = 0;
  for (let logical = high - mod; logical > low; logical -= span) {
    if (++steps > MAX_LWC_MARK_STEPS) break;
    const coord = lwcLogicalToCoordinate(logical, state);
    if (!(prevCoord !== null && Math.abs(coord - prevCoord) < markHeight) && !(coord < minCoord || coord > maxCoord)) {
      marks.push({ logical, y: coord });
      prevCoord = coord;
      if (state.mode === "log") {
        span = lwcPriceTickSpan(logical * sign, low, scaleHeight, markHeight, options.base);
        if (!(span > 0) || !Number.isFinite(span)) break;
      }
    }
    // The decrement below would leave a huge value unchanged (span < its ulp).
    if (logical - span === logical) break;
  }
  const labels = options.formatTickmarks(marks.map((mark) => mark.logical));
  return marks.map((mark, i) => ({ logical: mark.logical, y: mark.y, label: labels[i] ?? "" }));
}

function dateOf(time: EngineTime): Date | null {
  const ms = timeToMs(time);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function dateAt(src: TimeRowSource, i: number): Date | null {
  const ms = src.msAt ? src.msAt(i) : timeToMs(src.timeAt(i));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function weightAgainst(curr: Date, prev: Date): number {
  if (curr.getUTCFullYear() !== prev.getUTCFullYear()) return TIME_TICK_WEIGHT.year;
  if (curr.getUTCMonth() !== prev.getUTCMonth()) return TIME_TICK_WEIGHT.month;
  if (curr.getUTCDate() !== prev.getUTCDate()) return TIME_TICK_WEIGHT.day;
  if (curr.getUTCHours() !== prev.getUTCHours()) return TIME_TICK_WEIGHT.hour;
  if (curr.getUTCMinutes() !== prev.getUTCMinutes()) return TIME_TICK_WEIGHT.minute;
  return 0;
}

function typicalStepMs(src: TimeRowSource, index: number): number {
  const curr = src.msAt ? src.msAt(index) : timeToMs(src.timeAt(index));
  if (index + 1 < src.length) {
    const next = src.msAt ? src.msAt(index + 1) : timeToMs(src.timeAt(index + 1));
    if (Number.isFinite(curr) && Number.isFinite(next) && next > curr) return next - curr;
  }
  if (index > 0) {
    const prev = src.msAt ? src.msAt(index - 1) : timeToMs(src.timeAt(index - 1));
    if (Number.isFinite(curr) && Number.isFinite(prev) && curr > prev) return curr - prev;
  }
  return 86_400_000;
}

function spanDaysOf(src: TimeRowSource, from: number, to: number): number | null {
  const start = Math.max(0, Math.min(src.length - 1, Math.floor(from)));
  const end = Math.max(0, Math.min(src.length - 1, Math.ceil(to)));
  const a = src.msAt ? src.msAt(start) : timeToMs(src.timeAt(start));
  const b = src.msAt ? src.msAt(end) : timeToMs(src.timeAt(end));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(b - a) / 86_400_000;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// PERF-B: month-short formatter cache per locale. The constructor was the
// single largest cost in the bench CPU profile (a fresh Intl.DateTimeFormat per
// candidate label per paint). Bounded: past the cap the map resets, so an
// adversarial locale churn cannot grow it without limit.
const MONTH_SHORT_FMT_CAP = 16;
const monthShortFmtCache = new Map<string, Intl.DateTimeFormat>();

function monthShortFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = monthShortFmtCache.get(locale);
  if (!fmt) {
    if (monthShortFmtCache.size >= MONTH_SHORT_FMT_CAP) monthShortFmtCache.clear();
    fmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    monthShortFmtCache.set(locale, fmt);
  }
  return fmt;
}

/**
 * 12-hour clock matches formatChartTimeTick; calendar / 24-hour fill the
 * nulls that helper returns so LWC can format them.
 */
function formatTimeLabel(
  time: EngineTime,
  weight: number,
  hourFormat: "12" | "24",
  visibleSpanDays: number | null,
  locale: string,
): string {
  const date = dateOf(time);
  if (!date) return "";

  if (weight === TIME_TICK_WEIGHT.year) {
    return String(date.getUTCFullYear());
  }
  if (weight === TIME_TICK_WEIGHT.month) {
    return monthShortFormatter(locale).format(date);
  }
  if (weight === TIME_TICK_WEIGHT.day) {
    if (visibleSpanDays != null && visibleSpanDays > MAX_DAY_TICK_SPAN_DAYS) {
      if (date.getUTCDate() <= 7) {
        return monthShortFormatter(locale).format(date);
      }
      return "";
    }
    return String(date.getUTCDate());
  }

  const hour24 = date.getUTCHours();
  const minute = pad2(date.getUTCMinutes());
  if (hourFormat === "12") {
    const hour = hour24 % 12 || 12;
    return `${hour}:${minute} ${hour24 >= 12 ? "PM" : "AM"}`;
  }
  return `${pad2(hour24)}:${minute}`;
}

/**
 * PERF-B: same output as the previous placed.some(...) scan — weight levels
 * high→low, candidates in generation order, a tick within minGapPx of ANY
 * placed tick dropped — but collision is checked against the two nearest
 * placed x's via binary search (exact: any collision is with a nearest
 * neighbour), keeping a sorted-x insert list instead of an O(c×placed) scan.
 */
function placeByWeight(candidates: TimeTick[], minGapPx: number): TimeTick[] {
  const placed: TimeTick[] = [];
  const placedXs: number[] = [];
  const weights = [
    TIME_TICK_WEIGHT.year,
    TIME_TICK_WEIGHT.month,
    TIME_TICK_WEIGHT.day,
    TIME_TICK_WEIGHT.hour,
    TIME_TICK_WEIGHT.minute,
  ];
  for (const weight of weights) {
    for (const tick of candidates) {
      if (tick.weight !== weight) continue;
      let lo = 0;
      let hi = placedXs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (placedXs[mid] < tick.x) lo = mid + 1;
        else hi = mid;
      }
      const collides = (lo > 0 && tick.x - placedXs[lo - 1] < minGapPx)
        || (lo < placedXs.length && placedXs[lo] - tick.x < minGapPx);
      if (collides) continue;
      placed.push(tick);
      placedXs.splice(lo, 0, tick.x);
    }
  }
  placed.sort((a, b) => a.x - b.x);
  return placed;
}

/**
 * Time-axis ticks for the bars in `rows` (index 0 = first primary-series row;
 * `rows` may be a TimeRowSource accessor so no per-frame times copy is made).
 * Higher-weight ticks are placed first; a lower-weight tick that would sit
 * within minGapPx of an already-placed tick is dropped. PERF-B: only the
 * visible slice [floor(visibleFrom)-1, ceil(visibleTo)+1] is visited.
 */
export function timeTicks(
  rows: readonly EngineTime[] | TimeRowSource,
  state: TimeScaleState,
  options: TimeTickOptions,
): TimeTick[] {
  const src = asTimeSource(rows);
  if (src.length === 0 || !(state.widthPx > 0) || !(options.minGapPx > 0)) return [];
  const spacing = barSpacingOf(state);
  if (!(spacing > 0)) return [];

  const first = Math.max(0, Math.floor(state.visibleFrom) - 1);
  const last = Math.min(src.length - 1, Math.ceil(state.visibleTo) + 1);
  if (last < first) return [];

  const spanDays = spanDaysOf(src, state.visibleFrom, state.visibleTo);
  const locale = options.locale ?? "en-US";
  const candidates: TimeTick[] = [];

  for (let i = first; i <= last; i += 1) {
    const date = dateAt(src, i);
    if (!date) continue;
    let weight = 0;
    if (i > 0) {
      const prev = dateAt(src, i - 1);
      if (prev) weight = weightAgainst(date, prev);
    } else {
      const approxPrev = new Date(date.getTime() - typicalStepMs(src, i));
      weight = weightAgainst(date, approxPrev);
    }
    if (weight === 0) continue;
    const x = xOfLogical(i, state);
    if (!Number.isFinite(x)) continue;
    if (x < -spacing || x > state.widthPx + spacing) continue;
    const label = formatTimeLabel(src.timeAt(i), weight, options.hourFormat, spanDays, locale);
    if (!label) continue;
    candidates.push({ index: i, x, label, weight });
  }

  return placeByWeight(candidates, options.minGapPx);
}
