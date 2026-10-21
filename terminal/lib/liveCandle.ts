import type { FormingSnapshot } from "./formingCandles";
import { isExtQuoteCurrent } from "@/lib/extQuoteFreshness";
import { usSessionBucket, usEquitySessionAtDisplayEpoch, us24hCandleClose } from "@/lib/usEquityCalendar";
import { tfSeconds, isIntradayTf, isSecondTf, type Market } from "@/lib/intradayShared";

/**
 * The shape the renderer needs from the quote hub's one-second aggregate lane.
 * `tick*` is the latest completed/updated one-second OHLC window. The plain
 * quote fields remain a measured-real-time fallback for a feed that only
 * publishes its most recent trade.
 */
export type LiveCandleQuote = {
  formingCandles?: FormingSnapshot;
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
  liveCoverage?: "complete" | "partial";
};

export type LiveCandleMutation = {
  bars: LiveCandleBar[];
  bar: LiveCandleBar;
  direction: "up" | "down" | "flat";
  kind: "tick" | "new-bar" | "history-gap";
  changedBars?: LiveCandleBar[];
  coverage?: "complete" | "partial";
  tickKey: string;
};

export type LiveCandleState = {
  bars: LiveCandleBar[] | null;
  bases: Map<number, LiveCandleBar>;
  key: string;
  generationStartedMs: number;
  generation: string;
  revision: number;
};
export const createLiveCandleState = (): LiveCandleState => ({
  bars: null, bases: new Map(), key: "", generationStartedMs: 0, generation: "", revision: -1,
});
const equalBar = (a: LiveCandleBar, b: LiveCandleBar) =>
  a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v &&
  a.liveCoverage === b.liveCoverage;

/** Complete snapshots replace OHLCV. An opaque seed is never an additive volume baseline. */
function mutateFormingCandles(
  bars: LiveCandleBar[], quote: LiveCandleQuote, timeframe: string,
  extHours: boolean, overnight: boolean, state: LiveCandleState, nowMs: number,
): LiveCandleMutation | null | undefined {
  const snapshot = quote.formingCandles;
  if (!snapshot || quote.basis !== "REALTIME" || snapshot.source !== "polygon-live-second" ||
      snapshot.version !== 1 || nowMs - snapshot.asOfMs > 120_000 ||
      snapshot.asOfMs > nowMs + 5_000 || (overnight && quote.extSource === "tiingo_boats")) return undefined;
  const session = overnight ? "24h" : extHours ? "extended" : "regular";
  const key = session + ":" + timeframe;
  const input = snapshot.series[key];
  if (!input?.length) return undefined;
  if (state.bars !== bars || state.key !== key) {
    Object.assign(state, createLiveCandleState(), {
      bars, key, bases: new Map(bars.filter(b => typeof b.time === "number").map(b => [Number(b.time), b])),
    });
  }
  if (snapshot.generationStartedMs < state.generationStartedMs ||
      (snapshot.generation === state.generation && snapshot.revision < state.revision)) return null;
  const tail = bars[bars.length - 1];
  const tailTime = tail ? Number(tail.time) : -Infinity;
  if (tail && !Number.isFinite(tailTime)) return null;
  // A finite second buffer cannot repair a long hidden-tab gap. Ask the existing
  // history loader to reconcile before making the chart look continuous.
  if (isSecondTf(timeframe) && tail && input[0].time > tailTime + tfSeconds(timeframe)) {
    return { bars, bar: tail, changedBars: [], direction: "flat", kind: "history-gap",
      tickKey: snapshot.generation + ":" + snapshot.revision + ":" + key, coverage: "partial" };
  }
  const byTime = new Map(bars.map(b => [Number(b.time), b]));
  const changed: LiveCandleBar[] = [];
  let inserted = false;
  for (const row of input) {
    const existing = byTime.get(row.time);
    // A completed prefix may fill a gap, but never prepend an unrequested day.
    if (!existing && bars.length && row.time < Number(bars[0].time)) continue;
    let bar: LiveCandleBar;
    if (row.complete) {
      bar = { time: row.time, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v, liveCoverage: "complete" };
    } else {
      const base = state.bases.get(row.time);
      bar = { time: row.time, o: base?.o ?? row.o, h: Math.max(base?.h ?? row.h, row.h),
        l: Math.min(base?.l ?? row.l, row.l), c: row.c,
        v: Math.max(base?.v ?? 0, row.v), liveCoverage: "partial" };
    }
    if (!existing || !equalBar(existing, bar)) {
      byTime.set(row.time, bar);
      changed.push(bar);
      if (!existing) inserted = true;
    }
  }
  state.generationStartedMs = snapshot.generationStartedMs;
  state.generation = snapshot.generation;
  state.revision = snapshot.revision;
  if (!changed.length) return null;
  const next = [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time));
  const bar = next[next.length - 1];
  state.bars = next;
  return { bars: next, bar, changedBars: changed.sort((a, b) => Number(a.time) - Number(b.time)),
    direction: tail && bar.c > tail.c ? "up" : tail && bar.c < tail.c ? "down" : "flat",
    kind: inserted ? "new-bar" : "tick",
    tickKey: snapshot.generation + ":" + snapshot.revision + ":" + key,
    coverage: bar.liveCoverage ?? "partial" };
}

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

