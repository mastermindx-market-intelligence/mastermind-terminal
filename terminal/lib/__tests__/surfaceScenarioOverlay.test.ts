import { describe, expect, it } from "vitest";
import type { Time } from "lightweight-charts";
import type { ComposedSurfaceHeat } from "@/lib/surfaceScenarioComposition";
import { buildSurfaceScenarioOverlay } from "@/lib/surfaceScenarioOverlay";

const anchor = (hhmm: string): Time => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) as unknown as Time;
};

function heat(time: string, amount: number) {
  return {
    time: anchor(time),
    cells: [{ low: 99, high: 101, amount }],
  };
}

const COMPOSED: ComposedSurfaceHeat = {
  kind: "observed_plus_conditional",
  root: "SPY",
  metric: "gex",
  session_date: "2026-09-18",
  boundary_time: "10:00",
  observed: {
    kind: "observed_history",
    asof: "2026-09-18T14:00:00Z",
    through: "10:00",
    bars: [heat("09:59", 1), heat("10:00", 2)],
  },  scenario: {
    kind: "conditional_scenario",
    observed_at: "2026-09-18T14:00:00.123456Z",
    from: "10:00",
    bars: [heat("10:30", 3), heat("11:00", 4)],
    zero_crossings: [
      { horizon_minutes: 0, prices: [90, 110] },
      { horizon_minutes: 30, prices: [92, 100, 108] },
      { horizon_minutes: 60, prices: [101] },
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
    },    units: "usd_per_1pct_spot_move",
  },
};

describe("surfaceScenarioOverlay", () => {
  it("keeps scenario heat strictly right of NOW and starts contours at the boundary", () => {
    const out = buildSurfaceScenarioOverlay(COMPOSED, anchor);
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("conditional_scenario_overlay");
    expect(out?.root).toBe("SPY");
    expect(out?.metric).toBe("gex");
    expect(out?.boundary_time).toBe(anchor("10:00"));
    expect(out?.heat_bars.map((bar) => bar.time)).toEqual([
      anchor("10:30"),
      anchor("11:00"),
    ]);
    expect(out?.contour_segments.every(
      (segment) => segment.to.horizon_minutes > 0,
    )).toBe(true);
    expect(out?.contour_segments.some(
      (segment) => segment.from.horizon_minutes === 0,
    )).toBe(true);
    expect(out?.disclosure.price_axis).toBe("scenario_not_forecast");
    expect(out?.disclosure.forecast).toBe(false);
    expect(out?.disclosure.observed_history).toBe(false);
    expect(out?.disclosure.participant_inventory_observed).toBe(false);
    expect(out?.disclosure.units).toBe("usd_per_1pct_spot_move");
  });

  it("matches adjacent zero branches monotonically without inventing global identity", () => {
    const out = buildSurfaceScenarioOverlay(COMPOSED, anchor);
    expect(out).not.toBeNull();    expect(out?.contour_segments.map((segment) => [
      segment.from.horizon_minutes,
      segment.from.price,
      segment.to.horizon_minutes,
      segment.to.price,
    ])).toEqual([
      [0, 90, 30, 92],
      [0, 110, 30, 108],
      [30, 100, 60, 101],
    ]);
    expect(out?.contour_segments.every(
      (segment) => segment.continuity === "adjacent_horizon_only",
    )).toBe(true);
  });

  it("fails closed on malformed contour timing or forecast-like assumptions", () => {
    expect(buildSurfaceScenarioOverlay({
      ...COMPOSED,
      scenario: {
        ...COMPOSED.scenario,
        zero_crossings: COMPOSED.scenario.zero_crossings.slice(1),
      },
    }, anchor)).toBeNull();

    expect(buildSurfaceScenarioOverlay({
      ...COMPOSED,
      scenario: {
        ...COMPOSED.scenario,
        zero_crossings: [
          { horizon_minutes: 0, prices: [100] },
          { horizon_minutes: 30, prices: [101] },
          { horizon_minutes: 30, prices: [102] },
        ],
      },
    }, anchor)).toBeNull();

    expect(buildSurfaceScenarioOverlay({
      ...COMPOSED,
      scenario: {
        ...COMPOSED.scenario,
        assumptions: {
          ...COMPOSED.scenario.assumptions,
          price_axis: "predicted_path" as "scenario_not_forecast",
        },
      },
    }, anchor)).toBeNull();
  });
});