// Display projections only. Canonical OHLC grouping remains in ChartPanel/sessionBars;
// product math remains in mtfMomentum. No score fitting, resampling or trade authority.
import type { MomentumPoint } from "./mtfMomentum";

export const MTF_TIMEFRAMES = ["D", "3D", "W", "2W", "1M"] as const;
export type MtfTimeframe = typeof MTF_TIMEFRAMES[number];
export type MtfPaneKey = "mtfconfluence" | "mtfstoch" | "mtfmacd";
export type MtfMetric = "score" | "stochK" | "stochD" | "rsiMacd" | "rsiSignal";
export const isMtfPaneKey = (key: string): key is MtfPaneKey =>
  key === "mtfconfluence" || key === "mtfstoch" || key === "mtfmacd";

export const MTF_LANES = [
  { tf: "D", enabled: "dOn", color: "dCol" },
  { tf: "3D", enabled: "d3On", color: "d3Col" },
  { tf: "W", enabled: "wOn", color: "wCol" },
  { tf: "2W", enabled: "w2On", color: "w2Col" },
  { tf: "1M", enabled: "mOn", color: "mCol" },
] as const;

/** Undefined flags preserve legacy saved confluence settings; explicit false disables a lane. */
export function selectedMtfLanes(params: Record<string, unknown>) {
  return MTF_LANES.filter((lane) => params[lane.enabled] !== false);
}

export function mtfMetrics(key: MtfPaneKey, showSignal: boolean): MtfMetric[] {
  if (key === "mtfconfluence") return ["score"];
  if (key === "mtfstoch") return showSignal ? ["stochK", "stochD"] : ["stochK"];
  return showSignal ? ["rsiMacd", "rsiSignal"] : ["rsiMacd"];
}

/** Calendar lanes become available at the next observed daily session, never backdated.
 * Daily-multiple completeness uses the same resolved row-zero anchor as canonical grouping.
 * A live-spliced provisional tail cannot qualify a D or 3D observation.
 */
export function mtfKnownAt(
  bars: readonly { time: string; closeTime?: string }[], tf: MtfTimeframe,
  dailyTimes: readonly string[], rowZeroAnchor: number, provisionalTail: boolean,
): (string | null)[] {
  const firstDailyAfter = (time: string): string | null => {
    let low = 0, high = dailyTimes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (dailyTimes[mid] <= time) low = mid + 1; else high = mid;
    }
    return dailyTimes[low] ?? null;
  };
  return bars.map((bar, i) => {
    const tail = i === bars.length - 1;
    if (tf === "D") return tail && provisionalTail ? null : bar.time;
    if (tf === "3D") {
      if (tail && (provisionalTail || (rowZeroAnchor + dailyTimes.length - 1) % 3 !== 0)) return null;
      return bar.closeTime ?? bar.time;
    }
    return firstDailyAfter(bar.time);
  });
}

export type MtfProjectedPoint = { value: number | null; availableSession: string | null };

/** As-of alignment. A raw oscillator does NOT inherit the 78-bar composite warmup. */
export function projectMtfMetric(
  points: readonly MomentumPoint[], knownAt: readonly (string | null)[],
  targetSessions: readonly string[], metric: MtfMetric,
): MtfProjectedPoint[] {
  if (points.length !== knownAt.length) throw new RangeError("MTF values and availability must align");
  let prior: string | null = null, unavailable = false;
  for (const time of knownAt) {
    if (time === null) { unavailable = true; continue; }
    if (unavailable || (prior !== null && time <= prior)) throw new RangeError("MTF availability must be ordered with only an unavailable tail");
    prior = time;
  }
  for (let i = 1; i < targetSessions.length; i++) {
    if (targetSessions[i] < targetSessions[i - 1]) throw new RangeError("MTF target sessions must be ordered");
  }
  let cursor = -1;
  return targetSessions.map((time) => {
    while (cursor + 1 < knownAt.length && knownAt[cursor + 1] !== null && knownAt[cursor + 1]! <= time) cursor++;
    const value = cursor < 0 ? null : points[cursor][metric];
    return { value: value !== null && Number.isFinite(value) ? value : null,
      availableSession: cursor < 0 ? null : knownAt[cursor] };
  });
}
