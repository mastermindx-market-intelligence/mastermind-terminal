import { isExtQuoteCurrent } from "@/lib/extQuoteFreshness";
import { tfSeconds, type Market } from "@/lib/intradayShared";

/**
 * The shape the renderer needs from the quote hub's one-second aggregate lane.
 * `tick*` is the latest completed/updated one-second OHLC window. The plain
 * quote fields remain a measured-real-time fallback for a feed that only
 * publishes its most recent trade.
 */
export type LiveCandleQuote = {
  last?: number | null;
  ts?: number | null;
  basis?: string | null;
  asOfMs?: number | null;
  marketSession?: "pre" | "rth" | "post" | "overnight" | string | null;
  extPrice?: number | null;
  extTs?: number | null;
  extBasis?: string | null;
  extSource?: string;
  extSession?: string;
  extVenue?: string;
  extPriceKind?: string;
  extReceivedTs?: number;
  extPublishedTs?: number;
  extExpiresTs?: number;
  tickOpen?: number | null;
  tickHigh?: number | null;
  tickLow?: number | null;
  tickClose?: number | null;
  tickVol?: number | null;
  tickStartMs?: number | null;
  tickEndMs?: number | null;
};

export type LiveCandleBar = {
  time: string | number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type LiveCandleMutation = {
  bars: LiveCandleBar[];
  bar: LiveCandleBar;
  direction: "up" | "down" | "flat";
  kind: "tick" | "new-bar";
  tickKey: string;
};

const ZONES: Record<Market, string> = {
  us: "America/New_York",
  ca: "America/Toronto",
  cn: "Asia/Shanghai",
  hk: "Asia/Hong_Kong",
  crypto: "UTC",
};

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
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
  return fmt;
}

/**
 * A true UTC instant -> this app's intraday "display epoch": exchange-local
 * wall-clock components interpreted as UTC. That is the same convention used
 * by the REST intraday loader, so a streamed 09:30:01 ET print lands on the
 * 09:30:01 candle instead of four/five hours to its right.
 */
export function liveDisplayEpoch(utcMs: number, market: Market): number | null {
  if (!Number.isFinite(utcMs) || utcMs <= 0) return null;
  const parts: Record<string, string> = {};
  for (const part of formatter(ZONES[market]).formatToParts(utcMs)) parts[part.type] = part.value;
  const epoch = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  ) / 1000;
  return Number.isFinite(epoch) ? epoch : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function usSessionBounds(extHours: boolean): { start: number; end: number } {
  return extHours
    ? { start: 4 * 60, end: 20 * 60 }
    : { start: 9 * 60 + 30, end: 16 * 60 };
}

function minuteOfDay(displayEpoch: number): number {
  return ((Math.floor(displayEpoch / 60) % 1440) + 1440) % 1440;
}

function isInsideSelectedSession(displayEpoch: number, market: Market, extHours: boolean): boolean {
  if (market !== "us") return true;
  const { start, end } = usSessionBounds(extHours);
  const minute = minuteOfDay(displayEpoch);
  return minute >= start && minute < end;
}

function bucketStart(displayEpoch: number, timeframe: string, market: Market, extHours: boolean): number | null {
  const span = tfSeconds(timeframe);
  if (!Number.isFinite(span) || span <= 0) return null;
  if (market !== "us") return Math.floor(displayEpoch / span) * span;
  const { start } = usSessionBounds(extHours);
  const dayStart = Math.floor(displayEpoch / 86_400) * 86_400;
  const anchor = dayStart + start * 60;
  return anchor + Math.floor((displayEpoch - anchor) / span) * span;
}

type TickShape = {
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  startMs: number;
  endMs: number;
};

