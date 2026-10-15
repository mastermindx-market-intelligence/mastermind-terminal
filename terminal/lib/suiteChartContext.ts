/** Pure chart-to-suite context helpers. Kept outside ChartPanel so finality is unit-testable. */

import { tfSeconds, type Market } from "./intradayShared";
import { liveDisplayEpoch } from "./liveCandle";
import { isMacroSymbol, macroDisplayTz } from "./macroSymbols";
import { dailyMultipleOf, resolveBarAnchor, sessionBarOpens, type SessionAnchor } from "./sessionBars";
import { usRegularSessionWindow } from "./usEquitySessionClock";

export interface SuiteFinalityBar {
  time: string | number;
  closeTime?: string | number;
}

export interface SuiteFinalityInput {
  bars: readonly SuiteFinalityBar[];
  dailyBars?: readonly SuiteFinalityBar[];
  symbol: string;
  timeframe: string;
  market: Market;
  extendedHours: boolean;
  replayActive: boolean;
  nowMs: number;
  sessionAnchor?: SessionAnchor | null;
}

type SessionSegment = readonly [startMinute: number, endMinute: number];

const DAY_SECONDS = 86_400;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const US_REGULAR_FALLBACK: SessionSegment = [9 * 60 + 30, 16 * 60];
const US_EXTENDED: SessionSegment = [4 * 60, 20 * 60];
const CA_REGULAR: SessionSegment = [9 * 60 + 30, 16 * 60];
const CN_REGULAR: readonly SessionSegment[] = [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]];
const HK_REGULAR: readonly SessionSegment[] = [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60]];
const CRYPTO_SESSION: SessionSegment = [0, 24 * 60];
const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = ZONE_FORMATTERS.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    ZONE_FORMATTERS.set(zone, formatter);
  }
  return formatter;
}

/** True UTC instant -> the app's market-local wall clock interpreted as UTC. */
function displayEpochForZone(utcMs: number, zone: string): number | null {
  if (!Number.isFinite(utcMs) || utcMs <= 0) return null;
  try {
    const parts: Record<string, string> = {};
    for (const part of zoneFormatter(zone).formatToParts(utcMs)) parts[part.type] = part.value;
    const epoch = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    ) / 1_000;
    return Number.isFinite(epoch) ? epoch : null;
  } catch {
    return null;
  }
}

function validIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function dayOf(value: unknown): string | null {
  if (validIsoDay(value)) return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value * 1_000);
  return Number.isFinite(date.valueOf()) ? date.toISOString().slice(0, 10) : null;
}

function dayEpoch(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 1_000;
}

function addDays(day: string, count: number): string {
  return new Date((dayEpoch(day) + count * DAY_SECONDS) * 1_000).toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(dayEpoch(day) * 1_000).getUTCDay();
}

function isWeekday(day: string): boolean {
  const value = weekday(day);
  return value !== 0 && value !== 6;
}

function usRegularWindow(day: string): SessionSegment | null {
  try {
    return usRegularSessionWindow(dayEpoch(day) + 12 * 60 * 60);
  } catch {
    // The bundled projection is the authority inside its declared range. Outside that finite
    // range, keep the study conservative but usable with the exchange's ordinary weekday hours.
    return isWeekday(day) ? US_REGULAR_FALLBACK : null;
  }
}

function tradingDay(day: string, market: Market, symbol = ""): boolean {
  if (market === "crypto") return true;
  // Macro providers admit their own dated rows, but the repository does not own a complete
  // holiday calendar for every futures/FX/home-index venue. Weekdays are the conservative
  // calendar-period approximation; same-day finality is handled separately below.
  if (isMacroSymbol(symbol)) return isWeekday(day);
  if (market === "us") return usRegularWindow(day) !== null;
  return isWeekday(day);
}

function sessionSegments(
  day: string,
  market: Market,
  extendedHours: boolean,
  intraday: boolean,
): readonly SessionSegment[] {
  if (market === "crypto") return [CRYPTO_SESSION];
  if (market === "us") {
    const regular = usRegularWindow(day);
    if (!regular) return [];
    return intraday && extendedHours ? [US_EXTENDED] : [regular];
  }
  if (!tradingDay(day, market)) return [];
  if (market === "ca") return [intraday && extendedHours ? US_EXTENDED : CA_REGULAR];
  if (market === "cn") return CN_REGULAR;
  return HK_REGULAR;
}

function minuteOfDay(displayEpoch: number): number {
  return ((Math.floor(displayEpoch / 60) % 1_440) + 1_440) % 1_440;
}

function currentDisplayEpoch(nowMs: number, market: Market, symbol: string): number | null {
  return isMacroSymbol(symbol)
    ? displayEpochForZone(nowMs, macroDisplayTz(symbol))
    : liveDisplayEpoch(nowMs, market);
}

function sessionClosed(day: string, nowDisplay: number, market: Market, symbol: string): boolean {
  const today = dayOf(nowDisplay);
  if (!today) return false;
  if (day < today) return true;
  if (day > today) return false;
  // Without an authoritative close calendar for every macro venue, same-local-day daily rows stay
  // provisional until the provider's display day rolls. This delays confirmation rather than
  // inventing a US-equity close for London, Tokyo, FX, or futures.
  if (isMacroSymbol(symbol)) return false;
  const segments = sessionSegments(day, market, false, false);
  if (!segments.length) return false;
  return minuteOfDay(nowDisplay) >= segments[segments.length - 1][1];
}

