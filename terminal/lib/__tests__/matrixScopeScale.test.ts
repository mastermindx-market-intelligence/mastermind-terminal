// PP1-SM: the companion's colour scale must cover the selected scope, while a
// default buildMatrixGrid call (Positioning card, Exposure desk) stays on the
// displayed rows. The fixture puts the largest |gex| on the strikes farthest
// from spot, outside the 101 rows nearest spot, so a visible-rows scale and a
// full-scope scale cannot agree.

import { describe, expect, it } from "vitest";
import {
  buildMatrixGrid,
  matrixCellBg,
  matrixCellValue,
  type StrikeExpiryDoc,
} from "@/components/shared/StrikeExpiryMatrix";

const SPOT = 100;
const EXPIRIES = ["2026-09-25", "2026-10-02", "2026-10-16"] as const;

/** 160 exact strikes inside ±25% of spot. Index 0 is the low end. */
function ladder(): number[] {
  return Array.from({ length: 160 }, (_, i) => 80 + i * 0.25);
}

function bandGex(index: number): number {
  // 41 strikes nearest spot: modest. Inside ±8% but outside those 41: larger.
  // Inside the 101 nearest but outside ±8%: moderate. Outside the 101: extreme.
  if (index >= 60 && index <= 100) return 1e6;
  if ((index >= 48 && index <= 59) || (index >= 101 && index <= 112)) return 50e6;
  if ((index >= 30 && index <= 47) || (index >= 113 && index <= 130)) return 4e6;
  return 100e6;
}

export function wideScopeMatrix(): StrikeExpiryDoc & { schema: string; root: string } {
  const strikes = ladder();
  const cells = strikes.flatMap((strike, index) =>
    EXPIRIES.map((expiry) => ({ strike, expiry, gex: bandGex(index) })),
  );
  return {
    schema: "options_structure.matrix/v1",
    root: "NVDA",
    spot: SPOT,
    asof: "2026-09-25T21:00:00Z",
    _build_meta: { asof_date: "2026-09-25" },
    strikes,
    expiries: [...EXPIRIES],
    cells,
  };
}

const base = {
  matrix: wideScopeMatrix(),
  metric: "gex" as const,
  exactStrikes: true,
  windowPct: 25,
  maxCols: 3,
};

describe("full selected-scope colour scale", () => {
  it("(a) selected-scope matches the uncapped grid and the displayed default does not", () => {
    const scoped = buildMatrixGrid({ ...base, maxRows: 101, scaleOver: "selected-scope" })!;
    const uncapped = buildMatrixGrid({ ...base, maxRows: 10_000 })!;
    const displayed = buildMatrixGrid({ ...base, maxRows: 101 })!;
    expect(scoped.strikes).toHaveLength(101);
    expect(uncapped.strikes).toHaveLength(160);
    expect(displayed.scaleHi).not.toBe(uncapped.scaleHi);
    expect(scoped.scaleHi).toBe(uncapped.scaleHi);
    expect(scoped.scaleLo).toBe(uncapped.scaleLo);
  });

  it("(b) recentring the displayed rows does not change the selected-scope scale or a shared cell's colour", () => {
    const far = base.matrix.strikes![0];
    const atSpot = buildMatrixGrid({ ...base, maxRows: 101, scaleOver: "selected-scope" })!;
    const atFar = buildMatrixGrid({
      ...base, maxRows: 101, scaleOver: "selected-scope", displayCenterStrike: far,
    })!;
    expect(atSpot.scaleHi).toBe(atFar.scaleHi);
    expect(atSpot.scaleLo).toBe(atFar.scaleLo);
    const common = atSpot.strikes.find((strike) => atFar.strikes.includes(strike));
    expect(common).toBeTypeOf("number");
    const value = matrixCellValue(atSpot.byKey.get(`${common}|${atSpot.exps[0]}`)!, "gex")!;
    expect(value).not.toBe(0);
    expect(matrixCellBg(value, { hi: atSpot.scaleHi, lo: atSpot.scaleLo }, "gex"))
      .toBe(matrixCellBg(value, { hi: atFar.scaleHi, lo: atFar.scaleLo }, "gex"));
  });

  it("(c) column scales match the uncapped grid for every expiry", () => {
    const scoped = buildMatrixGrid({
      ...base, maxRows: 101, normalization: "column", scaleOver: "selected-scope",
    })!;
    const uncapped = buildMatrixGrid({ ...base, maxRows: 10_000, normalization: "column" })!;
    expect(scoped.perCol).toEqual(uncapped.perCol);
  });

  it("(d) a default-option call keeps the displayed-row scale the card and desk use", () => {
    // Measured on this ladder before the opt-in: bucketing fits the ±8% window
    // in 33 rows, and those rows' 95th percentile of |gex| is 100 ($mn).
    const plain = buildMatrixGrid({ matrix: base.matrix, metric: "gex" })!;
    expect(plain.strikes).toHaveLength(33);
    expect(plain.scaleHi).toBe(100);
    expect(plain.scaleLo).toBe(0);
    expect(plain.perCol).toBeNull();

    const columns = buildMatrixGrid({ matrix: base.matrix, metric: "gex", normalization: "column" })!;
    expect(columns.scaleHi).toBe(100);
    expect(columns.scaleLo).toBe(0);
    for (const expiry of columns.exps) expect(columns.perCol!.get(expiry)).toEqual({ hi: 100, lo: 0 });

    // The row cap does bite once strikes stay exact. Omitting scaleOver still
    // measures only the 101 displayed rows (P95 = 50), not the full scope (100).
    const capped = buildMatrixGrid({ ...base, maxRows: 101 })!;
    expect(capped.scaleHi).toBe(50);
    expect(capped.scaleLo).toBe(0);
    const cappedColumns = buildMatrixGrid({ ...base, maxRows: 101, normalization: "column" })!;
    for (const expiry of cappedColumns.exps) {
      expect(cappedColumns.perCol!.get(expiry)).toEqual({ hi: 50, lo: 0 });
    }
  });
});
