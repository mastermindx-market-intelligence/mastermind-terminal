import { scenarioGrid } from "./marketStructure";

/**
 * exposureScenario — the Scenario slice of the Exposure map.
 *
 * Evaluates the engine contract `local_scenario` on the ADMITTED summary
 * (GEX / VEX / CEX net totals in $mn) through the existing owner
 * `marketStructure.scenarioGrid`, then decomposes it into spot / vol / time
 * terms. DOM-free: the React panel lives in components/exposure-map/.
 *
 *   local_scenario = −GEX·((S1−S0)/S0 ÷ 1%) − VEX·(Δσ ÷ 1%) − CEX·days
 *
 * Δσ arrives in vol points, so the vol weight is Δσ_pts itself. DEX is never a
 * term and `joint` is always false (dated_gamma_boundary.joint_scenario=false):
 * the terms add linearly. POSITIVE value = dealers must BUY the underlying.
 *
 * The move fraction (S1−S0)/S0 is carried at full double precision and is
 * NEVER rounded, truncated or formatted before it is multiplied — rounding the
 * move to −0.04% in the worked example would give 184.68M instead of
 * 184.70211915M. That is the falsifier the tests assert on.
 */
export const SCENARIO_VERSION = "exposure-scenario/v1";
/** The owner's own local bounds (mirrors projectedExposureScenario, exposureMapProjection.ts L394). */
export const SCENARIO_LIMITS = { spotPct: 3, volPts: 5, days: 5 } as const;
/** Stepper increments in the scenario panel. */
export const SCENARIO_STEPS = { spotPct: 0.25, volPts: 0.25, days: 0.25 } as const;
/** The spot-move curve: one series per Δσ over spotPct ∈ [−2, +2]. */
export const SCENARIO_CURVE = { spotPct: [-2, 2] as const, points: 81, sigmas: [-1, 0, 1] as const };

export type ScenarioQualification = "qualified" | "dated" | "legacy" | "unqualified";

/** What the parent hands in: already-admitted summary reads, never the GEX plane. */
export interface ScenarioBasis {
  root: string;
  /** Basis session, YYYY-MM-DD. */
  session: string;
  referenceSpot: number;
  /** Admitted summary net totals in $mn. null = unavailable, never 0. */
  gexMn: number | null;
  vexMn: number | null;
  cexMn: number | null;
  /** 1σ expected move as a percent of spot, from the moves owner. null when not admitted. */
  emPct: number | null;
  qualification: ScenarioQualification;
  sourceRef: string | null;
}

export interface ScenarioInputs { targetSpot: number; deltaSigmaPts: number; days: number }

export type ScenarioRefusal =
  | "not_qualified" | "invalid_reference" | "invalid_inputs" | "out_of_local_range" | "summary_unavailable";
export type ScenarioGreek = "gex" | "vex" | "cex";

export interface ScenarioTerms { spotMn: number | null; volMn: number | null; timeMn: number | null }

export interface ScenarioValue {
  ok: true;
  version: typeof SCENARIO_VERSION;
  /** (S1−S0)/S0 at full double precision — never rounded before it is multiplied. */
  moveFraction: number;
  /** moveFraction·100. */
  movePct: number;
  inputs: ScenarioInputs;
  terms: ScenarioTerms;
  /** The owner's grid cell, $mn. POSITIVE = dealers must BUY. */
  totalMn: number;
  /** dated_gamma_boundary.joint_scenario=false — the terms add linearly. */
  joint: false;
  /** Summaries that were null but carried a zero weight. */
  missing: ScenarioGreek[];
}

export interface ScenarioRefused { ok: false; refusal: ScenarioRefusal; missing: ScenarioGreek[] }

const refused = (refusal: ScenarioRefusal, missing: ScenarioGreek[] = []): ScenarioRefused =>
  ({ ok: false, refusal, missing });
/** A zero result is never −0: the flat term must not print as "−0.000M". */
const norm = (v: number) => (v === 0 ? 0 : v);

/**
 * The engine contract `local_scenario` on one admitted summary.
 *
 * A refusal is a typed reason — never a thrown error and never a zero value.
 * An unavailable summary is never substituted with 0: it refuses unless its
 * weight is exactly 0 (the zero-weight case is what projectedExposureScenario
 * does at exposureMapProjection.ts L406–409, mirrored here). The refusal also
 * guards scenarioGrid's silent fallback (marketStructure.ts L284): a null VEX
 * with a non-zero Δσ must never reach the grid, because there it would be
 * answered as the Δσ = 0 value.
 */
