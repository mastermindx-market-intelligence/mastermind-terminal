import type { FormingSnapshot } from "./formingCandles";
import { isExtQuoteCurrent } from "@/lib/extQuoteFreshness";
import { usEquitySessionAtDisplayEpoch, isUsEquityTradingDate } from "@/lib/usEquityCalendar";
import { usRegularSessionWindow } from "@/lib/usEquitySessionClock";
import { intradayCandleWindow, candleCountdownSeconds } from "@/lib/candleCalendar";
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
  historyFence: Pick<FormingSnapshot, "generation" | "revision" | "asOfMs"> | null;
  bars: LiveCandleBar[] | null;
  bases: Map<number, LiveCandleBar>;
  key: string;
  generationStartedMs: number;
  generation: string;
  revision: number;
};
export const createLiveCandleState = (retained?: FormingSnapshot): LiveCandleState => ({
  historyFence: retained ? { generation: retained.generation, revision: retained.revision, asOfMs: retained.asOfMs } : null,
  bars: null, bases: new Map(), key: "", generationStartedMs: 0, generation: "", revision: -1,
});
/** An accepted history observation fences the retained producer version it saw. */
export const isFormingAfterHistory = (snapshot: FormingSnapshot, fence: LiveCandleState["historyFence"]): boolean =>
  !fence || snapshot.generation !== fence.generation || snapshot.revision > fence.revision;

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
  if (!isFormingAfterHistory(snapshot, state.historyFence)) return null;
  const session = overnight ? "24h" : extHours ? "extended" : "regular";
  const key = session + ":" + timeframe;
  const input = snapshot.series[key];
  if (!input?.length) return undefined;
  if (state.bars !== bars || state.key !== key) {
    const historyFence = state.historyFence;
    Object.assign(state, createLiveCandleState(), {
      historyFence, bars, key, bases: new Map(bars.filter(b => typeof b.time === "number").map(b => [Number(b.time), b])),
    });
  }
  if (snapshot.generationStartedMs < state.generationStartedMs ||
      (snapshot.generation === state.generation && snapshot.revision <= state.revision)) return null;
  if (state.generation && snapshot.generation !== state.generation) {
    // A reconnect starts a new suffix. Preserve every previously accepted
    // candle as its opaque seed until the new producer establishes coverage.
    state.bases = new Map(bars.map(b => [Number(b.time), b]));
  }
  const tail = bars[bars.length - 1];
  const tailTime = tail ? Number(tail.time) : -Infinity;
  if (tail && !Number.isFinite(tailTime)) return null;
  // Seconds retain only a bounded window; minute snapshots retain one session
  // date. Neither can fill history outside that coverage after a hidden tab.
  // Refetch once from the existing loader even if the date gap was a weekend:
  // absence of trades must come from history, not a guessed continuous chart.
  let sessionGap = false;
  if (tail && Math.floor(input[0].time / 86400) > Math.floor(tailTime / 86400)) {
    sessionGap = true;
    try {
      const day = Math.floor(tailTime / 86400) * 86400;
      const nextDay = Math.floor(input[0].time / 86400) * 86400;
      const window = intradayCandleWindow(tailTime, timeframe, "us", session);
      const close = session === "regular" ? usRegularSessionWindow(tailTime)?.[1] : 20 * 60;
      if (close != null && window?.end === day + close * 60 && nextDay - day <= 14 * 86400) {
        sessionGap = false;
        for (let d = day + 86400; d < nextDay; d += 86400) {
          if (isUsEquityTradingDate(new Date(d * 1000).toISOString().slice(0, 10))) { sessionGap = true; break; }
        }
      }
    } catch { sessionGap = true; } // unknown coverage requires reconciliation
  }
  if (tail && (sessionGap || (isSecondTf(timeframe) && Math.floor(input[0].time / 86400) === Math.floor(tailTime / 86400) && input[0].time > tailTime + tfSeconds(timeframe)))) {
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
export function liveCandleRemaining(
  open: number, timeframe: string, market: Market, overnight: boolean, nowMs: number, extHours = false,
): number | null {
  const now = liveDisplayEpoch(nowMs, market);
  if (!isIntradayTf(timeframe) || !Number.isFinite(open) || now == null || now < open) return null;
  const window = intradayCandleWindow(open, timeframe, market, overnight ? "24h" : extHours ? "extended" : "regular");
  return window == null ? null : candleCountdownSeconds(window.end, now);
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
  const originalBars = bars;
  let formed: LiveCandleMutation | null | undefined;
  if (market === "us") {
    formed = mutateFormingCandles(bars, quote, timeframe, extHours, overnight, state, nowMs);
    if (formed?.kind === "history-gap") return formed;
    if (formed !== undefined) {
      const latestMs = quote.tickEndMs ?? quote.asOfMs ?? (quote.ts ?? 0) * 1000;
      if (latestMs <= quote.formingCandles!.asOfMs) return formed;
      bars = formed?.bars ?? bars;
    }
  }
  // The wide quote lane may be newer than a retained forming snapshot. Apply its
  // measured tick after snapshot reconciliation, with explicitly partial coverage,
  // and publish ONE mutation/generation for the combined result.
  const finish = (result: LiveCandleMutation | null): LiveCandleMutation | null => {
    if (!result) return formed ?? null;
    if (formed === undefined) return result;
    result.bar.liveCoverage = "partial";
    const changed = new Map((formed?.changedBars ?? []).map(b => [Number(b.time), b]));
    changed.set(Number(result.bar.time), result.bar);
    const before = new Map(originalBars.map(b => [Number(b.time), b]));
    const changedBars = [...changed.values()].filter(b => !before.has(Number(b.time)) || !equalBar(before.get(Number(b.time))!, b));
    if (!changedBars.length) return null;
    state.bars = result.bars;
    return { ...result, changedBars, coverage: "partial",
      kind: changedBars.some(b => !before.has(Number(b.time))) ? "new-bar" : "tick",
      tickKey: `${quote.formingCandles!.generation}:${quote.formingCandles!.revision}:${result.tickKey}` };
  };
  if (!bars.length && !overnight) return finish(null);
  const tick = quoteTick(quote, market, extHours || overnight);
  if (!tick || (state.historyFence && tick.endMs <= state.historyFence.asOfMs)) return finish(null);
  const displayEpoch = liveDisplayEpoch(tick.startMs, market);
  if (displayEpoch == null) return finish(null);
  let phase = null;
  try { phase = market === "us" ? usEquitySessionAtDisplayEpoch(displayEpoch) : null; }
  catch { return finish(null); }
  // BOATS is admitted only in its real overnight window. Never substitute an unofficial lane.
  if (phase?.session === "overnight" && (!overnight || quote.extSource !== "tiingo_boats")) return finish(null);
  const bucket = intradayCandleWindow(displayEpoch, timeframe, market,
    overnight ? "24h" : extHours ? "extended" : "regular")?.start;
  if (bucket == null) return finish(null);

  const tail = bars[bars.length - 1];
  const tailTime = tail ? typeof tail.time === "number" ? tail.time : Number(tail.time) : -Infinity;
  if ((tail && !Number.isFinite(tailTime)) || bucket < tailTime) return finish(null);

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
    if (bar.o === tail.o && bar.h === tail.h && bar.l === tail.l && bar.c === tail.c && bar.v === tail.v) return finish(null);
    return finish({ bars: [...bars.slice(0, -1), bar], bar, direction, kind: "tick", tickKey });
  }

  const bar: LiveCandleBar = {
    time: bucket,
    o: tick.open,
    h: Math.max(tick.open, tick.high, tick.close),
    l: Math.min(tick.open, tick.low, tick.close),
    c: tick.close,
    v: tick.vol,
  };
  return finish({ bars: [...bars, bar], bar, direction, kind: "new-bar", tickKey });
}
