import type { AggPoint, AggStats, AggTrendPayload } from "@/lib/aggTrend";
import type { VolPayload } from "@/components/vol/volTypes";

export interface MovesExpectedMove {
  band_mult: number;
  horizon_days: number;
  pct: number;
  lo: number;
  hi: number;
}

export interface MovesCalibration {
  contained_rate: number;
  n_sessions: number;
  hits: number;
  misses: number;
  band_mult: number;
  since: string;
  through: string;
  ci: [number, number];
}

export interface MovesPayload {
  schema?: string;
  asof?: string;
  root?: string;
  spot_ref?: number | null;
  atm_iv?: number | null;
  regime?: string | null;
  expected_move?: MovesExpectedMove | null;
  calibration?: MovesCalibration | null;
  learned_band_mult?: number | null;
  convention?: string | null;
}

export interface AbsoluteMoveStats {
  n: number;
  since: string | null;
  through: string | null;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  values: number[];
}

export interface SourceReceipt {
  source: "moves" | "vol" | "agg";
  available: boolean;
  asof: string | null;
  detail: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPositiveFinite = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0;

const isIsoDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const epoch = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
};

function sameRoot(value: unknown, root: string): boolean {
  return typeof value === "string" && value.toUpperCase() === root.toUpperCase();
}

export function admitMovesPayload(value: unknown, root: string): MovesPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as MovesPayload;
  if (payload.schema !== "options_hub.moves/v1" || !sameRoot(payload.root, root)) return null;
  const expected = payload.expected_move;
  const calibration = payload.calibration;
  if (!expected || !calibration) return null;
  if (
    !isPositiveFinite(expected.band_mult) ||
    !isPositiveFinite(expected.horizon_days) ||
    !isFiniteNumber(expected.pct) || expected.pct < 0 ||
    !isPositiveFinite(expected.lo) ||
    !isPositiveFinite(expected.hi) ||
    expected.hi < expected.lo ||
    !isFiniteNumber(calibration.contained_rate) || calibration.contained_rate < 0 || calibration.contained_rate > 1 ||
    !Number.isSafeInteger(calibration.n_sessions) || calibration.n_sessions < 1 ||
    !Number.isSafeInteger(calibration.hits) || calibration.hits < 0 ||
    !Number.isSafeInteger(calibration.misses) || calibration.misses < 0 ||
    calibration.hits + calibration.misses !== calibration.n_sessions ||
    !isPositiveFinite(calibration.band_mult) ||
    !isIsoDay(calibration.since) ||
    !isIsoDay(calibration.through) ||
    !Array.isArray(calibration.ci) || calibration.ci.length !== 2 ||
    !isFiniteNumber(calibration.ci[0]) || !isFiniteNumber(calibration.ci[1]) ||
    calibration.ci[0] < 0 || calibration.ci[1] > 1 || calibration.ci[0] > calibration.ci[1]
  ) return null;
  if (payload.asof != null && !isIsoDay(payload.asof)) return null;
  if (payload.spot_ref != null && !isPositiveFinite(payload.spot_ref)) return null;
  if (payload.atm_iv != null && (!isFiniteNumber(payload.atm_iv) || payload.atm_iv < 0)) return null;
  return payload;
}

export function admitVolPayload(value: unknown, root: string): VolPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as VolPayload;
  if (payload.schema !== "options_hub.vol/v1" || !sameRoot(payload.root, root)) return null;
  if (payload.asof != null) {
    if (typeof payload.asof !== "string") return null;
    if (!isIsoDay(payload.asof.slice(0, 10))) return null;
  }
  return payload;
}

export function admitAggPayload(value: unknown, root: string): AggTrendPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as AggTrendPayload;
  if (payload.schema !== "options_hub.aggtrend/v1" || !sameRoot(payload.root, root)) return null;
  if (!Array.isArray(payload.series) || payload.series.length < 2) return null;
  return payload;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/**
 * Consecutive close-to-close absolute moves from the published agg-trend spot series.
 * Invalid rows reset the chain; we never bridge over a missing/non-positive spot and
 * pretend the resulting multi-session move was one day.
 */
export function absoluteSpotMoveStats(series: readonly AggPoint[] | undefined): AbsoluteMoveStats | null {
  if (!Array.isArray(series) || series.length < 2) return null;
  const values: number[] = [];
  let previous: { date: string; spot: number } | null = null;
  let since: string | null = null;
  let through: string | null = null;

  for (const row of series) {
    if (!row || !isIsoDay(row.d) || !isPositiveFinite(row.s)) {
      previous = null;
      continue;
    }
    if (previous) {
      const move = Math.abs((row.s / previous.spot - 1) * 100);
      if (Number.isFinite(move)) {
        values.push(move);
        if (since == null) since = previous.date;
        through = row.d;
      }
    }
    previous = { date: row.d, spot: row.s };
  }
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    n: values.length,
    since,
    through,
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean,
    values,
  };
}

/** Midrank percentile: ties split their rank rather than reading as an extreme. */
export function percentileOf(value: number | null | undefined, sample: readonly number[]): number | null {
  if (!isFiniteNumber(value)) return null;
  const finite = sample.filter(isFiniteNumber);
  if (!finite.length) return null;
  const less = finite.filter((x) => x < value).length;
  const equal = finite.filter((x) => x === value).length;
  return ((less + equal / 2) / finite.length) * 100;
}

export interface HistogramBin {
  lo: number;
  hi: number;
  count: number;
}

export function histogram(values: readonly number[], requestedBins = 12): HistogramBin[] {
  const finite = values.filter((value) => isFiniteNumber(value) && value >= 0);
  if (!finite.length) return [];
  const bins = Math.max(4, Math.min(24, Math.floor(requestedBins)));
  const max = Math.max(...finite);
  const hi = max === 0 ? 1 : max;
  const width = hi / bins;
  const out = Array.from({ length: bins }, (_, index) => ({
    lo: index * width,
    hi: (index + 1) * width,
    count: 0,
  }));
  for (const value of finite) {
    const index = Math.min(bins - 1, Math.floor(value / width));
    out[index].count += 1;
  }
  return out;
}

export function finiteAggStats(payload: AggTrendPayload | null, key: string): AggStats | null {
  const stats = payload?.stats?.[key];
  if (!stats) return null;
  const required = [stats.mean, stats.sd, stats.min, stats.p05, stats.p50, stats.p95, stats.max];
  if (required.some((value) => !isFiniteNumber(value))) return null;
  if (!Number.isSafeInteger(stats.n) || stats.n < 1) return null;
  if (stats.last != null && !isFiniteNumber(stats.last)) return null;
  if (stats.pctile != null && (!isFiniteNumber(stats.pctile) || stats.pctile < 0 || stats.pctile > 100)) return null;
  return stats;
}

export function sourceReceipts(
  moves: MovesPayload | null,
  vol: VolPayload | null,
  agg: AggTrendPayload | null,
): SourceReceipt[] {
  return [
    {
      source: "moves",
      available: moves != null,
      asof: moves?.asof ?? null,
      detail: moves?.calibration
        ? `${moves.calibration.n_sessions} calibration sessions through ${moves.calibration.through}`
        : "expected-move calibration unavailable",
    },
    {
      source: "vol",
      available: vol != null,
      asof: vol?.asof?.slice(0, 10) ?? null,
      detail: vol?.history ? `${vol.history.length} supplied IV-history rows` : "volatility history unavailable",
    },
    {
      source: "agg",
      available: agg != null,
      asof: agg?.asof ?? null,
      detail: agg?.n_days ? `${agg.n_days} aggregate-history sessions` : "aggregate history unavailable",
    },
  ];
}