function quoteTick(q: LiveCandleQuote, market: Market, extHours: boolean): TickShape | null {
  // During U.S. extended hours the canonical quote lane intentionally remains
  // the regular-session close. Use the explicit ext lane when that is the
  // session the chart opted into; it is a price tick rather than an OHLC packet.
  const outsideRth = q.marketSession != null && q.marketSession !== "rth";
  if (market === "us" && outsideRth) {
    if (!extHours) return null;
    const price = positive(q.extPrice);
    const sec = finiteNonNegative(q.extTs);
    if (price == null || sec == null || q.extBasis !== "LIVE" || !isExtQuoteCurrent(q)) return null;
    return { open: price, high: price, low: price, close: price, vol: 0, startMs: sec * 1000, endMs: sec * 1000 };
  }

  // A U.S. candle moves only on a freshness measurement. `LIVE` is retained
  // for pre-existing non-U.S. real-time lanes; it is not enough to make a U.S.
  // Stocks-Advanced claim.
  if (market === "us" ? q.basis !== "REALTIME" : q.basis !== "LIVE" && q.basis !== "REALTIME") return null;

  const tickClose = positive(q.tickClose);
  const tickStart = finiteNonNegative(q.tickStartMs);
  if (tickClose != null && tickStart != null) {
    const open = positive(q.tickOpen) ?? tickClose;
    const high = Math.max(open, tickClose, positive(q.tickHigh) ?? -Infinity);
    const low = Math.min(open, tickClose, positive(q.tickLow) ?? Infinity);
    return {
      open,
      high,
      low,
      close: tickClose,
      vol: finiteNonNegative(q.tickVol) ?? 0,
      startMs: tickStart,
      endMs: finiteNonNegative(q.tickEndMs) ?? tickStart,
    };
  }

  const price = positive(q.last);
  const fallbackMs = finiteNonNegative(q.asOfMs) ?? ((finiteNonNegative(q.ts) ?? 0) * 1000);
  if (price == null || fallbackMs <= 0) return null;
  return { open: price, high: price, low: price, close: price, vol: 0, startMs: fallbackMs, endMs: fallbackMs };
}

/**
 * Patch the developing candle or append the first candle in a new bucket.
 * Older/out-of-session/unmeasured quotes are strict no-ops. The returned array
 * is new; the input is never mutated, which keeps ChartPanel's identity-keyed
 * caches and crosshair lookup honest.
 */
export function mutateLiveCandle(
  bars: LiveCandleBar[],
  quote: LiveCandleQuote | null | undefined,
  timeframe: string,
  market: Market,
  extHours: boolean,
): LiveCandleMutation | null {
  if (!bars.length || !quote) return null;
  const tick = quoteTick(quote, market, extHours);
  if (!tick) return null;
  const displayEpoch = liveDisplayEpoch(tick.startMs, market);
  if (displayEpoch == null || !isInsideSelectedSession(displayEpoch, market, extHours)) return null;
  const bucket = bucketStart(displayEpoch, timeframe, market, extHours);
  if (bucket == null) return null;

  const tail = bars[bars.length - 1];
  const tailTime = typeof tail.time === "number" ? tail.time : Number(tail.time);
  if (!Number.isFinite(tailTime) || bucket < tailTime) return null;

  const direction: LiveCandleMutation["direction"] =
    tick.close > tail.c ? "up" : tick.close < tail.c ? "down" : "flat";
  // A provider may revise the still-forming one-second aggregate more than once. Close can stay
  // flat while a wick or volume expands, so identity must include the complete packet shape.
  const tickKey = `${tick.startMs}|${tick.endMs}|${tick.open}|${tick.high}|${tick.low}|${tick.close}|${tick.vol}`;

  if (bucket === tailTime) {
    const bar: LiveCandleBar = {
      ...tail,
      h: Math.max(tail.h, tick.high, tick.close),
      l: Math.min(tail.l, tick.low, tick.close),
      c: tick.close,
      // A REST-loaded partial bucket may already contain this one-second
      // aggregate. `max` preserves truthful 1s volume without double-counting
      // the first streamed packet into a wider bucket.
      v: Math.max(tail.v, tick.vol),
    };
    if (bar.h === tail.h && bar.l === tail.l && bar.c === tail.c && bar.v === tail.v) return null;
    return { bars: [...bars.slice(0, -1), bar], bar, direction, kind: "tick", tickKey };
  }

  const bar: LiveCandleBar = {
    time: bucket,
    o: tick.open,
    h: Math.max(tick.open, tick.high, tick.close),
    l: Math.min(tick.open, tick.low, tick.close),
    c: tick.close,
    v: tick.vol,
  };
  return { bars: [...bars, bar], bar, direction, kind: "new-bar", tickKey };
}
