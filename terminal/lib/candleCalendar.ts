// Candle timing for the calendar timeframes and the intraday countdown.
//
// This module OWNS NO CALENDAR. Every fact it returns is read out of an existing owner:
//
//   usEquityCalendar   usSessionBucket / us24hCandleClose / usRegularCloseMinute /
//                      isUsEquityTradingDate      — the immutable NYSE projection, incl. early
//                                                   closes and full closures
//   intradayShared     resampleUsEquitySession's bucket rule, HK_SESSION_SEGMENTS and
//                      sessionSegmentBucket        — the segment folding for a split day
//   sessionBars        resampleTf / resolveBarAnchor / dailyMultipleOf — the W/2W/1M/3M grid
//                                                   and the ONE 2D/3D session grid
//
// A bar's start is whatever the owner that PLOTS it would use, so the countdown can never disagree
// with the candle it sits under. Anything those owners cannot establish is `null` — never a
// weekday guess, a borrowed holiday table, or a fixed UTC offset.
//
// EPOCH SPACES (two, and they are not interchangeable)
// ---------------------------------------------------
// * DISPLAY epoch — market-local wall clock read as if UTC (see `liveDisplayEpoch`). This is what
//   the chart axis and every bar `time` use.
// * TRUE UTC — the actual instant. A US close is a wall time in America/New_York, and calling it
//   "16:00Z" is four/five hours wrong depending on DST.
// `intradayCandleWindow` and `calendarCandleCloseDisplay` answer in display epoch;
// `calendarCandleClose` answers in true UTC. Nothing converts between them implicitly.

import {
  isUsEquityTradingDate,
  us24hCandleClose,
  usRegularCloseMinute,
  usSessionBucket,
} from "./usEquityCalendar";
import { usRegularSessionWindow } from "./usEquitySessionClock";
import {
  HK_SESSION_SEGMENTS,
  sessionSegmentBucket,
  tfSeconds,
  type Market,
  type UsEquitySession,
} from "./intradayShared";
import {
  dailyMultipleOf,
  resolveBarAnchor,
  resampleTf,
  sessionBarOpens,
  type SessionAnchor,
  type SessionOhlcBar,
} from "./sessionBars";

const DAY = 86_400;
/** Existing extended-session policy. Deliberately unchanged by this module. */
const US_EXTENDED_END = 20 * 60;

/**
 * CONTINUOUS session HOURS per market — a lunch split and a wall close, never a holiday table.
 * `ca` is hours only: the TSX holiday calendar is not in this repo and must not be borrowed from
 * the US projection.
 */
const CONTINUOUS: Partial<Record<Market, { start: number; end: number }[]>> = {
  hk: HK_SESSION_SEGMENTS,
  cn: [{ start: 9 * 60 + 30, end: 11 * 60 + 30 }, { start: 13 * 60, end: 15 * 60 }],
  ca: [{ start: 9 * 60 + 30, end: 16 * 60 }],
};
const ZONE: Record<Market, string> = {
  us: "America/New_York",
  ca: "America/Toronto",
  cn: "Asia/Shanghai",
  hk: "Asia/Hong_Kong",
  crypto: "UTC",
};

/** Calendar units whose membership `resampleTf` owns. */
const CALENDAR_UNITS = new Set(["W", "2W", "1M", "3M"]);
/** Enough prior sessions to contain a whole 3M bucket. */
const PERIOD_PROBE_DAYS = 100;

export type CandleWindow = { start: number; end: number };
type CandleClose = { utc: number; display: number };

/**
 * What the plotted bars can prove that a display epoch cannot. Both are optional and the answer
 * is `null` without them — a countdown with no owner behind it is a guess.
 */
export type CalendarCloseContext = {
  /** Ascending session dates ("YYYY-MM-DD") the feed actually holds. */
  dailyTimes?: ReadonlyArray<string>;
  /** The published `session_anchor` point; the 2D/3D phase is not derivable without it. */
  publishedSessionAnchor?: SessionAnchor | null;
  /** Authoritative date-specific closes for exchanges without a bundled calendar. */
  sessionCloseMinutes?: Readonly<Record<string, number>>;
};

// ── calendar primitives ──────────────────────────────────────────────────────

function dateEpoch(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000-")) return null;
  const epoch = Date.parse(`${date}T00:00:00Z`) / 1000;
  return Number.isFinite(epoch) && new Date(epoch * 1000).toISOString().slice(0, 10) === date ? epoch : null;
}

/**
 * The session date a plotted bar is keyed by. Daily-derived bars key an ISO date; a numeric key is
 * read on the DISPLAY clock (its UTC components are wall time), which is how crypto's daily bar
 * is keyed.
 */
