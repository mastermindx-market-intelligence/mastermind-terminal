/**
 * scenarioSurfaceContract.ts — pure Terminal consumer contract for Macro's
 * options.scenario_surface/v1 conditional price × future-time field.
 *
 * This is deliberately NOT SurfaceFrame: observed replay history and a modeled scenario
 * must remain different types until a view explicitly composes them. No fetch/store/replay
 * ownership lives here.
 */

import type { Time } from "lightweight-charts";
import type { HeatData, HeatCell } from "@/lib/heatSeries";
import { levelBands } from "@/lib/surfaceContract";

export type ScenarioTerminalMetric = "gex" | "vanna" | "charm";
export type ScenarioSourceMetric = "gex" | "vex" | "cex";

export interface ScenarioZeroCrossingRow {
  horizon_minutes: number;
  prices: number[];
}

export interface ScenarioSourceCounts {
  input: number;
  valid_snapshot: number;
  omitted_invalid: number;
  omitted_scope: number;
  iv_input: number;
  iv_solved: number;
  omitted_iv_unsolved: number;
}

export interface ScenarioSourceClocks {
  market_observed_at: string;
  iv_observed_at: string | null;
  oi_vintage: string | null;
  trade_at_first: string | null;
  trade_at_last: string | null;
  quote_at_first: string | null;
  quote_at_last: string | null;
}

export interface ScenarioSurfaceV1 {
  schema: "options.scenario_surface/v1";
  product_kind: "conditional_price_time_scenario";
  root: string;
  observed_at: string;
  spot_at_observation: number;
  price_grid: number[];
  horizons_minutes: number[];
  grids: Record<ScenarioSourceMetric, Array<Array<number | null>>>;
  zero_crossings: Record<ScenarioSourceMetric, ScenarioZeroCrossingRow[]>;
  source_counts: ScenarioSourceCounts;
  source_clocks: ScenarioSourceClocks;
  expiry_scope: string[] | null;
  max_dte_days: number | null;
  conventions: {
    r: number;
    q: number;
    contract_multiplier: number;
    pct_move: number;
  };
  assumptions: {
    inventory: string;
    vol_map: string;
    iv_source: string;
    time: string;
    dealer_sign: string;
    price_axis: "scenario_not_forecast";
    observed_history: false;
  };
  units: Record<ScenarioSourceMetric, string>;
  warnings: string[];
  horizon_meta?: unknown[];
  gamma_zero_crossings?: unknown[];
}

export interface ScenarioHeatField {
  kind: "conditional_scenario";
  root: string;
  metric: ScenarioTerminalMetric;
  source_metric: ScenarioSourceMetric;
  observed_at: string;
  session_date: string;
  spot: number;
  price_levels: number[];
  time_steps: string[];
  /** Price-major: grid[priceIdx][futureTimeIdx]. Null is unknown/unavailable, never zero. */
  grid: Array<Array<number | null>>;
  zero_crossings: ScenarioZeroCrossingRow[];
  source_clocks: ScenarioSourceClocks;
  assumptions: ScenarioSurfaceV1["assumptions"];
  units: string;
}

export type ScenarioTimeAnchor = (hhmm: string) => Time;

const SOURCE_METRIC: Record<ScenarioTerminalMetric, ScenarioSourceMetric> = {
  gex: "gex",
  vanna: "vex",
  charm: "cex",
};

const ET_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonnegativeInt(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
}

function awareInstant(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  // Require an explicit offset/Z. Date.parse accepts naive strings, which are not PIT identity.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) return false;
  return Number.isFinite(Date.parse(value));
}

function etParts(instantMs: number): { date: string; time: string } | null {
  if (!Number.isFinite(instantMs)) return null;
  const parts = ET_FORMAT.formatToParts(new Date(instantMs));
  const get = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  if (!year || !month || !day || !hour || !minute) return null;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function validPriceAxis(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length < 2) return false;
  let prior = -Infinity;
  for (const raw of value) {
    if (!finite(raw) || raw <= 0 || raw <= prior) return false;
    prior = raw;
  }
  return true;
}