export function localScenarioValue(basis: ScenarioBasis, inputs: ScenarioInputs): ScenarioValue | ScenarioRefused {
  if (basis.qualification !== "qualified") return refused("not_qualified");
  if (!Number.isFinite(basis.referenceSpot) || basis.referenceSpot <= 0) return refused("invalid_reference");
  const { targetSpot, deltaSigmaPts, days } = inputs;
  if (![targetSpot, deltaSigmaPts, days].every(Number.isFinite) || targetSpot <= 0 || days < 0) {
    return refused("invalid_inputs");
  }
  const moveFraction = (targetSpot - basis.referenceSpot) / basis.referenceSpot;
  const movePct = moveFraction * 100;
  if (Math.abs(movePct) > SCENARIO_LIMITS.spotPct || Math.abs(deltaSigmaPts) > SCENARIO_LIMITS.volPts
    || days > SCENARIO_LIMITS.days) return refused("out_of_local_range");
  const weights: { greek: ScenarioGreek; weight: number; summary: number | null }[] = [
    { greek: "gex", weight: movePct, summary: basis.gexMn },
    { greek: "vex", weight: deltaSigmaPts, summary: basis.vexMn },
    { greek: "cex", weight: days, summary: basis.cexMn },
  ];
  const missing = weights.filter((w) => w.summary == null).map((w) => w.greek);
  const blocking = weights.filter((w) => w.summary == null && w.weight !== 0).map((w) => w.greek);
  if (blocking.length) return refused("summary_unavailable", blocking);
  // Every remaining null carried a zero weight, so 0 is exact here (owner L406–409).
  const gexMn = basis.gexMn ?? 0;
  const vexMn = basis.vexMn ?? 0;
  const cexMn = basis.cexMn ?? 0;
  const terms: ScenarioTerms = {
    spotMn: norm(movePct === 0 ? 0 : -gexMn * movePct),
    volMn: norm(deltaSigmaPts === 0 ? 0 : -vexMn * deltaSigmaPts),
    timeMn: norm(days === 0 ? 0 : -cexMn * days),
  };
  const grid = scenarioGrid(
    { gammaMn: gexMn, gammaKnown: 1, vannaMn: vexMn, charmMn: cexMn, deltaMn: null,
      callAbsMn: 0, putAbsMn: 0, nStrikes: 1, nStrikesFull: null, windowed: false },
    { dsPct: [movePct], dVolPts: [deltaSigmaPts], dtDays: days },
  );
  const totalMn = grid.cells[0][0];
  if (totalMn == null) return refused("summary_unavailable", missing); // unreachable with gammaKnown: 1
  return { ok: true, version: SCENARIO_VERSION, moveFraction, movePct, inputs: { ...inputs },
    terms, totalMn, joint: false, missing };
}

export interface ScenarioCurvePoint { spotPct: number; targetSpot: number; valueMn: number | null }
export interface ScenarioCurveSeries { deltaSigmaPts: number; points: ScenarioCurvePoint[] }

/**
 * The spot-move curve: one straight-line series per Δσ over
 * SCENARIO_CURVE.spotPct in SCENARIO_CURVE.points steps. A refused point is a
 * null — the view draws a gap, never a drop to zero. The line is never
 * smoothed and never extrapolated past SCENARIO_LIMITS.
 */
export function scenarioCurve(basis: ScenarioBasis, inputs: Pick<ScenarioInputs, "deltaSigmaPts" | "days">,
  sigmas: readonly number[] = SCENARIO_CURVE.sigmas): ScenarioCurveSeries[] {
  const [lo, hi] = SCENARIO_CURVE.spotPct;
  return sigmas.map((deltaSigmaPts) => {
    const points: ScenarioCurvePoint[] = [];
    for (let i = 0; i < SCENARIO_CURVE.points; i++) {
      const spotPct = lo + ((hi - lo) * i) / (SCENARIO_CURVE.points - 1);
      const targetSpot = basis.referenceSpot * (1 + spotPct / 100);
      const v = localScenarioValue(basis, { targetSpot, deltaSigmaPts, days: inputs.days });
      points.push({ spotPct, targetSpot, valueMn: v.ok ? v.totalMn : null });
    }
    return { deltaSigmaPts, points };
  });
}

export function defaultScenarioInputs(basis: ScenarioBasis): ScenarioInputs {
  return { targetSpot: basis.referenceSpot, deltaSigmaPts: 0, days: 0 };
}

/** The engine-contract golden (engine_contracts.json `local_scenario`, oracle 499/499). */
export const WORKED_EXAMPLE: {
  basis: ScenarioBasis; inputs: ScenarioInputs; expectedTotalMn: 184.70211915; roundedWouldGiveMn: 184.68;
} = {
  basis: { root: "SPX", session: "2026-10-16", referenceSpot: 600.24, gexMn: -1383, vexMn: 220, cexMn: -80,
    emPct: null, qualification: "qualified", sourceRef: null },
  inputs: { targetSpot: 600, deltaSigmaPts: -1, days: 0.25 },
  expectedTotalMn: 184.70211915,
  roundedWouldGiveMn: 184.68,
};

/** null → "—". Sign always shown ("+" / U+2212 "−"); B above 1000 $mn, M below. */
export function fmtScenarioMn(v: number | null, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const body = a >= 1000 ? `${(a / 1000).toFixed(3)}B` : `${a.toFixed(decimals)}M`;
  return `${v < 0 ? "−" : "+"}${body}`;
}

/** The move percent at 6 decimals with an explicit sign and U+2212: "−0.039984%". */
export function fmtMovePct(moveFraction: number): string {
  const pct = moveFraction * 100;
  return `${pct < 0 ? "−" : "+"}${Math.abs(pct).toFixed(6)}%`;
}