function barDate(activeBarTime: string | number): string | null {
  if (typeof activeBarTime === "number") {
    if (!Number.isFinite(activeBarTime)) return null;
    return new Date(Math.floor(activeBarTime / DAY) * DAY * 1000).toISOString().slice(0, 10);
  }
  return dateEpoch(activeBarTime) == null ? null : activeBarTime;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function zoneParts(utcMs: number, zone: string): Record<string, string> | null {
  let fmt = FORMATTERS.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    FORMATTERS.set(zone, fmt);
  }
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) out[part.type] = part.value;
  return Number.isFinite(+out.year) && Number.isFinite(+out.month) && Number.isFinite(+out.day) ? out : null;
}

/** Seconds `zone` is AHEAD of UTC at `utcMs`, or null if the zone cannot be read. */
function zoneOffsetSeconds(utcMs: number, zone: string): number | null {
  const parts = zoneParts(utcMs, zone);
  if (!parts) return null;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 1000);
}

/**
 * `minuteOfDay` on `date` in `zone` -> the TRUE UTC second it happens at.
 *
 * The offset is MEASURED in that zone on that date, so a summer close and a winter close differ
 * by exactly the DST hour instead of by a hardcoded -5. The result is then re-read through the
 * zone: a wall time that does not exist there (the spring-forward gap) or that lands on another
 * date is a bad answer and returns null rather than a plausible one.
 */
export function exchangeWallCloseUtc(zone: string, date: string, minuteOfDay: number): number | null {
  const day = dateEpoch(date);
  if (day == null || !Number.isFinite(minuteOfDay)) return null;
  const wall = (day + minuteOfDay * 60) * 1000;
  const guess = wall - (zoneOffsetSeconds(wall, zone) ?? NaN) * 1000;
  if (!Number.isFinite(guess)) return null;
  // The offset in force at the candidate may differ from the one guessed (a DST edge); settle on
  // it and prove the answer round-trips through the zone before returning it.
  const settled = wall - (zoneOffsetSeconds(guess, zone) ?? NaN) * 1000;
  const parts = Number.isFinite(settled) ? zoneParts(settled, zone) : null;
  if (!parts || zoneOffsetSeconds(settled, zone) !== (wall - settled) / 1000) return null;
  if (parts.year !== date.slice(0, 4) || parts.month !== date.slice(5, 7) || parts.day !== date.slice(8, 10)
    || +parts.hour % 24 !== Math.floor(minuteOfDay / 60) || +parts.minute !== minuteOfDay % 60) return null;
  return Math.round(settled / 1000);
}

// ── intraday window ──────────────────────────────────────────────────────────

/**
 * The candle `openOrEventDisplayEpoch` belongs to, in display-epoch seconds.
 *
 * `openOrEventDisplayEpoch` may be the candle's own open or any print inside it — the bucket is
 * derived, so an in-flight tick answers the same candle its bar does. `null` means the owners
 * cannot place it (outside US projection coverage, a closed session, an unusable tf).
 *
 * The END is where the calendar, not the grid, decides: a 13:30 four-hour US bar ends at the
 * ACTUAL 16:00 close, and at 13:00 on an early-close day, because a candle may not promise data
 * the session never produces.
 */
export function intradayCandleWindow(
  openOrEventDisplayEpoch: number,
  tf: string,
  market: Market,
  session: UsEquitySession,
): CandleWindow | null {
  const span = tfSeconds(tf);
  if (!Number.isFinite(openOrEventDisplayEpoch) || !Number.isFinite(span) || span <= 0) return null;

  if (market === "us") {
    const mode = session === "24h" ? "24h" : session === "extended" ? "extended" : "regular";
    let start: number | null;
    try {
      start = usSessionBucket(openOrEventDisplayEpoch, span, mode);
    } catch {
      return null; // outside the canonical projection — a missing calendar is not a close
    }
    if (start == null) return null;
    if (session === "24h") {
      let end: number | null;
      try {
        end = us24hCandleClose(start, span);
      } catch {
        return null;
      }
      return end == null ? null : { start, end };
    }
    let closeMinute: number | null;
    try {
      closeMinute = session === "extended" ? US_EXTENDED_END : usRegularSessionWindow(start)?.[1] ?? null;
    } catch {
      return null;
    }
    if (closeMinute == null) return null;
    const end = Math.min(start + span, Math.floor(start / DAY) * DAY + closeMinute * 60);
    return end > start ? { start, end } : null;
  }

  if (market === "hk") {
    const bucket = sessionSegmentBucket(openOrEventDisplayEpoch, span / 60, HK_SESSION_SEGMENTS);
    if (!bucket) return null;
    return { start: bucket.start, end: Math.min(bucket.start + span, bucket.segmentEnd) };
  }

  // cn / ca / crypto keep the existing ABSOLUTE display-epoch grid. A bar is only clipped where a
  // real continuous session actually overlaps it — a grid bar sitting wholly in the CN lunch
  // break has no session behind it and is left exactly as the chart plots it.
  const start = Math.floor(openOrEventDisplayEpoch / span) * span;
  const day = Math.floor(start / DAY) * DAY;
  const overlaps = CONTINUOUS[market]?.filter(segment =>
    day + segment.start * 60 < start + span && day + segment.end * 60 > start);
  const last = overlaps?.at(-1);
  const end = last ? Math.min(start + span, day + last.end * 60) : start + span;
  return end > start ? { start, end } : null;
}

