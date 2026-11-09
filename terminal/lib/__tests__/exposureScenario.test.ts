import { describe, expect, it } from "vitest";
import { scenarioGrid } from "../marketStructure";
import { SCENARIO_CURVE, SCENARIO_LIMITS, WORKED_EXAMPLE, defaultScenarioInputs, fmtMovePct, fmtScenarioMn,
  localScenarioValue, scenarioCurve, type ScenarioBasis, type ScenarioInputs, type ScenarioRefused, type ScenarioValue } from "../exposureScenario";

const B: ScenarioBasis = { root: "SPX", session: "2026-10-16", referenceSpot: 600.24, gexMn: -1383, vexMn: 220,
  cexMn: -80, emPct: null, qualification: "qualified", sourceRef: null };
const I: ScenarioInputs = { targetSpot: 600, deltaSigmaPts: -1, days: 0.25 };

const isValue = (r: ScenarioValue | ScenarioRefused): r is ScenarioValue => r.ok;
const refusedShape = (refusal: ScenarioRefused["refusal"], missing: ScenarioRefused["missing"] = []) =>
  ({ ok: false, refusal, missing });
/** The exact owner call the module must make (projectedExposureScenario L406–409 shape). */
const ownerCell = (b: ScenarioBasis, i: ScenarioInputs) => scenarioGrid(
  { gammaMn: b.gexMn ?? 0, gammaKnown: 1, vannaMn: b.vexMn ?? 0, charmMn: b.cexMn ?? 0, deltaMn: null,
    callAbsMn: 0, putAbsMn: 0, nStrikes: 1, nStrikesFull: null, windowed: false },
  { dsPct: [((i.targetSpot - b.referenceSpot) / b.referenceSpot) * 100], dVolPts: [i.deltaSigmaPts], dtDays: i.days },
).cells[0][0];

describe("localScenarioValue — the engine-contract golden", () => {
  it("returns the four golden numbers at full precision", () => {
    const r = localScenarioValue(B, I);
    if (!isValue(r)) throw new Error("refused");
    expect(r.version).toBe("exposure-scenario/v1");
    expect(r.joint).toBe(false);
    expect(r.moveFraction).toBeCloseTo(-1 / 2501, 12);
    expect(r.movePct).toBeCloseTo((-1 / 2501) * 100, 10);
    expect(r.terms.spotMn).toBeCloseTo(-55.29788085, 4);
    expect(r.terms.volMn).toBeCloseTo(220, 4);
    expect(r.terms.timeMn).toBeCloseTo(20, 4);
    expect(r.totalMn).toBeCloseTo(184.70211915, 4);
  });
  it("never rounds the move fraction — the falsifier", () => {
    const r = localScenarioValue(B, I);
    if (!isValue(r)) throw new Error("refused");
    expect(Math.abs(r.totalMn - 184.70211915)).toBeLessThanOrEqual(1e-4);
    // Rounding the move to −0.04% would give 184.68M; the module must not do that.
    expect(Math.abs(r.totalMn - 184.68)).toBeGreaterThan(0.01);
  });
  it("returns the owner's grid cell, and the linear terms sum to it", () => {
    const r = localScenarioValue(B, I);
    if (!isValue(r)) throw new Error("refused");
    const cell = ownerCell(B, I);
    expect(cell).not.toBeNull();
    expect(r.totalMn).toBeCloseTo(cell!, 6);
    expect(r.terms.spotMn! + r.terms.volMn! + r.terms.timeMn!).toBeCloseTo(cell!, 6);
  });
  it("terms sum to the owner's cell at five other input sets", () => {
    const sets: ScenarioInputs[] = [
      { targetSpot: 612, deltaSigmaPts: 2.5, days: 3 },
      { targetSpot: 588, deltaSigmaPts: -3, days: 1 },
      { targetSpot: 601.5, deltaSigmaPts: 0.75, days: 0 },
      { targetSpot: 600.24, deltaSigmaPts: -0.25, days: 5 },
      { targetSpot: 600.24, deltaSigmaPts: 0, days: 0 },
    ];
    for (const inputs of sets) {
      const r = localScenarioValue(B, inputs);
      if (!isValue(r)) throw new Error(`refused: ${JSON.stringify(inputs)}`);
      const cell = ownerCell(B, inputs);
      expect(cell).not.toBeNull();
      expect(r.totalMn).toBeCloseTo(cell!, 6);
      expect(r.terms.spotMn! + r.terms.volMn! + r.terms.timeMn!).toBeCloseTo(cell!, 6);
    }
  });
  it("zero-weight terms are 0 and null summaries land in missing without refusing", () => {
    const r = localScenarioValue({ ...B, vexMn: null, cexMn: null }, { targetSpot: 600.24, deltaSigmaPts: 0, days: 0 });
    if (!isValue(r)) throw new Error("refused");
    expect(r.missing).toEqual(["vex", "cex"]);
    expect(r.terms.volMn).toBe(0);
    expect(r.terms.timeMn).toBe(0);
    expect(r.totalMn).toBe(0);
  });
});

