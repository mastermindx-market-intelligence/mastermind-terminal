/**
 * Compose realized SurfaceFrame history with a conditional future scenario without
 * erasing their different epistemic identities.
 *
 * This module owns no fetch/cache/replay/chart state. It is only the bounded bridge a
 * later SurfacePane consumer can render: observed columns through NOW, scenario columns
 * strictly to the right of NOW.
 */
import type { HeatData } from "@/lib/heatSeries";
import {
  buildHeatBars,
  type SurfaceFrame,
} from "@/lib/surfaceContract";
import {
  buildScenarioHeatBars,
  type ScenarioHeatField,
  type ScenarioSourceClocks,
  type ScenarioTerminalMetric,
  type ScenarioTimeAnchor,
} from "@/lib/scenarioSurfaceContract";

export interface ObservedHeatSegment {
  kind: "observed_history";
  asof: string;
  through: string;
  bars: HeatData[];
}

export interface ConditionalHeatSegment {
  kind: "conditional_scenario";
  observed_at: string;
  from: string;
  bars: HeatData[];
  zero_crossings: ScenarioHeatField["zero_crossings"];
  source_clocks: ScenarioSourceClocks;
  assumptions: ScenarioHeatField["assumptions"];
  units: string;
}

export interface ComposedSurfaceHeat {
  kind: "observed_plus_conditional";
  root: string;
  metric: ScenarioTerminalMetric;
  session_date: string;
  boundary_time: string;
  observed: ObservedHeatSegment;
  scenario: ConditionalHeatSegment;
}

const ET_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function minuteOf(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function etMinute(instant: string): string | null {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return null;
  const parts = ET_FORMAT.formatToParts(new Date(ms));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : null;
}

function strictlyAscendingMinutes(values: string[]): number[] | null {
  const out: number[] = [];
  let prior = -1;
  for (const value of values) {
    const minute = minuteOf(value);
    if (minute === null || minute <= prior) return null;
    out.push(minute);
    prior = minute;
  }
  return out;
}

export function composeObservedScenarioHeat(
  observed: SurfaceFrame,
  metric: ScenarioTerminalMetric,
  scenario: ScenarioHeatField,
  anchor: ScenarioTimeAnchor,
): ComposedSurfaceHeat | null {
  if (
    !observed.root ||
    !observed.session_date ||
    observed.root !== scenario.root ||
    observed.session_date !== scenario.session_date ||
    scenario.metric !== metric ||
    !observed.grids[metric] ||
    !observed.time_steps.length ||
    !scenario.time_steps.length ||
    !scenario.zero_crossings.length
  ) {
    return null;
  }

  const observedAsOf = Date.parse(observed.asof);
  const scenarioObservedAt = Date.parse(scenario.observed_at);
  if (
    !Number.isFinite(observedAsOf) ||
    !Number.isFinite(scenarioObservedAt) ||
    observedAsOf > scenarioObservedAt
  ) {
    return null;
  }

  const boundaryTime = etMinute(scenario.observed_at);
  if (
    !boundaryTime ||
    scenario.time_steps[0] !== boundaryTime ||
    scenario.zero_crossings[0].horizon_minutes !== 0
  ) {
    return null;
  }
  const boundaryMinute = minuteOf(boundaryTime);
  const observedMinutes = strictlyAscendingMinutes(observed.time_steps);
  const scenarioMinutes = strictlyAscendingMinutes(scenario.time_steps);
  if (boundaryMinute === null || !observedMinutes || !scenarioMinutes) return null;
  if (observedMinutes[observedMinutes.length - 1] > boundaryMinute) return null;
  if (scenarioMinutes[0] !== boundaryMinute) return null;

  const observedBars = buildHeatBars(observed, metric, anchor);
  if (observedBars.length !== observed.time_steps.length) return null;

  const allScenarioBars = buildScenarioHeatBars(scenario, anchor);
  if (allScenarioBars.length !== scenario.time_steps.length) return null;
  const futureBars = allScenarioBars.filter(
    (_bar, index) => scenarioMinutes[index] > boundaryMinute,
  );

  return {
    kind: "observed_plus_conditional",
    root: scenario.root,
    metric,
    session_date: scenario.session_date,
    boundary_time: boundaryTime,
    observed: {
      kind: "observed_history",
      asof: observed.asof,
      through: observed.time_steps[observed.time_steps.length - 1],
      bars: observedBars,
    },
    scenario: {
      kind: "conditional_scenario",
      observed_at: scenario.observed_at,
      from: boundaryTime,
      bars: futureBars,
      zero_crossings: scenario.zero_crossings.map((row) => ({
        horizon_minutes: row.horizon_minutes,
        prices: [...row.prices],
      })),
      source_clocks: { ...scenario.source_clocks },
      assumptions: { ...scenario.assumptions },
      units: scenario.units,
    },
  };
}
