import { describe, expect, it } from "vitest";
import {
  ROTATION_METHOD_INCUMBENT,
  isRotationBoundaryValue,
  placeRotation,
  placeRotationCohort,
  rotationContextLabel,
  rotationPlacementLabel,
  rotationShownReceipt,
  type RotationContext,
  type RotationPlacement,
} from "../rotationEligibility";

const relative = (asOf: string | null): RotationContext => ({ basis: "benchmark_relative", benchmark: "SPX", asOf, method: ROTATION_METHOD_INCUMBENT });
const standardized = (asOf: string | null): RotationContext => ({ basis: "peer_standardized", expectedN: 10, measuredN: 7, asOf, method: ROTATION_METHOD_INCUMBENT });
const coords = (placement: RotationPlacement): [number, number] => (placement.state === "unavailable" ? [Number.NaN, Number.NaN] : [placement.rs63, placement.rs21]);

describe("placeRotation", () => {
  it("an exact zero on either axis is a boundary, never leading", () => {
    const both = placeRotation(0, 0);
    const top = placeRotation(0, 1.2);
    const left = placeRotation(-0, -0.4);
    const bottom = placeRotation(0.7, 0);
    expect(both).toEqual({ state: "boundary", axes: ["rs63", "rs21"], nearest: ["leading", "improving", "lagging", "weakening"], rs63: 0, rs21: 0 });
    expect(top).toEqual({ state: "boundary", axes: ["rs63"], nearest: ["leading", "improving"], rs63: 0, rs21: 1.2 });
    expect(left).toEqual({ state: "boundary", axes: ["rs63"], nearest: ["weakening", "lagging"], rs63: 0, rs21: -0.4 });
    expect(bottom).toEqual({ state: "boundary", axes: ["rs21"], nearest: ["leading", "weakening"], rs63: 0.7, rs21: 0 });
    for (const placement of [both, top, left, bottom]) expect("quadrant" in placement).toBe(false);
  });

  it("the boundary nearest sets match the open half-plane beside the zero axis", () => {
    expect(placeRotation(0, -1)).toEqual({ state: "boundary", axes: ["rs63"], nearest: ["weakening", "lagging"], rs63: 0, rs21: -1 });
    expect(placeRotation(-1, 0)).toEqual({ state: "boundary", axes: ["rs21"], nearest: ["improving", "lagging"], rs63: -1, rs21: 0 });
    expect(placeRotation(-0, -0)).toEqual({ state: "boundary", axes: ["rs63", "rs21"], nearest: ["leading", "improving", "lagging", "weakening"], rs63: 0, rs21: 0 });
  });

  it("boundary values are normalised to +0", () => {
    const [bothX, bothY] = coords(placeRotation(-0, -0));
    expect(bothX).toBe(0);
    expect(bothY).toBe(0);
    const [mixedX, mixedY] = coords(placeRotation(-0, 0));
    expect(Object.is(mixedX, -0)).toBe(false);
    expect(Object.is(mixedY, -0)).toBe(false);
    const [keptX, keptY] = coords(placeRotation(0, -0.4));
    expect(keptX).toBe(0);
    expect(keptY).toBe(-0.4);
    const [, keptTop] = coords(placeRotation(-0, 1.2));
    expect(keptTop).toBe(1.2);
  });

  it("null, undefined and a missing axis report missing with the affected axes in order", () => {
    expect(placeRotation(null, 1)).toEqual({ state: "unavailable", reason: "missing", axes: ["rs63"], reasonCode: null });
    expect(placeRotation(1, undefined)).toEqual({ state: "unavailable", reason: "missing", axes: ["rs21"], reasonCode: null });
    expect(placeRotation(undefined, undefined)).toEqual({ state: "unavailable", reason: "missing", axes: ["rs63", "rs21"], reasonCode: null });
    expect(placeRotation(null, undefined, { reasonCode: "peer_gap" }))
      .toEqual({ state: "unavailable", reason: "missing", axes: ["rs63", "rs21"], reasonCode: "peer_gap" });
  });

  it("NaN, infinities, strings and booleans report nonfinite and are never coerced", () => {
    expect(placeRotation("0.5", 1)).toEqual({ state: "unavailable", reason: "nonfinite", axes: ["rs63"], reasonCode: null });
    expect(placeRotation(NaN, 1)).toEqual({ state: "unavailable", reason: "nonfinite", axes: ["rs63"], reasonCode: null });
    expect(placeRotation(Infinity, 1)).toEqual({ state: "unavailable", reason: "nonfinite", axes: ["rs63"], reasonCode: null });
    expect(placeRotation(1, -Infinity)).toEqual({ state: "unavailable", reason: "nonfinite", axes: ["rs21"], reasonCode: null });
    expect(placeRotation(true, false)).toEqual({ state: "unavailable", reason: "nonfinite", axes: ["rs63", "rs21"], reasonCode: null });
    expect(placeRotation("2", "3")).toEqual({ state: "unavailable", reason: "nonfinite", axes: ["rs63", "rs21"], reasonCode: null });
  });

  it("missing takes precedence over nonfinite when both occur", () => {
    expect(placeRotation(null, NaN)).toEqual({ state: "unavailable", reason: "missing", axes: ["rs63", "rs21"], reasonCode: null });
    expect(placeRotation("oops", undefined)).toEqual({ state: "unavailable", reason: "missing", axes: ["rs63", "rs21"], reasonCode: null });
  });

  it("an unmeasured row reports unmeasured with its reason code and takes precedence over missing", () => {
    expect(placeRotation(1.5, -2, { measured: false })).toEqual({ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: null });
    expect(placeRotation(null, undefined, { measured: false, reasonCode: "source_gap" }))
      .toEqual({ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: "source_gap" });
    expect(placeRotation(NaN, Infinity, { measured: false, reasonCode: null }))
      .toEqual({ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: null });
    expect(placeRotation(1.5, -2, { measured: true })).toEqual({ state: "placed", quadrant: "weakening", rs63: 1.5, rs21: -2 });
  });

  it.each([
    [1.2, 0.4, "leading"], [-1.2, 0.4, "improving"], [-1.2, -0.4, "lagging"], [1.2, -0.4, "weakening"],
  ] as const)("each quadrant is placed from the sign pair", (rs63, rs21, quadrant) => {
    expect(placeRotation(rs63, rs21)).toEqual({ state: "placed", quadrant, rs63, rs21 });
  });

  it("unavailable placements expose no coordinates and carry the caller reason code", () => {
    const missing = placeRotation(null, 1, { reasonCode: "peer_gap" });
    const nonfinite = placeRotation(NaN, 1, { reasonCode: "bad_source" });
    for (const placement of [missing, nonfinite]) {
      expect("quadrant" in placement).toBe(false);
      expect("rs63" in placement).toBe(false);
      expect("rs21" in placement).toBe(false);
    }
    expect(missing).toMatchObject({ state: "unavailable", reason: "missing", reasonCode: "peer_gap" });
    expect(nonfinite).toMatchObject({ state: "unavailable", reason: "nonfinite", reasonCode: "bad_source" });
  });

  it("isRotationBoundaryValue is true only for zero and negative zero", () => {
    expect(isRotationBoundaryValue(0)).toBe(true);
    expect(isRotationBoundaryValue(-0)).toBe(true);
    expect(isRotationBoundaryValue(1e-12)).toBe(false);
    expect(isRotationBoundaryValue(-0.4)).toBe(false);
    expect(isRotationBoundaryValue(Number.NaN)).toBe(false);
    expect(isRotationBoundaryValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRotationBoundaryValue(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

describe("placeRotationCohort", () => {
  it("the cohort keeps input order, ignores duplicate ids and counts boundary rows outside the quadrants", () => {
    const cohort = placeRotationCohort([
      { id: "xlk", rs63: 0.9, rs21: 0.5 },
      { id: "xlf", rs63: 0, rs21: 0.3 },
      { id: "xlu", rs63: -0.6, rs21: -0.2 },
      { id: "xlv", rs63: null, rs21: 0.4 },
      { id: "xlk", rs63: 5, rs21: 5 },
    ]);
    expect([...cohort.placements.keys()]).toEqual(["xlk", "xlf", "xlu", "xlv"]);
    expect(cohort.placements.get("xlk")).toEqual({ state: "placed", quadrant: "leading", rs63: 0.9, rs21: 0.5 });
    expect(cohort.placements.get("xlf")).toEqual({ state: "boundary", axes: ["rs63"], nearest: ["leading", "improving"], rs63: 0, rs21: 0.3 });
    expect(cohort.counts).toEqual({ placed: 2, boundary: 1, unavailable: 1, byQuadrant: { leading: 1, improving: 0, lagging: 1, weakening: 0 } });
    expect(cohort.universe).toEqual({ expected: 4, measured: 3 });
  });

  it("dispersion is insufficient below two finite values, constant on identical values and ok otherwise", () => {
    expect(placeRotationCohort([]).dispersion).toEqual({ rs63: "insufficient", rs21: "insufficient", finiteN: 0 });
    const single = placeRotationCohort([{ id: "a", rs63: 1.5, rs21: -0.5 }]);
    expect(single.dispersion).toEqual({ rs63: "insufficient", rs21: "insufficient", finiteN: 1 });
    const flat = placeRotationCohort([
      { id: "a", rs63: 2.5, rs21: -1 },
      { id: "b", rs63: 2.5, rs21: -1 },
      { id: "c", rs63: 2.5 + 5e-13, rs21: -1 - 5e-13 },
    ]);
    expect(flat.dispersion).toEqual({ rs63: "constant", rs21: "constant", finiteN: 3 });
    const spread = placeRotationCohort([
      { id: "a", rs63: 1, rs21: 2 },
      { id: "b", rs63: 2, rs21: 2 },
    ]);
    expect(spread.dispersion).toEqual({ rs63: "ok", rs21: "constant", finiteN: 2 });
  });

  it("dispersion counts placed and boundary coordinates only, skipping unavailable rows", () => {
    const cohort = placeRotationCohort([
      { id: "a", rs63: 1, rs21: 2 },
      { id: "b", rs63: 0, rs21: 3 },
      { id: "c", rs63: null, rs21: null },
      { id: "d", rs63: 9, rs21: 9, measured: false },
    ]);
    expect(cohort.dispersion).toEqual({ rs63: "ok", rs21: "ok", finiteN: 2 });
    expect(cohort.counts.unavailable).toBe(2);
    expect(cohort.counts.boundary).toBe(1);
  });

  it("the cohort reports the measured share of the distinct universe", () => {
    const cohort = placeRotationCohort([
      { id: "a", rs63: 1, rs21: 1 },
      { id: "b", rs63: 0, rs21: 1 },
      { id: "c", rs63: 1, rs21: 1, measured: false },
      { id: "d", rs63: null, rs21: 1 },
      { id: "a", rs63: 9, rs21: 9 },
    ]);
    expect(cohort.universe).toEqual({ expected: 4, measured: 2 });
    expect(cohort.counts.unavailable).toBe(2);
    expect(cohort.dispersion.finiteN).toBe(2);
  });

  it("a filtered subset reproduces the full cohort's placements for the surviving ids and leaves the universe to the caller", () => {
    const rows = [
      { id: "a", rs63: 0.9, rs21: 0.5 },
      { id: "b", rs63: 0, rs21: -0.3 },
      { id: "c", rs63: -0.6, rs21: -0.2 },
      { id: "d", rs63: "n/a", rs21: 0.4 },
      { id: "e", rs63: 1, rs21: 2, measured: false, reasonCode: "halted" },
      { id: "f", rs63: null, rs21: null },
    ];
    const full = placeRotationCohort(rows);
    const keep = new Set(["b", "e", "f"]);
    const subset = placeRotationCohort(rows.filter(row => keep.has(row.id)));
    for (const id of keep) expect(subset.placements.get(id)).toEqual(full.placements.get(id));
    expect(subset.universe).toEqual({ expected: 3, measured: 1 });
    expect(full.universe).toEqual({ expected: 6, measured: 3 });
    expect(subset.counts.boundary).toBe(1);
    expect(subset.counts.unavailable).toBe(2);
  });
});

describe("rotation labels and receipts", () => {
  it("context labels name the benchmark or the measured share and the date in both languages", () => {
    expect(rotationContextLabel(relative(null), "en")).toBe("Relative to SPX");
    expect(rotationContextLabel(relative(null), "zh")).toBe("相对 SPX");
    expect(rotationContextLabel(relative("2026-10-20"), "en")).toBe("Relative to SPX · as of 2026-10-20");
    expect(rotationContextLabel(relative("2026-10-20"), "zh")).toBe("相对 SPX · 截至 2026-10-20");
    expect(rotationContextLabel(standardized(null), "en")).toBe("Peer-standardized · 7 of 10 measured");
    expect(rotationContextLabel(standardized(null), "zh")).toBe("同业标准化 · 已计量 7/10");
    expect(rotationContextLabel(standardized("2026-10-20"), "en")).toBe("Peer-standardized · 7 of 10 measured · as of 2026-10-20");
    expect(rotationContextLabel(standardized("2026-10-20"), "zh")).toBe("同业标准化 · 已计量 7/10 · 截至 2026-10-20");
  });

  it("the context carries the incumbent method and labels never leak it", () => {
    expect(ROTATION_METHOD_INCUMBENT).toBe("incumbent_rs_63_21/v1");
    for (const context of [relative(null), standardized("2026-10-20")]) {
      for (const lang of ["en", "zh"] as const) expect(rotationContextLabel(context, lang)).not.toMatch(/incumbent|_rs_|\/v1/);
    }
  });

  it("placement labels and the shown receipt contain no slug, underscore or code in either language", () => {
    const placements = [
      placeRotation(1, 1), placeRotation(-1, 1), placeRotation(-1, -1), placeRotation(1, -1),
      placeRotation(0, 0), placeRotation(1, 1, { measured: false }), placeRotation(null, 1), placeRotation(NaN, 1),
    ];
    const en = placements.map(placement => rotationPlacementLabel(placement, "en")).concat(rotationShownReceipt(3, 8, "en"));
    const zh = placements.map(placement => rotationPlacementLabel(placement, "zh")).concat(rotationShownReceipt(3, 8, "zh"));
    expect(en).toEqual([
      "Leading", "Improving", "Lagging", "Weakening", "On the boundary",
      "Not placed · not measured", "Not placed · missing", "Not placed · invalid value",
      "Showing 3 of 8 · filters never change the numbers",
    ]);
    expect(zh).toEqual([
      "领先", "改善", "落后", "走弱", "处于边界",
      "未定位 · 未计量", "未定位 · 数据缺失", "未定位 · 数值无效",
      "显示 3/8 · 筛选不改变数值",
    ]);
    for (const line of zh) expect(line).not.toMatch(/[_]|rs63|rs21|leading|improving|lagging|weakening|unmeasured|nonfinite/i);
    for (const line of en) expect(line).not.toMatch(/[_]|rs63|rs21|nonfinite|unmeasured/);
  });

  it("the shown receipt states both counts in both languages", () => {
    expect(rotationShownReceipt(12, 63, "en")).toBe("Showing 12 of 63 · filters never change the numbers");
    expect(rotationShownReceipt(12, 63, "zh")).toBe("显示 12/63 · 筛选不改变数值");
  });
});