describe("localScenarioValue — refusals", () => {
  it("a null vex with Δσ ≠ 0 refuses summary_unavailable: total absent, never 184.70 − 220", () => {
    const r = localScenarioValue({ ...B, vexMn: null }, I);
    expect(r).toEqual(refusedShape("summary_unavailable", ["vex"]));
    expect(r).not.toHaveProperty("totalMn");
  });
  it("a null cex with days > 0 refuses summary_unavailable", () => {
    const r = localScenarioValue({ ...B, cexMn: null }, { ...I, days: 0.25 });
    expect(r).toEqual(refusedShape("summary_unavailable", ["cex"]));
  });
  it("a null gex with a non-zero move refuses summary_unavailable", () => {
    const r = localScenarioValue({ ...B, gexMn: null }, I);
    expect(r).toEqual(refusedShape("summary_unavailable", ["gex"]));
  });
  it("dated / legacy / unqualified books carry no local value", () => {
    for (const qualification of ["dated", "legacy", "unqualified"] as const) {
      expect(localScenarioValue({ ...B, qualification }, I)).toEqual(refusedShape("not_qualified"));
    }
  });
  it("bounds refuse out_of_local_range or invalid_inputs", () => {
    expect(localScenarioValue(B, { ...I, targetSpot: B.referenceSpot * 1.030001 }))
      .toEqual(refusedShape("out_of_local_range"));
    expect(localScenarioValue(B, { ...I, deltaSigmaPts: SCENARIO_LIMITS.volPts + 0.0001 }))
      .toEqual(refusedShape("out_of_local_range"));
    expect(localScenarioValue(B, { ...I, days: SCENARIO_LIMITS.days + 0.0001 }))
      .toEqual(refusedShape("out_of_local_range"));
    expect(localScenarioValue(B, { ...I, days: -0.25 })).toEqual(refusedShape("invalid_inputs"));
    expect(localScenarioValue(B, { ...I, targetSpot: Number.NaN })).toEqual(refusedShape("invalid_inputs"));
    expect(localScenarioValue(B, { ...I, targetSpot: 0 })).toEqual(refusedShape("invalid_inputs"));
    expect(localScenarioValue({ ...B, referenceSpot: 0 }, I)).toEqual(refusedShape("invalid_reference"));
    expect(localScenarioValue({ ...B, referenceSpot: Number.POSITIVE_INFINITY }, I))
      .toEqual(refusedShape("invalid_reference"));
  });
  it("sign law: positive GEX with an up-move sells (negative term); negative GEX buys", () => {
    const up: ScenarioInputs = { targetSpot: B.referenceSpot * 1.01, deltaSigmaPts: 0, days: 0 };
    const pos = localScenarioValue({ ...B, gexMn: 500, vexMn: null, cexMn: null }, up);
    if (!isValue(pos)) throw new Error("refused");
    expect(pos.terms.spotMn).toBeLessThan(0);
    const neg = localScenarioValue({ ...B, gexMn: -500 }, up);
    if (!isValue(neg)) throw new Error("refused");
    expect(neg.terms.spotMn).toBeGreaterThan(0);
  });
});

describe("scenarioCurve", () => {
  const curve = scenarioCurve(B, { deltaSigmaPts: -1, days: 0.25 });
  it("one series per σ, 81 points each", () => {
    expect(curve).toHaveLength(3);
    for (const s of curve) {
      expect(s.points).toHaveLength(SCENARIO_CURVE.points);
      expect(s.points[0].spotPct).toBeCloseTo(-2, 9);
      expect(s.points[SCENARIO_CURVE.points - 1].spotPct).toBeCloseTo(2, 9);
    }
  });
  it("is straight in spot: value(+2%) − value(0) equals 2·(value(+1%) − value(0))", () => {
    const mid = curve[1];
    const v0 = mid.points[40].valueMn!, v1 = mid.points[60].valueMn!, v2 = mid.points[80].valueMn!;
    expect(v2 - v0).toBeCloseTo(2 * (v1 - v0), 9);
  });
  it("the σ series differ by exactly −vex·Δσ", () => {
    for (let i = 0; i < SCENARIO_CURVE.points; i++) {
      expect(curve[0].points[i].valueMn! - curve[1].points[i].valueMn!).toBeCloseTo(B.vexMn!, 9);
      expect(curve[2].points[i].valueMn! - curve[1].points[i].valueMn!).toBeCloseTo(-B.vexMn!, 9);
    }
  });
  it("refusals are null points: vex null → ±1 series all null, 0 series intact", () => {
    const c = scenarioCurve({ ...B, vexMn: null }, { deltaSigmaPts: -1, days: 0 });
    expect(c[0].points.every((pt) => pt.valueMn == null)).toBe(true);
    expect(c[2].points.every((pt) => pt.valueMn == null)).toBe(true);
    expect(c[1].points.every((pt) => pt.valueMn != null)).toBe(true);
  });
});

describe("formatters and defaults", () => {
  it("fmtScenarioMn prints the sign, B above 1000 $mn, M below", () => {
    expect(fmtScenarioMn(184.70211915, 3)).toBe("+184.702M");
    expect(fmtScenarioMn(-1383, 3)).toBe("−1.383B");
    expect(fmtScenarioMn(-55.29788085, 3)).toBe("−55.298M");
    expect(fmtScenarioMn(20, 3)).toBe("+20.000M");
    expect(fmtScenarioMn(null, 3)).toBe("—");
  });
  it("fmtMovePct prints 6 decimals with U+2212", () => {
    expect(fmtMovePct(-1 / 2501)).toBe("−0.039984%");
  });
  it("defaultScenarioInputs starts at the reference spot", () => {
    expect(defaultScenarioInputs(B)).toEqual({ targetSpot: 600.24, deltaSigmaPts: 0, days: 0 });
  });
  it("WORKED_EXAMPLE evaluates to expectedTotalMn", () => {
    const r = localScenarioValue(WORKED_EXAMPLE.basis, WORKED_EXAMPLE.inputs);
    if (!isValue(r)) throw new Error("refused");
    expect(r.totalMn).toBeCloseTo(WORKED_EXAMPLE.expectedTotalMn, 6);
    expect(WORKED_EXAMPLE.roundedWouldGiveMn).toBe(184.68);
  });
});