function validHorizons(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let prior = -1;
  for (const raw of value) {
    if (!nonnegativeInt(raw) || raw <= prior) return false;
    prior = raw;
  }
  return true;
}

function validGrid(
  value: unknown,
  horizonCount: number,
  priceCount: number,
): value is Array<Array<number | null>> {
  if (!Array.isArray(value) || value.length !== horizonCount) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === priceCount &&
      row.every((cell) => cell === null || finite(cell)),
  );
}

function validZeroRows(
  value: unknown,
  horizons: number[],
): value is ScenarioZeroCrossingRow[] {
  if (!Array.isArray(value) || value.length !== horizons.length) return false;
  return value.every((row, index) => {
    if (!isRecord(row) || row.horizon_minutes !== horizons[index]) return false;
    if (!Array.isArray(row.prices)) return false;
    let prior = -Infinity;
    for (const price of row.prices) {
      if (!finite(price) || price <= prior) return false;
      prior = price;
    }
    return true;
  });
}

function validCounts(value: unknown): value is ScenarioSourceCounts {
  if (!isRecord(value)) return false;
  return [
    "input",
    "valid_snapshot",
    "omitted_invalid",
    "omitted_scope",
    "iv_input",
    "iv_solved",
    "omitted_iv_unsolved",
  ].every((key) => nonnegativeInt(value[key]));
}

function validClockEnvelope(
  first: unknown,
  last: unknown,
  observedMs: number,
): boolean {
  if (first === null && last === null) return true;
  if (first === null || last === null) return false;
  if (!awareInstant(first) || !awareInstant(last)) return false;
  const firstMs = Date.parse(first);
  const lastMs = Date.parse(last);
  return firstMs <= lastMs && lastMs <= observedMs;
}

function validSourceClocks(
  value: unknown,
  observedAt: string,
): value is ScenarioSourceClocks {
  if (!isRecord(value) || value.market_observed_at !== observedAt) return false;
  const observedMs = Date.parse(observedAt);
  const observedEt = etParts(observedMs);
  if (!observedEt) return false;

  const iv = value.iv_observed_at;
  const oi = value.oi_vintage;
  if (iv !== null) {
    if (!awareInstant(iv) || Date.parse(iv) > observedMs) return false;
  }
  if (oi !== null) {
    if (typeof oi !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(oi)) return false;
    if (oi >= observedEt.date) return false;
  }
  if (!validClockEnvelope(value.trade_at_first, value.trade_at_last, observedMs)) return false;
  if (!validClockEnvelope(value.quote_at_first, value.quote_at_last, observedMs)) return false;
  return true;
}