// ── calendar close ───────────────────────────────────────────────────────────

/** A US session's real close — the projection's own minute, including an early close. */
function usSessionClose(date: string): CandleClose | null {
  let closeMinute: number | null;
  try {
    closeMinute = usRegularCloseMinute(date);
  } catch {
    return null; // outside the projection's coverage
  }
  const day = dateEpoch(date);
  if (closeMinute == null || day == null) return null; // a full closure is not a candle close
  const utc = exchangeWallCloseUtc(ZONE.us, date, closeMinute);
  return utc == null ? null : { utc, display: day + closeMinute * 60 };
}

/** Next session from the projection; coverage failure stops the walk. */
function nextUsSession(date: string): string | null {
  const day = dateEpoch(date);
  if (day == null) return null;
  for (let step = 1; step <= 14; step++) {
    const candidate = new Date((day + step * DAY) * 1000).toISOString().slice(0, 10);
    try { if (isUsEquityTradingDate(candidate)) return candidate; }
    catch { return null; }
  }
  return null;
}
const nextCalendarDay = (date: string): string | null => {
  const day = dateEpoch(date);
  return day == null ? null : new Date((day + DAY) * 1000).toISOString().slice(0, 10);
};
const cryptoSessionClose = (date: string): CandleClose | null => {
  const day = dateEpoch(date);
  return day == null ? null : { utc: day + DAY, display: day + DAY };
};

// Ask the plotting owner when membership changes. Two synthetic rows are enough:
// no fortnight formula, weekday rule or history-slice phase is duplicated here.
const BOUNDARIES = new Map<string, number>();
function calendarBoundary(date: string, tf: string): number | null {
  const key = date + ":" + tf;
  const cached = BOUNDARIES.get(key);
  if (cached != null) return cached;
  const day = dateEpoch(date);
  if (day == null || !CALENDAR_UNITS.has(tf)) return null;
  const row = (time: string): SessionOhlcBar => ({ time, o: 1, h: 1, l: 1, c: 1, v: 0 });
  for (let step = 1; step <= PERIOD_PROBE_DAYS; step++) {
    const epoch = day + step * DAY;
    const candidate = new Date(epoch * 1000).toISOString().slice(0, 10);
    if (resampleTf([row(date), row(candidate)], tf).length === 2) {
      if (BOUNDARIES.size >= 128) BOUNDARIES.delete(BOUNDARIES.keys().next().value!);
      BOUNDARIES.set(key, epoch);
      return epoch;
    }
  }
  return null;
}

function projectedPeriodClose(date: string, tf: string, market: "us" | "crypto"): CandleClose | null {
  const end = calendarBoundary(date, tf);
  const active = dateEpoch(date);
  if (end == null || active == null) return null;
  if (market === "crypto") return { utc: end, display: end };
  try {
    if (!isUsEquityTradingDate(date)) return null;
    for (let day = end - DAY; day >= active; day -= DAY) {
      const candidate = new Date(day * 1000).toISOString().slice(0, 10);
      if (isUsEquityTradingDate(candidate)) return usSessionClose(candidate);
    }
  } catch { return null; } // cannot prove a period end outside calendar coverage
  return null;
}

/**
 * The 2D/3D close, on the ONE global session grid.
 *
 * The bar opens on `date`; its global index is the resolved anchor plus that session's row, and
 * the bar closes on the first global index ≡ 0 (mod mult) — so a bar opening on a multiple is the
 * forced first partial and completes inside its OWN session. Held sessions answer first; only when
 * the feed runs out does the walk continue over the strict US projection. No IPO phase is
 * inferred, and `floor(i / mult)` — a different grid in a different phase — never appears.
 */
