import { isOvernightTimeframe, mutateLiveCandle, type LiveCandleBar, type LiveCandleQuote } from "./liveCandle";
import { isSecondTf } from "./intradayShared";
import { hasUnexpectedHistoryContraction } from "./intradayHistoryCoverage";

type RefreshBody = {
  t?: unknown; tf?: unknown; bars?: unknown; error?: unknown;
  boats_history?: { observed_at_utc?: unknown; live_history?: { observed_at_utc?: unknown } };
  daytime_cache?: { assembled_at?: unknown; refresh_pending?: unknown; assembly_complete?: unknown;
    refresh_error?: unknown; meaning?: unknown };
};

/** Keep time anchors and the user's fractional/blank-space scroll positions. */
export function boatsRefreshLogicalRange(
  before: Pick<LiveCandleBar, "time">[], after: Pick<LiveCandleBar, "time">[],
  range: { from: number; to: number } | null,
): { from: number; to: number } | null {
  if (!range || !before.length || !after.length || !Number.isFinite(range.from)
      || !Number.isFinite(range.to) || range.to <= range.from) return null;
  const old = before.map(bar => Number(bar.time)), next = after.map(bar => Number(bar.time));
  if ([...old, ...next].some(time => !Number.isFinite(time))) return null;
  const indexAt = (time: number) => {
    let lo = 0, hi = next.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (next[mid] < time) lo = mid + 1; else hi = mid; }
    if (lo === 0) return 0;
    if (lo === next.length) return next.length - 1;
    if (next[lo] === time) return lo;
    return lo - 1 + (time - next[lo - 1]) / (next[lo] - next[lo - 1]);
  };
  const map = (x: number) => {
    if (x < 0) return indexAt(old[0]) + x;
    if (x >= old.length - 1) return indexAt(old[old.length - 1]) + x - (old.length - 1);
    const left = Math.floor(x), fraction = x - left;
    return indexAt(old[left] + fraction * (old[left + 1] - old[left]));
  };
  const result = { from: map(range.from), to: map(range.to) };
  return result.to > result.from ? result : null;
}

/** Accept one complete route response; never combine two vendor OHLCV revisions. */
export function boatsChartRefresh(
  body: RefreshBody | null, symbol: string, timeframe: string,
  quote: LiveCandleQuote | null | undefined, previousCaptureMs: number,
  nowMs = Date.now(), latestAcceptedTradeMs = 0, currentBars: Pick<LiveCandleBar, "time">[] = [],
): { bars: LiveCandleBar[]; captureMs: number; appliedTradeMs: number } | null {
  if (!body || body.error || body.t !== symbol || body.tf !== timeframe
      || !isOvernightTimeframe(timeframe) || isSecondTf(timeframe)
      || !Array.isArray(body.bars) || body.bars.length > 20_000) return null;
  // A valid BOATS receipt does not certify the separate daytime leg. Retain the
  // already-painted chart while the server builds (or fails) its daytime baseline.
  // A refresh may be pending while the server serves a previously COMPLETE,
  // source-verified cached assembly. Only a pending *incomplete or unknown*
  // snapshot is provisional; do not starve the chart during warm revalidation.
  if (body.daytime_cache?.assembly_complete === false
      || (body.daytime_cache?.refresh_pending === true && body.daytime_cache?.assembly_complete !== true)) return null;
  const observed = body.boats_history?.observed_at_utc;
  const stamps = Array.isArray(observed) ? [...observed] : [];
  const live = body.boats_history?.live_history?.observed_at_utc;
  if (typeof live === "string") stamps.push(live);
  const valid = stamps.filter((x): x is string => typeof x === "string").map(Date.parse);
  if (valid.some(x => !Number.isFinite(x) || x > nowMs + 5_000)) return null;
  const daytimeOnly = valid.length === 0;
  if (daytimeOnly) {
    // A cold first response can precede the bounded daytime refresh. Admit its
    // successful completion without fabricating a BOATS capture timestamp or
    // withdrawing any overnight history/trade already accepted by this chart.
    const daytime = body.daytime_cache;
    const assembled = typeof daytime?.assembled_at === "string" ? Date.parse(daytime.assembled_at) : NaN;
    const hasOvernightBars = currentBars.some(bar => {
      const hour = new Date(Number(bar.time) * 1000).getUTCHours();
      return !Number.isFinite(hour) || hour < 4 || hour >= 20;
    });
    if (previousCaptureMs !== 0 || hasOvernightBars || latestAcceptedTradeMs !== 0 || quote?.extSource === "tiingo_boats"
        || daytime?.meaning !== "daytime_assembly_not_market_data_freshness"
        || daytime.refresh_pending !== false || daytime.refresh_error !== null
        || !Number.isFinite(assembled) || assembled > nowMs + 5_000 || !body.bars.length) return null;
  }
  const captureMs = daytimeOnly ? 0 : Math.max(...valid);
  if (captureMs < previousCaptureMs) return null;
  let last = -Infinity;
  const bars: LiveCandleBar[] = [];
  for (const row of body.bars) {
    if (!Array.isArray(row) || row.length !== 6 || row.some(x => typeof x !== "number" || !Number.isFinite(x))) return null;
    const [time, o, h, l, c, v] = row as number[];
    if (!Number.isInteger(time) || time <= last || time < 946684800 || time >= 4102444800
        || Math.min(o, h, l, c) <= 0 || v < 0 || l > Math.min(o, c) || h < Math.max(o, c)) return null;
    const hour = new Date(time * 1000).getUTCHours(); // already an ET display epoch
    if (daytimeOnly && (hour < 4 || hour >= 20)) return null;
    bars.push({ time, o, h, l, c, v }); last = time;
  }
  // A trade observed after the REST capture can remain provisional. An older
  // quote must not undo a vendor correction or an authoritative cancellation.
  const newerQuote = quote?.extSource === "tiingo_boats" && typeof quote.extTs === "number"
    && quote.extTs * 1000 > captureMs && quote.extTs * 1000 >= latestAcceptedTradeMs;
  const mutation = newerQuote ? mutateLiveCandle(bars, quote, timeframe, "us", true, true) : null;
  if (captureMs < latestAcceptedTradeMs && !mutation) return null;
  const nextBars = mutation?.bars ?? bars;
  // A vendor capture can succeed yet contain a severely truncated historical
  // tail. Keep the existing chart (and its indicators/viewport) until the
  // server can provide comparable coverage. Empty vendor windows remain
  // eligible for the established authoritative cancellation behavior.
  if (hasUnexpectedHistoryContraction(currentBars.length, nextBars.length)) return null;
  return { bars: nextBars, captureMs,
    appliedTradeMs: mutation && typeof quote?.extTs === "number" ? quote.extTs * 1000 : 0 };
}
