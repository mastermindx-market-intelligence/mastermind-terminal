/**
 * Legacy YoY identity regressions.
 *
 * Committed fin-compare fixtures are the input; removed periods and metadata changes below
 * are synthetic overlays. These cases do not claim a production issuer has the defect.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparablePeriodChanges, priorComparableIndex } from "../finStatementMath";
import { revenueHistory } from "../finStatements";
import type { Fund, StatementPeriodSet } from "../fund";

function periodSet(
  periods: string[],
  values: (number | null)[] = periods.map(() => 100),
  metadata: Partial<StatementPeriodSet> = {},
): StatementPeriodSet {
  return {
    periods,
    period_end: [],
    income: { revenue: values } as StatementPeriodSet["income"],
    balance: {} as StatementPeriodSet["balance"],
    cashflow: {} as StatementPeriodSet["cashflow"],
    ...metadata,
  };
}

function fixture(sym: "AAPL" | "AMD"): Fund {
  return JSON.parse(readFileSync(
    path.join(__dirname, "fixtures", "fin-compare", `${sym}.fund.json`), "utf8",
  )) as Fund;
}

function dropLegacyPeriod(set: StatementPeriodSet, label: string): void {
  expect(set.fiscal_year).toBeUndefined();
  expect(set.period_kind).toBeUndefined();
  expect(set.period_number).toBeUndefined();
  const index = set.periods.indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  set.periods.splice(index, 1);
  set.period_end.splice(index, 1);
  for (const block of [set.income, set.balance, set.cashflow] as unknown as Record<string, unknown[]>[]) {
    for (const values of Object.values(block)) values.splice(index, 1);
  }
}

describe("legacy YoY matches fiscal identity rather than array distance", () => {
  it("withholds AAPL FY2025 YoY when FY2024 is physically absent", () => {
    const fund = fixture("AAPL");
    const set = fund.statements.annual!;
    expect(comparablePeriodChanges(set.income.revenue, set, "annual").at(-1))
      .toBeCloseTo(6.425511782832739, 10);
    dropLegacyPeriod(set, "2024");
    const before = JSON.stringify(fund);
    expect(set.periods).toEqual(["2022", "2023", "2025"]);
    expect(set.income.revenue).toEqual([394328000000, 383285000000, 416161000000]);
    expect(priorComparableIndex(set, 2, "annual")).toBeNull();
    expect(comparablePeriodChanges(set.income.revenue, set, "annual").at(-1)).toBeNull();
    expect(revenueHistory(fund, "annual").at(-1)).toMatchObject({
      period: "2025", value: 416161000000, yoy: null,
    });
    expect(JSON.stringify(fund)).toBe(before);
  });

  it("retains AMD Q2 YoY when the unrelated Q4 2025 period is absent", () => {
    const fund = fixture("AMD");
    const set = fund.statements.quarterly!;
    expect(comparablePeriodChanges(set.income.revenue, set, "quarterly").at(-1))
      .toBeCloseTo(50.11060507482108, 10);
    dropLegacyPeriod(set, "Q4 '25");
    const before = JSON.stringify(fund);
    expect(set.periods).toEqual(["Q2 '25", "Q3 '25", "Q1 '26", "Q2 '26"]);
    expect(priorComparableIndex(set, 3, "quarterly")).toBe(0);
    expect(comparablePeriodChanges(set.income.revenue, set, "quarterly").at(-1))
      .toBeCloseTo(50.11060507482108, 10);
    expect(revenueHistory(fund, "quarterly").at(-1)?.yoy)
      .toBeCloseTo(50.11060507482108, 10);
    expect(JSON.stringify(fund)).toBe(before);
  });

  it.each([
    { basis: "annual" as const, periods: ["2024", "2025"] },
    { basis: "annual" as const, periods: ["FY2024", "FY2025"] },
    { basis: "quarterly" as const, periods: ["Q3 '25", "Q3 '26"] },
    { basis: "quarterly" as const, periods: ["Q3 2025", "Q3 2026"] },
  ])("recognizes supported legacy fiscal labels: $periods", ({ basis, periods }) => {
    const set = periodSet(periods, [100, 125]);
    // No dates are needed or synthesized to establish this fiscal identity.
    expect(priorComparableIndex(set, 1, basis)).toBe(0);
    expect(comparablePeriodChanges(set.income.revenue, set, basis)).toEqual([null, 25]);
  });

  it("does not substitute a different quarter when four earlier rows exist", () => {
    const set = periodSet(["Q2 '24", "Q3 '24", "Q4 '24", "Q2 '25", "Q3 '25", "Q4 '25", "Q1 '26"]);
    expect(priorComparableIndex(set, 6, "quarterly")).toBeNull();
  });

  it.each([
    ["Q3 '25", "Q3 2026"],
    ["Q3 2025", "Q3 '26", "Q3 2026"],
    ["Q3 '99", "Q3 '00"],
    ["H1 2025", "H1 2026"],
    ["Q5 '25", "Q5 '26"],
    ["2025", "2026"],
  ])("does not guess unsupported or ambiguous interim identity: %j", (...periods) => {
    expect(priorComparableIndex(periodSet(periods), 1, "quarterly")).toBeNull();
  });

  it("supports an explicit full-year century transition", () => {
    expect(priorComparableIndex(periodSet(["1999", "2000"]), 1, "annual")).toBe(0);
  });

  it.each([
    { periods: ["2024", "2025", "2024"], index: 1 },
    { periods: ["2024", "2025", "FY2025"], index: 1 },
    { periods: ["2025", "2024"], index: 0 },
    { periods: ["Q2 '25", "Q2 '26", "Q2 '25"], index: 1 },
    { periods: ["Q2 '25", "Q2 '26", "Q2 '26"], index: 1 },
    { periods: ["Q2 '26", "Q2 '25"], index: 0 },
  ])("requires unique identities across all rows and an earlier prior: $periods",
    ({ periods, index }) => {
      const basis = periods[0].startsWith("Q") ? "quarterly" : "annual";
      expect(priorComparableIndex(periodSet(periods), index, basis)).toBeNull();
    });

  it("does not override an explicit non-quarterly cadence with quarter-looking labels", () => {
    const set = periodSet(["Q2 '25", "Q2 '26"], [100, 125], { reporting_cadence: "semiannual" });
    expect(priorComparableIndex(set, 1, "quarterly")).toBeNull();
  });

  it("treats wholly empty optional identity arrays as absent legacy metadata", () => {
    const set = periodSet(["2024", "2025"], [100, 125], {
      fiscal_year: [], period_kind: [], period_number: [],
    });
    expect(priorComparableIndex(set, 1, "annual")).toBe(0);
  });
});

describe("producer fiscal identity retains precedence", () => {
  it("compares canonical half-years without consulting display labels or calendar dates", () => {
    const set = periodSet(["provider display", "provider display"], [100, 125], {
      fiscal_year: ["2025", "2026"],
      period_kind: ["half_year", "half_year"],
      period_number: [2, 2],
      period_end: ["2024-12-31", "2025-12-31"],
      reporting_cadence: "semiannual",
    });
    expect(priorComparableIndex(set, 1, "quarterly")).toBe(0);
    expect(comparablePeriodChanges(set.income.revenue, set, "quarterly")).toEqual([null, 25]);
  });

  it("does not recover a canonical missing fiscal year from apparently consecutive labels", () => {
    const set = periodSet(["2024", "2025"], [100, 125], {
      fiscal_year: ["2023", "2025"],
      period_kind: ["full_year", "full_year"],
      period_number: [null, null],
    });
    expect(priorComparableIndex(set, 1, "annual")).toBeNull();
  });

  it.each([
    { fiscal_year: ["2024", "2025"] },
    { period_kind: ["full_year", "full_year"] },
    { period_number: [null, null] },
    { fiscal_year: ["2024"], period_kind: ["full_year", "full_year"], period_number: [null, null] },
    { fiscal_year: ["2024", "2025"], period_kind: ["full_year"], period_number: [null, null] },
    { fiscal_year: ["2024", "2025"], period_kind: ["full_year", "full_year"], period_number: [] },
  ] satisfies Partial<StatementPeriodSet>[])("fails closed on partial nonempty metadata: %j", (metadata) => {
    expect(priorComparableIndex(periodSet(["2024", "2025"], [100, 125], metadata), 1, "annual"))
      .toBeNull();
  });

  it.each([
    { years: ["2024", "2025", "2024"], index: 1 },
    { years: ["2024", "2025", "2025"], index: 1 },
    { years: ["2025", "2024"], index: 0 },
  ])("requires canonical uniqueness across all rows and earlier prior: $years", ({ years, index }) => {
    const set = periodSet(years.map(() => "unparsed"), undefined, {
      fiscal_year: years,
      period_kind: years.map(() => "full_year"),
      period_number: years.map(() => null),
    });
    expect(priorComparableIndex(set, index, "annual")).toBeNull();
  });

  it.each([
    { kinds: ["quarter", "half_year"], numbers: [1, 1] },
    { kinds: ["quarter", "quarter"], numbers: [1, 2] },
  ] satisfies { kinds: NonNullable<StatementPeriodSet["period_kind"]>; numbers: number[] }[])(
    "preserves canonical period-kind and number matching: %j", ({ kinds, numbers }) => {
      const set = periodSet(["Q1 2024", "Q1 2025"], [100, 125], {
        fiscal_year: ["2024", "2025"], period_kind: kinds, period_number: numbers,
      });
      expect(priorComparableIndex(set, 1, "quarterly")).toBeNull();
    },
  );
});

describe("YoY numeric policy is unchanged", () => {
  it.each([
    { values: [null, 100], expected: null },
    { values: [100, null], expected: null },
    { values: [0, 100], expected: null },
    { values: [100, 100], expected: 0 },
    { values: [100, 0], expected: -100 },
    { values: [-100, -10], expected: 90 },
    { values: [-100, -200], expected: -100 },
    { values: [-100, 50], expected: 150 },
  ])("retains missing/zero/signed baseline behavior: $values", ({ values, expected }) => {
    const set = periodSet(["2024", "2025"], values);
    expect(comparablePeriodChanges(values, set, "annual")).toEqual([null, expected]);
  });
});

describe("current duration and source-basis qualification survives identity repair", () => {
  const canonical = (metadata: Partial<StatementPeriodSet> = {}) => periodSet(
    ["FY2024", "FY2025"], [100, 125], {
      fiscal_year: ["2024", "2025"], period_kind: ["full_year", "full_year"],
      period_number: [null, null], ...metadata,
    },
  );

  it.each([
    { duration: [] }, { duration: [12] }, { duration: [null, 12] },
    { duration: [12, null] }, { duration: [12, 9] },
  ])("withholds a malformed, absent or unequal duration: $duration", ({ duration }) => {
    expect(priorComparableIndex(canonical({ period_duration_months: duration }), 1, "annual"))
      .toBeNull();
  });

  it.each([
    { basis: [] }, { basis: ["same"] }, { basis: ["", ""] },
    { basis: ["legacy", "current"] },
  ])("withholds an incomplete or different comparison basis: $basis", ({ basis }) => {
    expect(priorComparableIndex(canonical({ comparison_basis: basis }), 1, "annual"))
      .toBeNull();
  });

  it("retains a qualified same-duration, same-source comparison", () => {
    const set = canonical({
      period_duration_months: [12, 12], comparison_basis: ["source:v1", "source:v1"],
    });
    expect(priorComparableIndex(set, 1, "annual")).toBe(0);
    expect(comparablePeriodChanges([100, 125], set, "annual")).toEqual([null, 25]);
  });

  it.each([
    { period_duration_months: [] }, { period_duration_months: [12, 12] },
    { comparison_basis: [] }, { comparison_basis: ["same", "same"] },
  ] satisfies Partial<StatementPeriodSet>[])(
    "does not use legacy labels to bypass present qualification metadata: %j",
    (metadata) => {
      const set = periodSet(["FY2024", "FY2025"], [100, 125], metadata);
      expect(priorComparableIndex(set, 1, "annual")).toBeNull();
    },
  );
});
