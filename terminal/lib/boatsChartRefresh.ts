import { isOvernightTimeframe, mutateLiveCandle, type LiveCandleBar, type LiveCandleQuote } from "./liveCandle";
import { isSecondTf } from "./intradayShared";

type RefreshBody = {
  t?: unknown; tf?: unknown; bars?: unknown; error?: unknown;
  boats_history?: { observed_at_utc?: unknown; live_history?: { observed_at_utc?: unknown } };
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
  nowMs = Date.now(), latestAcceptedTradeMs = 0,
): { bars: LiveCandleBar[]; captureMs: number } | null {
  if (!body || body.error || body.t !== symbol || body.tf !== timeframe
      || !isOvernightTimeframe(timeframe) || isSecondTf(timeframe)
      || !Array.isArray(body.bars) || body.bars.length > 20_000) return null;
  const observed = body.boats_history?.observed_at_utc;
  const stamps = Array.isArray(observed) ? [...observed] : [];
  const live = body.boats_history?.live_history?.observed_at_utc;
  if (typeof live === "string") stamps.push(live);
  const valid = stamps.filter((x): x is string => typeof x === "string").map(Date.parse);
  if (!valid.length || valid.some(x => !Number.isFinite(x) || x > nowMs + 5_000)) return null;
  const captureMs = Math.max(...valid);
  if (captureMs < previousCaptureMs) return null;
  let last = -Infinity;
  const bars: LiveCandleBar[] = [];
  for (const row of body.bars) {
    if (!Array.isArray(row) || row.length !== 6 || row.some(x => typeof x !== "number" || !Number.isFinite(x))) return null;
    const [time, o, h, l, c, v] = row as number[];
    if (!Number.isInteger(time) || time <= last || time < 946684800 || time >= 4102444800
        || Math.min(o, h, l, c) <= 0 || v < 0 || l > Math.min(o, c) || h < Math.max(o, c)) return null;
    bars.push({ time, o, h, l, c, v }); last = time;
  }
  // A trade observed after the REST capture can remain provisional. An older
  // quote must not undo a vendor correction or an authoritative cancellation.
  const newerQuote = quote?.extSource === "tiingo_boats" && typeof quote.extTs === "number"
    && quote.extTs * 1000 > captureMs;
  const mutation = newerQuote ? mutateLiveCandle(bars, quote, timeframe, "us", true, true) : null;
  if (captureMs < latestAcceptedTradeMs && !mutation) return null;
  return { bars: mutation?.bars ?? bars, captureMs };
}