function dailyMultipleClose(
  date: string,
  mult: number,
  context: CalendarCloseContext | null,
  nextSession: (d: string) => string | null,
  closeOf: (d: string) => CandleClose | null,
): CandleClose | null {
  const times = context?.dailyTimes;
  if (!times?.length) return null; // no held session sequence -> the phase is unknown, not zero
  const openingRow = times.indexOf(date);
  if (openingRow < 0) return null; // not a session this feed holds at all
  const barAnchor = resolveBarAnchor(times, context?.publishedSessionAnchor ?? null);
  // A bar is keyed by its OPENING session; a session in the middle of one is not a bar key. The
  // owner decides which rows those are, so this cannot phase-drift from the plotted grid.
  if (!sessionBarOpens(times.length, mult, barAnchor).includes(openingRow)) return null;
  let left = (mult - ((barAnchor + openingRow) % mult)) % mult;
  let last = date;
  let row = openingRow;
  while (left > 0) {
    const held = row + 1 < times.length ? times[row + 1] : null;
    if (held != null && dateEpoch(held) != null) {
      row += 1;
      last = held;
    } else {
      const projected = nextSession(last);
      if (projected == null) return null; // projection exhausted; never invent a session
      last = projected;
    }
    left -= 1;
  }
  return closeOf(last);
}

function resolveCalendarClose(
  activeBarTime: string | number,
  tf: string,
  market: Market,
  context: CalendarCloseContext | null,
): CandleClose | null {
  const date = barDate(activeBarTime);
  if (date == null) return null;
  const mult = dailyMultipleOf(tf);

  if (market === "us") {
    if (tf === "D") return usSessionClose(date);
    if (mult != null) return dailyMultipleClose(date, mult, context, nextUsSession, usSessionClose);
    if (!CALENDAR_UNITS.has(tf)) return null;
    return projectedPeriodClose(date, tf, "us");
  }

  if (market === "crypto") {
    if (tf === "D") return cryptoSessionClose(date);
    if (mult != null) return dailyMultipleClose(date, mult, context, nextCalendarDay, cryptoSessionClose);
    if (!CALENDAR_UNITS.has(tf)) return null;
    return projectedPeriodClose(date, tf, "crypto");
  }

  // An observed daily bar proves the exchange traded, not its closing hour
  // (HK/CA also have half-days). Require date-specific calendar authority.
  const times = context?.dailyTimes;
  const closeOf = (sessionDate: string): CandleClose | null => {
    const minute = context?.sessionCloseMinutes?.[sessionDate];
    const day = dateEpoch(sessionDate);
    if (day == null || minute == null || minute < 0 || minute >= 1440) return null;
    const utc = exchangeWallCloseUtc(ZONE[market], sessionDate, minute);
    return utc == null ? null : { utc, display: day + minute * 60 };
  };
  if (!times?.includes(date)) return null;
  if (tf === "D") return closeOf(date);
  if (mult != null) return dailyMultipleClose(date, mult, context, () => null, closeOf);
  // Held prices do not prove holiday coverage or the final eligible session.
  return null;
}

/**
 * When the candle PLOTTED at `activeBarTime` completes, as TRUE UTC epoch seconds — or null when
 * that is not knowable.
 *
 * Anchored to the bar the caller actually holds, never to "now": a chart scrolled back three
 * months is still answered about the candle under the cursor. Null is the honest answer for an
 * unknown holiday, an out-of-projection date, an unproven exchange close, or a 2D/3D
 * feed whose session grid was never published.
 */
export function calendarCandleClose(
  activeBarTime: string | number,
  tf: string,
  market: Market,
  context?: CalendarCloseContext | null,
): number | null {
  return resolveCalendarClose(activeBarTime, tf, market, context ?? null)?.utc ?? null;
}

/** The same close on the DISPLAY clock, for comparing against bar times on the chart axis. */
export function calendarCandleCloseDisplay(
  activeBarTime: string | number,
  tf: string,
  market: Market,
  context?: CalendarCloseContext | null,
): number | null {
  return resolveCalendarClose(activeBarTime, tf, market, context ?? null)?.display ?? null;
}

/**
 * Seconds left on a candle, for presentation only — `max(0, close - now)`.
 *
 * `displayNow` MUST come from the caller's own `liveDisplayEpoch` and be compared against
 * `calendarCandleCloseDisplay`. This deliberately creates nothing: an elapsed candle reads zero,
 * and no empty candle is fabricated to hold a countdown.
 */
export function candleCountdownSeconds(close: number, displayNow: number): number {
  return Number.isFinite(close) && Number.isFinite(displayNow) ? Math.max(0, close - displayNow) : 0;
}