function isoWeekStart(day: string): string {
  const offset = (weekday(day) + 6) % 7;
  return addDays(day, -offset);
}

function periodKey(day: string, timeframe: string): string {
  if (timeframe === "W") return isoWeekStart(day);
  if (timeframe === "2W") {
    const startDays = Math.floor(dayEpoch(isoWeekStart(day)) / DAY_SECONDS);
    return String(Math.floor(startDays / 14));
  }
  if (timeframe === "1M") return day.slice(0, 7);
  if (timeframe === "3M") {
    const month = Number(day.slice(5, 7)) - 1;
    return `${day.slice(0, 4)}-Q${Math.floor(month / 3)}`;
  }
  return day;
}

function hasLaterSessionInPeriod(day: string, timeframe: string, market: Market, symbol: string): boolean {
  const key = periodKey(day, timeframe);
  // A quarter is the longest supported calendar bucket; 100 days safely reaches its boundary.
  for (let offset = 1; offset <= 100; offset++) {
    const candidate = addDays(day, offset);
    if (periodKey(candidate, timeframe) !== key) return false;
    if (tradingDay(candidate, market, symbol)) return true;
  }
  return true; // malformed/unsupported boundary: withhold confirmation rather than guess finality.
}

function formingIndex(bars: readonly SuiteFinalityBar[]): number | null {
  return bars.length ? bars.length - 1 : null;
}

function intradayFormingIndex(input: SuiteFinalityInput, nowDisplay: number): number | null {
  const candidate = formingIndex(input.bars);
  if (candidate === null) return null;
  const tail = input.bars[candidate];
  if (typeof tail.time !== "number" || !Number.isFinite(tail.time)) return candidate;
  const span = tfSeconds(input.timeframe);
  if (!Number.isFinite(span) || span <= 0) return candidate;
  if (isMacroSymbol(input.symbol)) {
    // Macro intraday rows already use the symbol's home-market display epoch. They may be
    // nearly-24h futures/FX or a non-US index, so an equity session clamp is invalid. The only
    // universally defensible boundary is the interval close on that same display axis.
    return nowDisplay < tail.time + span ? candidate : null;
  }
  const day = dayOf(tail.time);
  if (!day) return candidate;
  const segments = sessionSegments(day, input.market, input.extendedHours, true);
  if (!segments.length) return candidate;
  const minute = minuteOfDay(tail.time);
  const segment = segments.find(([start, end]) => minute >= start && minute < end);
  if (!segment) return candidate;
  const sessionEnd = dayEpoch(day) + segment[1] * 60;
  const closesAt = Math.min(tail.time + span, sessionEnd);
  return nowDisplay < closesAt ? candidate : null;
}

function dailyDerivedFormingIndex(input: SuiteFinalityInput, nowDisplay: number): number | null {
  const candidate = formingIndex(input.bars);
  if (candidate === null) return null;
  const source = input.dailyBars?.length ? input.dailyBars : input.bars;
  const days = source.map((bar) => dayOf(bar.time));
  if (!days.length || days.some((day) => day === null)) return candidate;
  const typedDays = days as string[];
  const lastDay = typedDays[typedDays.length - 1];
  if (!isMacroSymbol(input.symbol) && !tradingDay(lastDay, input.market, input.symbol)) return candidate;

  const multiple = dailyMultipleOf(input.timeframe);
  if (multiple !== null) {
    const anchor = resolveBarAnchor(typedDays, input.sessionAnchor);
    const opens = sessionBarOpens(typedDays.length, multiple, anchor);
    const lastOpen = opens[opens.length - 1] ?? 0;
    if (typedDays.length - lastOpen < multiple) return candidate;
    return sessionClosed(lastDay, nowDisplay, input.market, input.symbol) ? null : candidate;
  }

  if (["W", "2W", "1M", "3M"].includes(input.timeframe)) {
    if (hasLaterSessionInPeriod(lastDay, input.timeframe, input.market, input.symbol)) return candidate;
    return sessionClosed(lastDay, nowDisplay, input.market, input.symbol) ? null : candidate;
  }

  // D / 1D and any other daily-derived row represent one source session.
  return sessionClosed(lastDay, nowDisplay, input.market, input.symbol) ? null : candidate;
}

/**
 * Return the only chart row that can still change, or null when all rows are final.
 *
 * Finality comes from the bar/session clock and the admitted daily source, never from whether a
 * quote happened to arrive. Replay is closed by definition. Unknown timing is fail-closed: the
 * last row may render as forming but cannot emit a confirmed completion event.
 */
export function suiteFormingBarIndex(input: SuiteFinalityInput): number | null {
  if (!input.bars.length || input.replayActive) return null;
  const nowDisplay = currentDisplayEpoch(input.nowMs, input.market, input.symbol);
  if (nowDisplay === null) return formingIndex(input.bars);
  return tfSeconds(input.timeframe) > 0
    ? intradayFormingIndex(input, nowDisplay)
    : dailyDerivedFormingIndex(input, nowDisplay);
}

/** Stable market/session identity for event IDs and memo separation. */
export function suiteSessionIdentity(market: string, extendedHours: boolean, isIntraday = true): string {
  if (!isIntraday) return "daily";
  const normalized = String(market || "unknown").toLowerCase();
  if (normalized === "crypto") return "crypto-24h";
  return `${normalized}-${extendedHours ? "extended" : "regular"}`;
}
