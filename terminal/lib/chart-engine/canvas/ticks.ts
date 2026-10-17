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
  displayRangeOf,
  displayToPrice,
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
