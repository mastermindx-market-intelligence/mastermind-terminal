import { describe, expect, it } from "vitest";
import {
  buildScenarioHeatBars,
  isScenarioSurfaceV1,
  scenarioToHeatField,
  type ScenarioSurfaceV1,
} from "@/lib/scenarioSurfaceContract";
import type { Time } from "lightweight-charts";

const SCENARIO: ScenarioSurfaceV1 = {
  schema: "options.scenario_surface/v1",
  product_kind: "conditional_price_time_scenario",
  root: "SPY",
  observed_at: "2026-09-18T14:00:00.123456Z", // 10:00 ET
  spot_at_observation: 100,
  price_grid: [95, 100, 105],
  horizons_minutes: [0, 60],
  grids: {
    gex: [[1, null, -1], [2, 3, 4]],
    vex: [[-4, -2, 1], [-3, 0, 5]],
    cex: [[7, 0, -2], [6, -1, -3]],
  },
  zero_crossings: {
    gex: [
      { horizon_minutes: 0, prices: [102.5] },
      { horizon_minutes: 60, prices: [] },
    ],
    vex: [
      { horizon_minutes: 0, prices: [103.333] },
      { horizon_minutes: 60, prices: [100] },
    ],
    cex: [
      { horizon_minutes: 0, prices: [100] },
      { horizon_minutes: 60, prices: [99.25] },
    ],
  },
  source_counts: {
    input: 6,
    valid_snapshot: 6,
    omitted_invalid: 0,
    omitted_scope: 0,
    iv_input: 0,
    iv_solved: 6,
    omitted_iv_unsolved: 0,
  },
  source_clocks: {
    market_observed_at: "2026-09-18T14:00:00.123456Z",
    iv_observed_at: "2026-09-18T13:59:59Z",
    oi_vintage: "2026-09-17",
  },
  expiry_scope: null,
  max_dte_days: 7,
  conventions: {
    r: 0.043,
    q: 0,
    contract_multiplier: 100,
    pct_move: 0.01,
  },
  assumptions: {
    inventory: "fixed_input_oi_snapshot",
    vol_map: "sticky_strike",
    iv_source: "solve_from_mid",
    time: "deterministic_roll_forward_from_input_exp_years",
    dealer_sign: "assumed_long_call_short_put",
    price_axis: "scenario_not_forecast",
    observed_history: false,
  },
  units: {
    gex: "usd_per_1pct_spot_move",
    vex: "usd_delta_per_1_vol_point",
    cex: "usd_delta_per_calendar_day",
  },
  warnings: [
    "modeled conditional field; not observed history",
    "scenario prices are not a predicted path",
  ],
};

const anchor = (hhmm: string): Time => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) as unknown as Time;
};

describe("scenarioSurfaceContract", () => {
  it("accepts the typed conditional contract and rejects history/forecast masquerades", () => {
    expect(isScenarioSurfaceV1(SCENARIO)).toBe(true);
    expect(isScenarioSurfaceV1({ ...SCENARIO, schema: "surface/v1" })).toBe(false);
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      assumptions: { ...SCENARIO.assumptions, observed_history: true },
    })).toBe(false);
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      assumptions: { ...SCENARIO.assumptions, price_axis: "predicted_path" },
    })).toBe(false);
  });

  it("rejects malformed grid dimensions and non-finite scenario cells", () => {
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      grids: { ...SCENARIO.grids, gex: [[1, 2], [3, 4]] },
    })).toBe(false);
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      grids: { ...SCENARIO.grids, cex: [[7, Number.POSITIVE_INFINITY, -2], [6, -1, -3]] },
    })).toBe(false);
  });

  it.each([
    ["gex", "gex"],
    ["vanna", "vex"],
    ["charm", "cex"],
  ] as const)("maps Terminal metric %s to scenario metric %s and transposes horizon-major grids", (metric, sourceMetric) => {
    const field = scenarioToHeatField(SCENARIO, metric);
    expect(field).not.toBeNull();
    expect(field?.kind).toBe("conditional_scenario");
    expect(field?.metric).toBe(metric);
    expect(field?.source_metric).toBe(sourceMetric);
    expect(field?.price_levels).toEqual([95, 100, 105]);
    expect(field?.time_steps).toEqual(["10:00", "11:00"]);
    expect(field?.grid).toEqual([
      [SCENARIO.grids[sourceMetric][0][0], SCENARIO.grids[sourceMetric][1][0]],
      [SCENARIO.grids[sourceMetric][0][1], SCENARIO.grids[sourceMetric][1][1]],
      [SCENARIO.grids[sourceMetric][0][2], SCENARIO.grids[sourceMetric][1][2]],
    ]);
    expect(field?.zero_crossings).toEqual(SCENARIO.zero_crossings[sourceMetric]);
    expect(field?.source_clocks).toEqual(SCENARIO.source_clocks);
  });

  it("preserves null scenario cells as transparent heat cells rather than measured zero", () => {
    const field = scenarioToHeatField(SCENARIO, "gex");
    expect(field).not.toBeNull();
    const bars = buildScenarioHeatBars(field!, anchor);
    expect(bars).toHaveLength(2);
    expect(Number.isNaN(bars[0].cells[1].amount)).toBe(true);
    expect(bars[0].cells[0].amount).toBe(1);
    expect(bars[0].cells[2].amount).toBe(-1);
  });

  it("fails closed if a horizon crosses into another ET session because HH:MM would lose date identity", () => {
    const crossSession: ScenarioSurfaceV1 = {
      ...SCENARIO,
      observed_at: "2026-09-18T23:30:00Z", // 19:30 ET
      source_clocks: {
        ...SCENARIO.source_clocks,
        market_observed_at: "2026-09-18T23:30:00Z",
      },
      horizons_minutes: [0, 300], // 00:30 ET next day
      grids: {
        gex: [[1, null, -1], [2, 3, 4]],
        vex: [[-4, -2, 1], [-3, 0, 5]],
        cex: [[7, 0, -2], [6, -1, -3]],
      },
      zero_crossings: {
        gex: [{ horizon_minutes: 0, prices: [] }, { horizon_minutes: 300, prices: [] }],
        vex: [{ horizon_minutes: 0, prices: [] }, { horizon_minutes: 300, prices: [] }],
        cex: [{ horizon_minutes: 0, prices: [] }, { horizon_minutes: 300, prices: [] }],
      },
    };
    expect(isScenarioSurfaceV1(crossSession)).toBe(true);
    expect(scenarioToHeatField(crossSession, "gex")).toBeNull();
  });

  it("rejects source clocks or vintages from after the market information set", () => {
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      source_clocks: {
        ...SCENARIO.source_clocks,
        market_observed_at: "2026-09-18T14:01:00Z",
      },
    })).toBe(false);
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      source_clocks: {
        ...SCENARIO.source_clocks,
        iv_observed_at: "2026-09-18T14:00:01Z",
      },
    })).toBe(false);
    expect(isScenarioSurfaceV1({
      ...SCENARIO,
      source_clocks: {
        ...SCENARIO.source_clocks,
        oi_vintage: "2026-09-19",
      },
    })).toBe(false);
  });
});
