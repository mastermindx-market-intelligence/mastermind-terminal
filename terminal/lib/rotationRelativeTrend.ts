import { ROTATION_METHOD_RELATIVE_TREND, placeRotation, type RotationPlacement } from "./rotationEligibility";

export { ROTATION_METHOD_RELATIVE_TREND };

/** Frozen W2A feed contract: weekly relative trend of each sector fund against the benchmark, centred on 100.
 * Every field is a measurement or an explicit non-measurement; nothing here is a forecast. */
export const RELATIVE_TREND_SCHEMA = "sector_rotation.relative_trend.v1" as const;
export const RELATIVE_TREND_CENTER = 100 as const;
export const RELATIVE_TREND_BOUNDARY_TOLERANCE = 0.05 as const;
export const RELATIVE_TREND_TRAIL_WEEKS = 12 as const;

export type RelativeTrendStatus = "observed" | "boundary" | "warming_up" | "missing_endpoint" | "invalid_input";

export interface RelativeTrendObservation {
  weekEnd: string;
  x: number | null;
  y: number | null;
  status: RelativeTrendStatus;
  vintage: string;
}

export interface RelativeTrendSeries {
  id: string;
  ticker: string;
  observations: RelativeTrendObservation[];
  reason: string | null;
}

export interface RelativeTrendMethod {
  id: "relative_trend_ema";
  version: "v1";
  center: 100;
  formula: string;
  alphaRule: "2/(span+1)";
  seedRule: "sma_first_span";
  anchor: "2016-01-01";
  warmupWeeks: 120;
  endpointPolicy: "completed_week_last_session_no_backshift";
  basis: "tr";
  benchmark: "SPY";
  calendar: "NYSE";
  timezone: "America/New_York";
  trailWeeks: 12;
  boundaryTolerance: 0.05;
}

export interface SectorRotationRelativeTrend {
  schema: typeof RELATIVE_TREND_SCHEMA;
  asOf: string;
  vintage: string;
  method: RelativeTrendMethod;
  series: Record<string, RelativeTrendSeries>;
}

type Row = Record<string, unknown>;

const STATUSES: readonly RelativeTrendStatus[] = ["observed", "boundary", "warming_up", "missing_endpoint", "invalid_input"];
const COORDINATE_STATUSES: readonly RelativeTrendStatus[] = ["observed", "boundary"];
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,11}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SECTORS = 100;
const MAX_OBSERVATIONS = 600;
const MAX_FORMULA = 200;
const MAX_REASON = 120;
const VALUE_MIN = 1;
const VALUE_MAX = 10000;

/** The fixed policy every feed must restate verbatim; a different value is a different method, not a variant. */
const FIXED_METHOD = {
  id: "relative_trend_ema", version: "v1", center: 100, alpha_rule: "2/(span+1)", seed_rule: "sma_first_span",
  anchor: "2016-01-01", warmup_weeks: 120, endpoint_policy: "completed_week_last_session_no_backshift", basis: "tr",
  benchmark: "SPY", calendar: "NYSE", timezone: "America/New_York", trail_weeks: 12, boundary_tolerance: 0.05,
} as const;
const METHOD_KEYS = [...Object.keys(FIXED_METHOD), "formula"];

