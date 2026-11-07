import { describe, expect, it } from "vitest";
import type { Time } from "lightweight-charts";
import type { SurfaceFrame } from "@/lib/surfaceContract";
import type { ScenarioHeatField } from "@/lib/scenarioSurfaceContract";
import { composeObservedScenarioHeat } from "@/lib/surfaceScenarioComposition";

const anchor = (hhmm: string): Time => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) as unknown as Time;
};

const OBSERVED: SurfaceFrame = {
  root: "SPY",
  session_date: "2026-09-18",
  spot: 100,
  price_levels: [95, 100, 105],
  time_steps: ["09:58", "09:59", "10:00"],
  grids: {
    gex: [
      [1, 2, 3],
      [4, 5, 6],
      [-1, -2, -3],
    ],
  },
  asof: "2026-09-18T14:00:00Z",
  cadence: "1-min",
};

const SCENARIO: ScenarioHeatField = {
  kind: "conditional_scenario",
  root: "SPY",
  metric: "gex",
  source_metric: "gex",
  observed_at: "2026-09-18T14:00:00.123456Z",
  session_date: "2026-09-18",
  spot: 100,
  price_levels: [95, 100, 105],
  time_steps: ["10:00", "10:30", "11:00"],
  grid: [
    [10, 11, 12],
    [20, 21, 22],
    [-10, -11, -12],
  ],
  zero_crossings: [
    { horizon_minutes: 0, prices: [102.5] },
    { horizon_minutes: 30, prices: [101.5] },
    { horizon_minutes: 60, prices: [100.5] },
  ],
  source_clocks: {
    market_observed_at: "2026-09-18T14:00:00.123456Z",
    iv_observed_at: "2026-09-18T13:59:59Z",
    oi_vintage: "2026-09-17",
    trade_at_first: "2026-09-18T13:59:50Z",
    trade_at_last: "2026-09-18T13:59:55Z",
    quote_at_first: "2026-09-18T13:59:49Z",
    quote_at_last: "2026-09-18T13:59:54Z",
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
  units: "usd_per_1pct_spot_move",
};

describe("surfaceScenarioComposition", () => {
  it("keeps realized history through NOW and paints the conditional field strictly to its right", () => {
    const out = composeObservedScenarioHeat(OBSERVED, "gex", SCENARIO, anchor);
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("observed_plus_conditional");
    expect(out?.root).toBe("SPY");
    expect(out?.metric).toBe("gex");
    expect(out?.session_date).toBe("2026-09-18");
    expect(out?.boundary_time).toBe("10:00");
    expect(out?.observed.kind).toBe("observed_history");
    expect(out?.scenario.kind).toBe("conditional_scenario");
    expect(out?.observed.bars.map((bar) => bar.time)).toEqual([
      anchor("09:58"), anchor("09:59"), anchor("10:00"),
    ]);
    expect(out?.scenario.bars.map((bar) => bar.time)).toEqual([
      anchor("10:30"), anchor("11:00"),
    ]);
    expect(out?.scenario.zero_crossings).toEqual(SCENARIO.zero_crossings);
    expect(out?.scenario.source_clocks).toEqual(SCENARIO.source_clocks);
    expect(out?.scenario.assumptions.price_axis).toBe("scenario_not_forecast");
  });

  it("fails closed on root/session/metric mismatch or realized data to the right of NOW", () => {
    expect(composeObservedScenarioHeat(
      { ...OBSERVED, root: "QQQ" }, "gex", SCENARIO, anchor,
    )).toBeNull();
    expect(composeObservedScenarioHeat(
      { ...OBSERVED, session_date: "2026-09-17" }, "gex", SCENARIO, anchor,
    )).toBeNull();
    expect(composeObservedScenarioHeat(
      OBSERVED, "vanna", SCENARIO, anchor,
    )).toBeNull();
    expect(composeObservedScenarioHeat(
      { ...OBSERVED, time_steps: [...OBSERVED.time_steps, "10:01"] },
      "gex", SCENARIO, anchor,
    )).toBeNull();
    expect(composeObservedScenarioHeat(
      { ...OBSERVED, asof: "2026-09-18T14:00:01Z" },
      "gex", SCENARIO, anchor,
    )).toBeNull();
  });

  it("requires a horizon-zero boundary at the scenario observation minute", () => {
    expect(composeObservedScenarioHeat(
      OBSERVED,
      "gex",
      {
        ...SCENARIO,
        time_steps: ["10:30", "11:00"],
        grid: SCENARIO.grid.map((row) => row.slice(1)),
        zero_crossings: SCENARIO.zero_crossings.slice(1),
      },
      anchor,
    )).toBeNull();
  });
});
