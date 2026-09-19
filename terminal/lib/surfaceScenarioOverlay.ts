/**
 * Path-disjoint presentation bridge for the modeled future side of the Options Workbench.
 *
 * It owns no fetch, replay, cache, chart, pricing or publication state. The consumer may
 * mount these primitives into the incumbent SurfacePane after that owner's release gate.
 */
import type { Time } from "lightweight-charts";
import type { HeatData } from "@/lib/heatSeries";
import type {
  ScenarioSourceClocks,
  ScenarioTerminalMetric,
  ScenarioTimeAnchor,
} from "@/lib/scenarioSurfaceContract";
import type { ComposedSurfaceHeat } from "@/lib/surfaceScenarioComposition";

export interface ScenarioContourPoint {
  time: Time;
  price: number;
  horizon_minutes: number;
}

export interface ScenarioContourSegment {
  continuity: "adjacent_horizon_only";
  from: ScenarioContourPoint;
  to: ScenarioContourPoint;
}

export interface ScenarioOverlayDisclosure {
  classification: "conditional_model";
  price_axis: "scenario_not_forecast";
  forecast: false;
  observed_history: false;
  participant_inventory_observed: false;
  inventory_basis: string;
  dealer_sign_basis: string;
  vol_map: string;
  iv_source: string;
  time_basis: string;
  units: string;
  observed_at: string;
  source_clocks: ScenarioSourceClocks;
}

export interface SurfaceScenarioOverlay {
  kind: "conditional_scenario_overlay";
  root: string;
  metric: ScenarioTerminalMetric;
  session_date: string;
  boundary_clock: string;
  boundary_time: Time;
  heat_side: "future_only";
  contour_side: "boundary_and_future";
  heat_bars: HeatData[];
  contour_segments: ScenarioContourSegment[];
  disclosure: ScenarioOverlayDisclosure;
}

function normalizedPrices(prices: number[]): number[] | null {
  if (!Array.isArray(prices) || prices.some((price) => !Number.isFinite(price))) {
    return null;
  }
  const sorted = [...prices].sort((a, b) => a - b);
  return sorted.filter((price, index) => index === 0 || price !== sorted[index - 1]);
}

function matchMonotone(
  left: number[],
  right: number[],
): Array<readonly [number, number]> {
  if (!left.length || !right.length) return [];
  if (left.length > right.length) {
    return matchMonotone(right, left).map(([r, l]) => [l, r] as const);
  }

  const n = left.length;
  const m = right.length;
  const inf = Number.POSITIVE_INFINITY;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(inf));
  const matched = Array.from({ length: n + 1 }, () => Array<boolean>(m + 1).fill(false));
  for (let j = 0; j <= m; j++) dp[0][j] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (j < i) continue;
      const skipCost = dp[i][j - 1];
      const matchCost = dp[i - 1][j - 1] + Math.abs(left[i - 1] - right[j - 1]);
      if (matchCost < skipCost) {
        dp[i][j] = matchCost;
        matched[i][j] = true;
      } else {
        dp[i][j] = skipCost;
      }
    }
  }

  const pairs: Array<readonly [number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (matched[i][j]) {
      pairs.unshift([left[i - 1], right[j - 1]] as const);
      i -= 1;
      j -= 1;
    } else {
      j -= 1;
    }
  }
  return i === 0 ? pairs : [];
}

function cloneHeatBar(bar: HeatData): HeatData {
  return {
    ...bar,
    cells: bar.cells.map((cell) => ({ ...cell })),
  };
}

function validScenarioSemantics(composed: ComposedSurfaceHeat): boolean {
  const assumptions = composed.scenario.assumptions;
  return (
    composed.scenario.from === composed.boundary_time &&
    assumptions.inventory === "fixed_input_oi_snapshot" &&
    assumptions.vol_map === "sticky_strike" &&
    ["provided_iv", "solve_from_mid"].includes(String(assumptions.iv_source)) &&
    assumptions.time === "deterministic_roll_forward_from_input_exp_years" &&
    assumptions.dealer_sign === "assumed_long_call_short_put" &&
    assumptions.price_axis === "scenario_not_forecast" &&
    assumptions.observed_history === false
  );
}

export function buildSurfaceScenarioOverlay(
  composed: ComposedSurfaceHeat,
  anchor: ScenarioTimeAnchor,
): SurfaceScenarioOverlay | null {
  if (
    composed.kind !== "observed_plus_conditional" ||
    composed.scenario.kind !== "conditional_scenario" ||
    !composed.scenario.bars.length ||
    !validScenarioSemantics(composed)
  ) {
    return null;
  }

  const rows = composed.scenario.zero_crossings;
  if (
    rows.length !== composed.scenario.bars.length + 1 ||
    rows[0]?.horizon_minutes !== 0
  ) {
    return null;
  }

  const pricesByRow: number[][] = [];
  let priorHorizon = -1;
  for (const row of rows) {
    if (
      !Number.isInteger(row.horizon_minutes) ||
      row.horizon_minutes <= priorHorizon
    ) {
      return null;
    }
    const prices = normalizedPrices(row.prices);
    if (!prices) return null;
    pricesByRow.push(prices);
    priorHorizon = row.horizon_minutes;
  }

  const times: Time[] = [
    anchor(composed.boundary_time),
    ...composed.scenario.bars.map((bar) => bar.time),
  ];
  const contourSegments: ScenarioContourSegment[] = [];

  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex++) {
    const pairs = matchMonotone(pricesByRow[rowIndex], pricesByRow[rowIndex + 1]);
    for (const [fromPrice, toPrice] of pairs) {
      contourSegments.push({
        continuity: "adjacent_horizon_only",
        from: {
          time: times[rowIndex],
          price: fromPrice,
          horizon_minutes: rows[rowIndex].horizon_minutes,
        },
        to: {
          time: times[rowIndex + 1],
          price: toPrice,
          horizon_minutes: rows[rowIndex + 1].horizon_minutes,
        },
      });
    }
  }

  const assumptions = composed.scenario.assumptions;
  return {
    kind: "conditional_scenario_overlay",
    root: composed.root,
    metric: composed.metric,
    session_date: composed.session_date,
    boundary_clock: composed.boundary_time,
    boundary_time: times[0],
    heat_side: "future_only",
    contour_side: "boundary_and_future",
    heat_bars: composed.scenario.bars.map(cloneHeatBar),
    contour_segments: contourSegments,
    disclosure: {
      classification: "conditional_model",
      price_axis: "scenario_not_forecast",
      forecast: false,
      observed_history: false,
      participant_inventory_observed: false,
      inventory_basis: assumptions.inventory,
      dealer_sign_basis: assumptions.dealer_sign,
      vol_map: assumptions.vol_map,
      iv_source: assumptions.iv_source,
      time_basis: assumptions.time,
      units: composed.scenario.units,
      observed_at: composed.scenario.observed_at,
      source_clocks: { ...composed.scenario.source_clocks },
    },
  };
}