const isRow = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const hasKeys = (row: Row, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every(key => Object.hasOwn(row, key))
  && Object.keys(row).every(key => required.includes(key) || optional.includes(key));
const strictDay = (value: unknown): value is string => typeof value === "string" && DAY_PATTERN.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const digest = (value: unknown): value is string => typeof value === "string" && DIGEST_PATTERN.test(value);
const coordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= VALUE_MIN && value <= VALUE_MAX;
const isStatus = (value: unknown): value is RelativeTrendStatus => STATUSES.includes(value as RelativeTrendStatus);
const measures = (status: RelativeTrendStatus): boolean => COORDINATE_STATUSES.includes(status);

function readMethod(value: unknown): RelativeTrendMethod | null {
  if (!isRow(value) || !hasKeys(value, METHOD_KEYS)) return null;
  for (const [key, fixed] of Object.entries(FIXED_METHOD)) if (value[key] !== fixed) return null;
  const formula = value.formula;
  if (typeof formula !== "string" || formula.length === 0 || formula.length > MAX_FORMULA) return null;
  return {
    id: FIXED_METHOD.id, version: FIXED_METHOD.version, center: FIXED_METHOD.center, formula,
    alphaRule: FIXED_METHOD.alpha_rule, seedRule: FIXED_METHOD.seed_rule, anchor: FIXED_METHOD.anchor,
    warmupWeeks: FIXED_METHOD.warmup_weeks, endpointPolicy: FIXED_METHOD.endpoint_policy, basis: FIXED_METHOD.basis,
    benchmark: FIXED_METHOD.benchmark, calendar: FIXED_METHOD.calendar, timezone: FIXED_METHOD.timezone,
    trailWeeks: FIXED_METHOD.trail_weeks, boundaryTolerance: FIXED_METHOD.boundary_tolerance,
  };
}

function readObservation(value: unknown, previous: string | null, asOf: string): RelativeTrendObservation | null {
  if (!isRow(value) || !hasKeys(value, ["week_end", "x", "y", "status", "vintage"])) return null;
  const { week_end: weekEnd, x, y, status, vintage } = value;
  if (!strictDay(weekEnd) || weekEnd > asOf || (previous !== null && weekEnd <= previous)) return null;
  if (!isStatus(status) || !digest(vintage)) return null;
  if (measures(status)) {
    if (!coordinate(x) || !coordinate(y)) return null;
    return { weekEnd, x, y, status, vintage };
  }
  if (x !== null || y !== null) return null;
  return { weekEnd, x: null, y: null, status, vintage };
}

function readSeries(value: unknown, asOf: string): RelativeTrendSeries | null {
  if (!isRow(value) || !hasKeys(value, ["id", "ticker", "kind", "observations"], ["reason"])) return null;
  const { id, ticker, kind, observations, reason } = value;
  if (typeof id !== "string" || !ID_PATTERN.test(id) || typeof ticker !== "string" || !TICKER_PATTERN.test(ticker)) return null;
  if (kind !== "sector" || !Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) return null;
  const rows: RelativeTrendObservation[] = [];
  for (const raw of observations) {
    const observation = readObservation(raw, rows.length > 0 ? rows[rows.length - 1].weekEnd : null, asOf);
    if (!observation) return null;
    rows.push(observation);
  }
  if (Object.hasOwn(value, "reason")) {
    if (rows.length > 0 || typeof reason !== "string" || reason.length === 0 || reason.length > MAX_REASON) return null;
    return { id, ticker, observations: rows, reason };
  }
  return { id, ticker, observations: rows, reason: null };
}

/** Strict reader: any violation returns null so no partially trusted feed reaches the map. */
export function sectorRotationRelativeTrend(data: unknown): SectorRotationRelativeTrend | null {
  if (!isRow(data) || !hasKeys(data, ["meta", "sectors"])) return null;
  const { meta, sectors } = data;
  if (!isRow(meta) || !hasKeys(meta, ["schema", "asOf", "vintage", "method"])) return null;
  if (meta.schema !== RELATIVE_TREND_SCHEMA || !strictDay(meta.asOf) || !digest(meta.vintage)) return null;
  const method = readMethod(meta.method);
  if (!method || !Array.isArray(sectors) || sectors.length > MAX_SECTORS) return null;
  const series: Record<string, RelativeTrendSeries> = {};
  for (const raw of sectors) {
    const entry = readSeries(raw, meta.asOf);
    if (!entry || Object.hasOwn(series, entry.id)) return null;
    series[entry.id] = entry;
  }
  return { schema: RELATIVE_TREND_SCHEMA, asOf: meta.asOf, vintage: meta.vintage, method, series };
}

/** The last completed week at or before the as-of day, whatever its status. A gap is reported, never skipped. */
export function relativeTrendLatest(series: RelativeTrendSeries, asOf?: string): RelativeTrendObservation | null {
  const rows = series.observations;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (asOf === undefined || rows[index].weekEnd <= asOf) return rows[index];
  }
  return null;
}

/** The last N weeks split into runs of consecutive measured weeks; every non-measured week breaks the trail. */
export function relativeTrendTrail(series: RelativeTrendSeries, weeks: number = RELATIVE_TREND_TRAIL_WEEKS): RelativeTrendObservation[][] {
  const span = Number.isInteger(weeks) && weeks > 0 ? weeks : RELATIVE_TREND_TRAIL_WEEKS;
  const window = series.observations.slice(-span);
  const runs: RelativeTrendObservation[][] = [];
  let current: RelativeTrendObservation[] = [];
  for (const observation of window) {
    if (measures(observation.status) && observation.x !== null && observation.y !== null) {
      current.push(observation);
      continue;
    }
    if (current.length > 0) runs.push(current);
    current = [];
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Placement against the centre with the frozen boundary band; a non-measured week is unavailable with its status as the reason. */
export function relativeTrendPlacement(observation: RelativeTrendObservation): RotationPlacement {
  if (!measures(observation.status) || observation.x === null || observation.y === null) {
    return placeRotation(null, null, { measured: false, reasonCode: observation.status });
  }
  return placeRotation(observation.x, observation.y, { center: RELATIVE_TREND_CENTER, boundaryTolerance: RELATIVE_TREND_BOUNDARY_TOLERANCE });
}
