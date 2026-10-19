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


function msOf(src: TimeRowSource, i: number): number {
  return src.msAt ? src.msAt(i) : timeToMs(src.timeAt(i));
}

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
/** ECMAScript TimeClip bound: a Date beyond it is invalid (every getUTC* field is NaN). */
const MAX_DATE_MS = 8.64e15;

/** floor(t / d) for an integral t, exact at every boundary (no float-quotient rounding). */
function floorDiv(t: number, d: number): number {
  const r = t % d;
  return (t - r) / d - (r < 0 ? 1 : 0);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * PERF-C: the UTC calendar fields the tick weight compares, computed from epoch
 * ms by integer arithmetic instead of a `new Date` per bar. `set(ms)` mirrors
 * `new Date(ms)` exactly: TimeClip truncates toward zero and anything past
 * ±8.64e15 is invalid. Days map to the proleptic Gregorian calendar (the
 * calendar Date uses) via Hinnant's civil_from_days, run only when a bar
 * leaves the cached month, so a daily series pays it about once a month.
 */
class UtcFields {
  valid = false;
  t = 0;
  year = 0;
  /** year * 12 + month0 */
  month = 0;
  dayKey = 0;
  hourKey = 0;
  minuteKey = 0;
  /** day of month, 1..31 */
  dom = 0;
  private monthStart = 0;
  private monthEnd = 0; // exclusive; monthEnd <= monthStart means no month cached

  set(ms: number): void {
    if (!(Math.abs(ms) <= MAX_DATE_MS)) {
      this.valid = false;
      return;
    }
    const t = Math.trunc(ms);
    this.valid = true;
    this.t = t;
    const day = floorDiv(t, MS_DAY);
    this.dayKey = day;
    this.hourKey = floorDiv(t, MS_HOUR);
    this.minuteKey = floorDiv(t, MS_MINUTE);
    if (day >= this.monthStart && day < this.monthEnd) {
      this.dom = day - this.monthStart + 1;
      return;
    }
    const z = day + 719_468;
    const era = floorDiv(z, 146_097);
    const doe = z - era * 146_097;
    const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const dom = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month0 = mp < 10 ? mp + 2 : mp - 10;
    const year = yoe + era * 400 + (month0 <= 1 ? 1 : 0);
    this.year = year;
    this.month = year * 12 + month0;
    this.dom = dom;
    this.monthStart = day - dom + 1;
    this.monthEnd = this.monthStart + (month0 === 1 && isLeapYear(year) ? 29 : MONTH_DAYS[month0]);
  }
}

/**
 * Same weight the getUTC* comparison of two Dates gives: an invalid Date's
 * fields are NaN, so its first comparison (the year) already differs.
 */
function weightOf(curr: UtcFields, prev: UtcFields): number {
  if (!curr.valid || !prev.valid) return TIME_TICK_WEIGHT.year;
  if (curr.year !== prev.year) return TIME_TICK_WEIGHT.year;
  if (curr.month !== prev.month) return TIME_TICK_WEIGHT.month;
  if (curr.dayKey !== prev.dayKey) return TIME_TICK_WEIGHT.day;
  if (curr.hourKey !== prev.hourKey) return TIME_TICK_WEIGHT.hour;
  if (curr.minuteKey !== prev.minuteKey) return TIME_TICK_WEIGHT.minute;
  return 0;
}

function typicalStepMs(src: TimeRowSource, index: number): number {
  const curr = msOf(src, index);
  if (index + 1 < src.length) {
    const next = msOf(src, index + 1);
    if (Number.isFinite(curr) && Number.isFinite(next) && next > curr) return next - curr;
  }
  if (index > 0) {
    const prev = msOf(src, index - 1);
    if (Number.isFinite(curr) && Number.isFinite(prev) && curr > prev) return curr - prev;
  }
  return 86_400_000;
}

function spanDaysOf(src: TimeRowSource, from: number, to: number): number | null {
  const start = Math.max(0, Math.min(src.length - 1, Math.floor(from)));
  const end = Math.max(0, Math.min(src.length - 1, Math.ceil(to)));
  const a = msOf(src, start);
  const b = msOf(src, end);
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
  ms: number,
  weight: number,
  hourFormat: "12" | "24",
  visibleSpanDays: number | null,
  locale: string,
): string {
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);

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
 * Time-axis ticks for the bars in `rows` (index 0 = first primary-series row;
 * `rows` may be a TimeRowSource accessor so no per-frame times copy is made).
 * Higher-weight ticks are placed first; a lower-weight tick that would sit
 * within minGapPx of an already-placed tick is dropped. PERF-B: only the
 * visible slice [floor(visibleFrom)-1, ceil(visibleTo)+1] is visited.
 *
 * PERF-C: a fitted 40k-bar daily window visits every bar each paint, twice
 * (grid and axis), so the per-bar work is arithmetic only — weights from
 * UtcFields, no Date — and labels are formatted for PLACED ticks only, from
 * the row's epoch-ms key (msAt === timeToMs(timeAt), so no row read). Output
 * is unchanged: a candidate still needs a non-empty label, and the one empty
 * case (formatTimeLabel's day label past day 7 on a > MAX_DAY_TICK_SPAN_DAYS
 * window) is decided from the bar's day of month before placement. Collision
 * still runs weight levels high→low, candidates in bar order, against the two
 * nearest placed x's; the placed list is kept sorted by x as it grows.
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
  const sparseDays = spanDays != null && spanDays > MAX_DAY_TICK_SPAN_DAYS;
  const locale = options.locale ?? "en-US";
  // Candidates per weight level as flat [index, x, index, x, ...] in bar order.
  const levels: number[][] = [[], [], [], [], [], []];

  let curr = new UtcFields();
  let prev = new UtcFields();
  let prevFinite = false;
  if (first > 0) {
    const ms = msOf(src, first - 1);
    prevFinite = Number.isFinite(ms);
    if (prevFinite) prev.set(ms);
  }
  for (let i = first; i <= last; i += 1) {
    const ms = msOf(src, i);
    if (!Number.isFinite(ms)) {
      prevFinite = false;
      continue;
    }
    curr.set(ms);
    let weight = 0;
    if (i > 0) {
      if (prevFinite) weight = weightOf(curr, prev);
    } else {
      prev.set(curr.valid ? curr.t - typicalStepMs(src, i) : Number.NaN);
      weight = weightOf(curr, prev);
    }
    const dom = curr.dom;
    const swap = prev;
    prev = curr;
    curr = swap;
    prevFinite = true;
    if (weight === 0) continue;
    const x = xOfLogical(i, state);
    if (!Number.isFinite(x)) continue;
    if (x < -spacing || x > state.widthPx + spacing) continue;
    if (weight === TIME_TICK_WEIGHT.day && sparseDays && dom > 7) continue;
    levels[weight].push(i, x);
  }

  const placedXs: number[] = [];
  const placedIdx: number[] = [];
  const placedWeight: number[] = [];
  const minGapPx = options.minGapPx;
  for (let weight = TIME_TICK_WEIGHT.year; weight >= TIME_TICK_WEIGHT.minute; weight -= 1) {
    const level = levels[weight];
    for (let k = 0; k < level.length; k += 2) {
      const x = level[k + 1];
      let lo = 0;
      let hi = placedXs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (placedXs[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      const collides = (lo > 0 && x - placedXs[lo - 1] < minGapPx)
        || (lo < placedXs.length && placedXs[lo] - x < minGapPx);
      if (collides) continue;
      placedXs.splice(lo, 0, x);
      placedIdx.splice(lo, 0, level[k]);
      placedWeight.splice(lo, 0, weight);
    }
  }

  const ticks: TimeTick[] = [];
  for (let k = 0; k < placedXs.length; k += 1) {
    const index = placedIdx[k];
    const weight = placedWeight[k];
    const label = formatTimeLabel(msOf(src, index), weight, options.hourFormat, spanDays, locale);
    ticks.push({ index, x: placedXs[k], label, weight });
  }
  return ticks;
}