export function isOvernightTimeframe(timeframe: string): boolean {
  return isIntradayTf(timeframe) && tfSeconds(timeframe) > 0 && tfSeconds(timeframe) <= 12 * 3600;
}

/** Both chart countdowns use the same exchange-local candle and session clock. */
export function liveCandleRemaining(open: number, timeframe: string, market: Market, overnight: boolean, nowMs: number): number | null {
  const span = tfSeconds(timeframe);
  const now = liveDisplayEpoch(nowMs, market);
  if (!isIntradayTf(timeframe) || span <= 0 || !Number.isFinite(open) || now == null || now < open) return null;
  try {
    const close = market === "us" && overnight && isOvernightTimeframe(timeframe)
      ? us24hCandleClose(open, span) : open + span;
    return close == null ? null : close - now;
  } catch (error) {
    // Missing calendar coverage cannot become a guessed session countdown.
    if (error instanceof Error && error.message === "US_SESSION_CLOCK_UNAVAILABLE") return null;
    throw error;
  }
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
  const outsideRth = q.extSource === "tiingo_boats" || (q.marketSession != null && q.marketSession !== "rth");
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
  overnightHours = false,
  state: LiveCandleState = createLiveCandleState(),
  nowMs: number = Date.now(),
): LiveCandleMutation | null {
  if (!quote || !isIntradayTf(timeframe)) return null;
  const overnight = market === "us" && overnightHours && isOvernightTimeframe(timeframe);
  if (market === "us") {
    const formed = mutateFormingCandles(bars, quote, timeframe, extHours, overnight, state, nowMs);
    if (formed !== undefined) return formed;
  }
  if (!bars.length && !overnight) return null;
  const tick = quoteTick(quote, market, extHours || overnight);
  if (!tick) return null;
  const displayEpoch = liveDisplayEpoch(tick.startMs, market);
  if (displayEpoch == null) return null;
  const phase = market === "us" ? usEquitySessionAtDisplayEpoch(displayEpoch) : null;
  // BOATS is admitted only in its real overnight window. Never substitute an unofficial lane.
  if (phase?.session === "overnight" && (!overnight || quote.extSource !== "tiingo_boats")) return null;
  const bucket = market === "us"
    ? usSessionBucket(displayEpoch, tfSeconds(timeframe), overnight ? "24h" : extHours ? "extended" : "regular")
    : Math.floor(displayEpoch / tfSeconds(timeframe)) * tfSeconds(timeframe);
  if (bucket == null) return null;

  const tail = bars[bars.length - 1];
  const tailTime = tail ? typeof tail.time === "number" ? tail.time : Number(tail.time) : -Infinity;
  if ((tail && !Number.isFinite(tailTime)) || bucket < tailTime) return null;

  const direction: LiveCandleMutation["direction"] =
    tail && tick.close > tail.c ? "up" : tail && tick.close < tail.c ? "down" : "flat";
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
    // A one-second aggregate is the complete source window for a 1s candle;
    // revisions can retract its wick and volume as well as expand them.
    if (timeframe === "1s" && quote.tickStartMs === tick.startMs) {
      bar.o = tick.open; bar.h = tick.high; bar.l = tick.low; bar.v = tick.vol;
    }
    if (bar.o === tail.o && bar.h === tail.h && bar.l === tail.l && bar.c === tail.c && bar.v === tail.v) return null;
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
