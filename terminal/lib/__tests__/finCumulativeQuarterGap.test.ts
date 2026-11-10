import { describe, expect, it } from "vitest";
import { discreteQuarters, incomeChartValues, incomeView } from "../finStatementMath";
import type { IncomeBlock, StatementPeriodSet } from "../fund";

describe("cumulative quarters require an adjacent fiscal base", () => {
  it.each(["2025", "'25"])("withholds a skipped quarter for %s labels", (year) => {
    const values = [100, 350, 500];
    const periods = ["Q1", "Q3", "Q4"].map((quarter) => quarter + " " + year);
    expect(discreteQuarters(values, periods)).toEqual([100, null, 150]);
    expect(values).toEqual([100, 350, 500]);
    expect(periods).toEqual(["Q1", "Q3", "Q4"].map((quarter) => quarter + " " + year));
  });

  it.each([
    { periods: ["Q1 2025", "Q2 2025", "Q2 2025"], values: [100, 250, 260], expected: [100, 150, null] },
    { periods: ["Q3 2025", "Q2 2025"], values: [400, 250], expected: [null, null] },
    { periods: ["Q1 2025", "Q3 2025", "Q2 2025", "Q4 2025"], values: [100, 350, 250, 500], expected: [100, null, null, null] },
    { periods: ["Interim 2025", "Q2 2025"], values: [100, 250], expected: [null, null] },
    { periods: ["Q1 2025", "Interim 2025"], values: [100, 250], expected: [100, null] },
    { periods: ["Q4 2024", "Q2 2025"], values: [400, 250], expected: [null, null] },
    { periods: ["Q1 25", "Q2 2025"], values: [100, 250], expected: [100, null] },
  ])("does not invent a base for $periods", ({ periods, values, expected }) => {
    expect(discreteQuarters(values, periods)).toEqual(expected);
  });

  it("preserves Q1 passthrough, valid losses and explicit null holes", () => {
    expect(discreteQuarters([400, 100, 110], ["Q3 2024", "Q1 2025", "Q1 2025"]))
      .toEqual([null, 100, 110]);
    expect(discreteQuarters([100, 250, 180, 300], ["Q1 '25", "Q2 '25", "Q3 '25", "Q4 '25"]))
      .toEqual([100, 150, -70, 120]);
    expect(discreteQuarters([100, null, 400, 600], ["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"]))
      .toEqual([100, null, null, 200]);
    expect(discreteQuarters([300, 420], ["Q3 '25", "Q4 '25"])).toEqual([null, 120]);
  });
});

function legacySet(): StatementPeriodSet {
  const periods = [
    "Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023",
    "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024",
    "Q1 2025", "Q3 2025", "Q4 2025",
  ];
  const revenue = [100, 250, 350, 500, 110, 260, 370, 520, 100, 350, 500];
  const income: IncomeBlock = {
    revenue, cogs: [...revenue], gross_profit: [], opex: [], op_income: [],
    nonop_income: [], pretax_income: [], taxes: [], net_income: [...revenue],
    eps_basic: [...revenue], eps_diluted: [], ebitda: [],
  };
  return {
    periods, period_end: periods.map(() => "2025-12-31"), income,
    balance: {} as StatementPeriodSet["balance"],
    cashflow: {} as StatementPeriodSet["cashflow"],
  };
}

describe("the shared income view keeps the source basis", () => {
  it.each(["GAP.SS", "0700.HK"])("withholds the missing-base quarter for %s", (symbol) => {
    const set = legacySet();
    const original = JSON.stringify(set);
    const view = incomeView(symbol, set, "quarterly");
    expect(view.producerNormalized).toBe(false);
    expect(view.cumulative).toBe(true);
    for (const field of ["revenue", "cogs", "net_income"] as const) {
      expect(view.income[field].slice(-3)).toEqual([100, null, 150]);
    }
    expect(incomeChartValues(view).revenue).toBe(view.income.revenue);
    expect(view.income.eps_basic.slice(-3)).toEqual([100, null, null]);
    expect(JSON.stringify(set)).toBe(original);
  });

  it("does not difference a discrete market or an explicit producer-normalized series", () => {
    const set = legacySet();
    const us = incomeView("MSFT", set, "quarterly");
    expect(us.cumulative).toBe(false);
    expect(us.income.revenue).toBe(set.income.revenue);
    const normalized = { ...set, flow_basis: "discrete_period" as const };
    const cn = incomeView("GAP.SS", normalized, "quarterly");
    expect(cn.producerNormalized).toBe(true);
    expect(cn.cumulative).toBe(false);
    expect(cn.income.revenue).toBe(set.income.revenue);
    expect(incomeView("GAP.SS", set, "annual").income.revenue).toBe(set.income.revenue);
  });
});