export function isScenarioSurfaceV1(value: unknown): value is ScenarioSurfaceV1 {
  if (!isRecord(value)) return false;
  if (
    value.schema !== "options.scenario_surface/v1" ||
    value.product_kind !== "conditional_price_time_scenario" ||
    typeof value.root !== "string" ||
    !value.root.trim() ||
    !awareInstant(value.observed_at) ||
    !finite(value.spot_at_observation) ||
    value.spot_at_observation <= 0 ||
    !validPriceAxis(value.price_grid) ||
    !validHorizons(value.horizons_minutes)
  ) {
    return false;
  }

  const horizons = value.horizons_minutes;
  const prices = value.price_grid;
  if (!isRecord(value.grids) || !isRecord(value.zero_crossings)) return false;
  for (const metric of ["gex", "vex", "cex"] as const) {
    if (!validGrid(value.grids[metric], horizons.length, prices.length)) return false;
    if (!validZeroRows(value.zero_crossings[metric], horizons)) return false;
  }

  if (!validCounts(value.source_counts)) return false;
  if (!validSourceClocks(value.source_clocks, value.observed_at)) return false;

  if (
    value.expiry_scope !== null &&
    (!Array.isArray(value.expiry_scope) ||
      !value.expiry_scope.every((expiry) => typeof expiry === "string"))
  ) {
    return false;
  }
  if (value.max_dte_days !== null && (!finite(value.max_dte_days) || value.max_dte_days <= 0)) {
    return false;
  }

  if (!isRecord(value.conventions)) return false;
  if (
    !finite(value.conventions.r) ||
    !finite(value.conventions.q) ||
    !finite(value.conventions.contract_multiplier) ||
    value.conventions.contract_multiplier <= 0 ||
    !finite(value.conventions.pct_move) ||
    value.conventions.pct_move <= 0
  ) {
    return false;
  }

  if (!isRecord(value.assumptions)) return false;
  if (
    value.assumptions.observed_history !== false ||
    value.assumptions.price_axis !== "scenario_not_forecast" ||
    value.assumptions.inventory !== "fixed_input_oi_snapshot" ||
    value.assumptions.vol_map !== "sticky_strike" ||
    !["provided_iv", "solve_from_mid"].includes(String(value.assumptions.iv_source)) ||
    value.assumptions.time !== "deterministic_roll_forward_from_input_exp_years" ||
    value.assumptions.dealer_sign !== "assumed_long_call_short_put"
  ) {
    return false;
  }

  if (!isRecord(value.units)) return false;
  if (
    value.units.gex !== "usd_per_1pct_spot_move" ||
    value.units.vex !== "usd_delta_per_1_vol_point" ||
    value.units.cex !== "usd_delta_per_calendar_day"
  ) {
    return false;
  }
  return Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === "string");
}

export function scenarioToHeatField(
  payload: ScenarioSurfaceV1,
  metric: ScenarioTerminalMetric,
): ScenarioHeatField | null {
  if (!isScenarioSurfaceV1(payload)) return null;
  const sourceMetric = SOURCE_METRIC[metric];
  const observedMs = Date.parse(payload.observed_at);
  const start = etParts(observedMs);
  if (!start) return null;

  const timeSteps: string[] = [];
  for (const horizon of payload.horizons_minutes) {
    const point = etParts(observedMs + horizon * 60_000);
    // Existing HeatSeries anchors HH:MM against one session date. Crossing an ET date
    // would erase temporal identity, so v1 fails closed until the consumer becomes date-aware.
    if (!point || point.date !== start.date) return null;
    timeSteps.push(point.time);
  }
  if (new Set(timeSteps).size !== timeSteps.length) return null;

  const horizonMajor = payload.grids[sourceMetric];
  const priceMajor = payload.price_grid.map((_, priceIndex) =>
    horizonMajor.map((row) => row[priceIndex] ?? null),
  );

  return {
    kind: "conditional_scenario",
    root: payload.root,
    metric,
    source_metric: sourceMetric,
    observed_at: payload.observed_at,
    session_date: start.date,
    spot: payload.spot_at_observation,
    price_levels: [...payload.price_grid],
    time_steps: timeSteps,
    grid: priceMajor,
    zero_crossings: payload.zero_crossings[sourceMetric].map((row) => ({
      horizon_minutes: row.horizon_minutes,
      prices: [...row.prices],
    })),
    source_clocks: { ...payload.source_clocks },
    assumptions: { ...payload.assumptions },
    units: payload.units[sourceMetric],
  };
}

export function buildScenarioHeatBars(
  field: ScenarioHeatField,
  anchor: ScenarioTimeAnchor,
): HeatData[] {
  if (
    field.price_levels.length === 0 ||
    field.time_steps.length === 0 ||
    field.grid.length !== field.price_levels.length
  ) {
    return [];
  }
  const bands = levelBands(field.price_levels);
  const bars: HeatData[] = [];
  for (let timeIndex = 0; timeIndex < field.time_steps.length; timeIndex++) {
    const cells: HeatCell[] = bands.map((band, priceIndex) => {
      const value = field.grid[priceIndex]?.[timeIndex];
      return {
        low: band.low,
        high: band.high,
        amount: value === null || value === undefined ? Number.NaN : value,
      };
    });
    bars.push({ time: anchor(field.time_steps[timeIndex]), cells });
  }
  return bars;
}
