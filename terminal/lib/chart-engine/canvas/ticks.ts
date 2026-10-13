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

function weightAgainst(curr: Date, prev: Date): number {
  if (curr.getUTCFullYear() !== prev.getUTCFullYear()) return TIME_TICK_WEIGHT.year;
  if (curr.getUTCMonth() !== prev.getUTCMonth()) return TIME_TICK_WEIGHT.month;
  if (curr.getUTCDate() !== prev.getUTCDate()) return TIME_TICK_WEIGHT.day;
  if (curr.getUTCHours() !== prev.getUTCHours()) return TIME_TICK_WEIGHT.hour;
  if (curr.getUTCMinutes() !== prev.getUTCMinutes()) return TIME_TICK_WEIGHT.minute;
  return 0;
}

function typicalStepMs(rows: readonly EngineTime[], index: number): number {
  const curr = timeToMs(rows[index]);
  if (index + 1 < rows.length) {
    const next = timeToMs(rows[index + 1]);
    if (Number.isFinite(curr) && Number.isFinite(next) && next > curr) return next - curr;
  }
  if (index > 0) {
    const prev = timeToMs(rows[index - 1]);
    if (Number.isFinite(curr) && Number.isFinite(prev) && curr > prev) return curr - prev;
  }
  return 86_400_000;
}

function spanDaysOf(rows: readonly EngineTime[], from: number, to: number): number | null {
  const start = Math.max(0, Math.min(rows.length - 1, Math.floor(from)));
  const end = Math.max(0, Math.min(rows.length - 1, Math.ceil(to)));
  const a = timeToMs(rows[start]);
  const b = timeToMs(rows[end]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(b - a) / 86_400_000;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
    return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
  }
  if (weight === TIME_TICK_WEIGHT.day) {
    if (visibleSpanDays != null && visibleSpanDays > MAX_DAY_TICK_SPAN_DAYS) {
      if (date.getUTCDate() <= 7) {
        return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
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

function placeByWeight(candidates: TimeTick[], minGapPx: number): TimeTick[] {
  const placed: TimeTick[] = [];
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
      const collides = placed.some((p) => Math.abs(p.x - tick.x) < minGapPx);
      if (collides) continue;
      placed.push(tick);
    }
  }
  placed.sort((a, b) => a.x - b.x);
  return placed;
}

/**
 * Time-axis ticks for the bars in `rows` (index 0 = first primary-series row).
 * Higher-weight ticks are placed first; a lower-weight tick that would sit
 * within minGapPx of an already-placed tick is dropped.
 */
export function timeTicks(
  rows: readonly EngineTime[],
  state: TimeScaleState,
  options: TimeTickOptions,
): TimeTick[] {
  if (rows.length === 0 || !(state.widthPx > 0) || !(options.minGapPx > 0)) return [];
  const spacing = barSpacingOf(state);
  if (!(spacing > 0)) return [];

  const first = Math.max(0, Math.floor(state.visibleFrom) - 1);
  const last = Math.min(rows.length - 1, Math.ceil(state.visibleTo) + 1);
  if (last < first) return [];

  const spanDays = spanDaysOf(rows, state.visibleFrom, state.visibleTo);
  const locale = options.locale ?? "en-US";
  const candidates: TimeTick[] = [];

  for (let i = first; i <= last; i += 1) {
    const date = dateOf(rows[i]);
    if (!date) continue;
    let weight = 0;
    if (i > 0) {
      const prev = dateOf(rows[i - 1]);
      if (prev) weight = weightAgainst(date, prev);
    } else {
      const approxPrev = new Date(date.getTime() - typicalStepMs(rows, i));
      weight = weightAgainst(date, approxPrev);
    }
    if (weight === 0) continue;
    const x = xOfLogical(i, state);
    if (!Number.isFinite(x)) continue;
    if (x < -spacing || x > state.widthPx + spacing) continue;
    const label = formatTimeLabel(rows[i], weight, options.hourFormat, spanDays, locale);
    if (!label) continue;
    candidates.push({ index: i, x, label, weight });
  }

  return placeByWeight(candidates, options.minGapPx);
}
