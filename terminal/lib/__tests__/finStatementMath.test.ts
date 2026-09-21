import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import {
  CUMULATIVE_YTD_MARKETS,
  cumulativeQuarterNote,
  discreteQuarters,
  financialFamilyDisclosure,
  filesCumulativeQuarters,
  incomeChartValues,
  incomeView,
  incomeViewFamilyDisclosure,
  incomeViewFamilyMode,
  incomeViewOperatingExpenseLabel,
  incomeViewTopLineLabel,
  isIndustrialIncomeView,
  isIndustrialStatement,
  isCumulativeShape,
  opexExclCogs,
  operatingExpenseLabel,
  resolveStatementBasis,
  statementBasisAvailable,
  statementCadenceLabel,
  statementMarket,
} from "../finStatementMath";
import { revenueHistory } from "../finStatements";
import { incomeBridgeSteps, netMarginPct, opExpenseStep, priceToSalesSeries } from "../finSeries";
import { statementCurrencyCode, statementCurrencyLabel } from "../finFormat";
import type { Fund, IncomeBlock, StatementPeriodSet } from "../fund";
import EarningsPage from "../../components/fin/EarningsPage";
import ForecastPage from "../../components/fin/ForecastPage";
import OverviewPage from "../../components/fin/OverviewPage";
import RevenuePage from "../../components/fin/RevenuePage";
import StatisticsPage from "../../components/fin/StatisticsPage";
import StatementsPage from "../../components/fin/StatementsPage";

/**
 * MSFT-shaped quarterly revenue: 12 quarters, STRICTLY RISING, as US issuers actually report
 * them (each column is the quarter, not the year so far). This is the exact shape that armed
 * the defect — with ≥8 periods on file the old value-pattern detector reads ordinary secular
 * growth as "cumulative year-to-date" and differences the whole income statement, printing the
 * as-reported 82.9B quarter as 1.6B. Integers so equality is exact, not float-adjacent.
 */
const MSFT_REVENUE: (number | null)[] = [
  52_700_000_000, 56_500_000_000, 62_000_000_000, 65_600_000_000,
  69_600_000_000, 70_100_000_000, 76_400_000_000, 81_300_000_000,
  82_900_000_000, 84_500_000_000, 86_200_000_000, 89_000_000_000,
];
const Q_LABELS = [
  "Q1 '23", "Q2 '23", "Q3 '23", "Q4 '23",
  "Q1 '24", "Q2 '24", "Q3 '24", "Q4 '24",
  "Q1 '25", "Q2 '25", "Q3 '25", "Q4 '25",
];
/** What differencing WOULD produce — the fabricated column, kept as the thing US must not show. */
const MSFT_IF_DIFFERENCED: (number | null)[] = [
  52_700_000_000, 3_800_000_000, 5_500_000_000, 3_600_000_000,
  69_600_000_000, 500_000_000, 6_300_000_000, 4_900_000_000,
  82_900_000_000, 1_600_000_000, 1_700_000_000, 2_800_000_000,
];

function mkIncome(over: Partial<IncomeBlock> = {}): IncomeBlock {
  return {
    revenue: [], cogs: [], gross_profit: [], opex: [], op_income: [], nonop_income: [],
    pretax_income: [], taxes: [], net_income: [], eps_basic: [], eps_diluted: [], ebitda: [],
    ...over,
  };
}

function mkQuarterSet(over: Partial<StatementPeriodSet> = {}): StatementPeriodSet {
  return {
    periods: Q_LABELS,
    period_end: Q_LABELS.map(() => "2025-12-31"),
    income: mkIncome({ revenue: MSFT_REVENUE }),
    balance: {} as StatementPeriodSet["balance"],
    cashflow: {} as StatementPeriodSet["cashflow"],
    ...over,
  };
}

function mkStatisticsFund(sourceFamily: "industrial" | "bank"): Fund {
  const annual = mkQuarterSet({
    periods: ["2025"],
    period_end: ["2025-12-31"],
    source_family: sourceFamily,
    source_family_by_period: [sourceFamily],
    income: mkIncome({
      revenue: [100], gross_profit: [60], op_income: [40], net_income: [30], ebitda: [50],
    }),
  });
  return {
    ticker: sourceFamily === "industrial" ? "AAPL" : "0005.HK",
    asof: "2026-08-11",
    stmt_currency: sourceFamily === "industrial" ? "USD" : "HKD",
    statements: { annual, quarterly: undefined },
    ratios: {
      periods: ["2025"],
      pe: [20], ps: [3], pb: [2], pcf: [10], ev: [12], ev_ebitda: [14],
      current: {
        pe_ttm: 20, pe_fwd: 18, ps: 3, pb: 2, ev_ebitda: 14, ev_sales: 4,
        ev_ebit: 12, p_fcf: 11, gross_margin: 60, net_margin: 30,
      },
    },
    stats: { shares_out: 1_000_000, float_shares: 800_000 },
    profile: { employees: 1000 },
  } as unknown as Fund;
}

function mkInterimOnlyFund(sourceFamily: "industrial" | "bank" = "industrial"): Fund {
  const fund = mkStatisticsFund(sourceFamily);
  const quarterly = mkQuarterSet({
    periods: ["H1 2025", "H2 2025"],
    period_end: ["2025-06-30", "2025-12-31"],
    reporting_cadence: "semiannual",
    flow_basis: "discrete_period",
    source_family: sourceFamily,
    source_family_by_period: [sourceFamily, sourceFamily],
    income: mkIncome({
      revenue: [100, 110], gross_profit: sourceFamily === "industrial" ? [60, 65] : [null, null],
      op_income: [40, 44], net_income: [30, 33], ebitda: sourceFamily === "industrial" ? [50, 55] : [null, null],
    }),
  });
  return {
    ...fund,
    ticker: sourceFamily === "industrial" ? "0001.HK" : "0005.HK",
    statements: { annual: null, quarterly },
  } as Fund;
}

function mkCurrencyFund(stmtCurrency: string | null): Fund {
  const base = mkStatisticsFund("industrial");
  const annual = mkQuarterSet({
    periods: ["2024", "2025"],
    period_end: ["2024-12-31", "2025-12-31"],
    reporting_cadence: "annual",
    source_family: "industrial",
    source_family_by_period: ["industrial", "industrial"],
    income: mkIncome({
      revenue: [90, 100], cogs: [36, 40], gross_profit: [54, 60],
      op_income: [35, 40], net_income: [26, 30], eps_basic: [2.6, 3], ebitda: [45, 50],
    }),
  });
  const estimateSeries = {
    periods: ["2026", "2027"],
    avg: [110, 120], high: [115, 125], low: [105, 115], n: [8, 7],
  };
  return {
    ...base,
    quote_currency: "USD",
    stmt_currency: stmtCurrency,
    stats: { ...base.stats, mktcap: 1_000 },
    statements: { annual, quarterly: null },
    earnings: {
      next_date: "2026-10-01",
      next_period: "Q3 2026",
      next_eps_est: 3.2,
      next_rev_est: 110,
      q: [{
        period: "Q2 2026", end: "2026-06-30", report_date: "2026-08-01",
        eps_a: 0.8, eps_e: 0.75, rev_a: 26, rev_e: 25, surp_pct: 6.67, tx: null,
      }],
      fy: [
        { period: "2024", eps_a: 2.6, eps_e: 2.5, rev_a: 90, rev_e: 88, surp_pct: 4 },
        { period: "2025", eps_a: 3, eps_e: 2.9, rev_a: 100, rev_e: 98, surp_pct: 3.45 },
      ],
    },
    estimates: {
      eps_fy: { ...estimateSeries, avg: [3.2, 3.5], high: [3.4, 3.7], low: [3, 3.3] },
      rev_fy: estimateSeries,
      eps_q: {
        periods: ["Q3 2026", "Q4 2026"],
        avg: [0.85, 0.9], high: [0.9, 0.95], low: [0.8, 0.85], n: [8, 7],
      },
      growth: { rev_yoy: 0.1, eps_yoy: 0.08 },
    },
  } as Fund;
}

// ── F1 · the market gate ─────────────────────────────────────────────────────────────────

describe("statementMarket", () => {
  it("routes a symbol the same way the rest of the app does", () => {
    expect(statementMarket("MSFT")).toBe("us");
    expect(statementMarket("600519.SS")).toBe("cn");
    expect(statementMarket("0700.HK")).toBe("hk");
    expect(statementMarket("SHOP.TO")).toBe("ca");
    expect(statementMarket("VOD.L")).toBe("intl");
  });

  it("falls back to a market that never differences when the symbol is unknown", () => {
    expect(statementMarket(undefined)).toBe("us");
    expect(statementMarket("")).toBe("us");
    expect(filesCumulativeQuarters(undefined)).toBe(false);
  });
});

describe("filesCumulativeQuarters", () => {
  it("is true only for the markets that file cumulative year-to-date interims", () => {
    expect(CUMULATIVE_YTD_MARKETS).toEqual(["cn", "hk"]);
    expect(filesCumulativeQuarters("600519.SS")).toBe(true);
    expect(filesCumulativeQuarters("0700.HK")).toBe(true);
    for (const sym of ["MSFT", "NVDA", "AAPL", "SHOP.TO", "VOD.L", "BTC-USD"]) {
      expect(filesCumulativeQuarters(sym)).toBe(false);
    }
  });
});

describe("statement basis navigation", () => {
  it("resolves unavailable bases in both directions and leaves explicit empty states stable", () => {
    expect(resolveStatementBasis("quarterly", true, false)).toBe("annual");
    expect(resolveStatementBasis("annual", false, true)).toBe("quarterly");
    expect(resolveStatementBasis("annual", true, true)).toBe("annual");
    expect(resolveStatementBasis("quarterly", true, true)).toBe("quarterly");
    expect(resolveStatementBasis("annual", false, false)).toBe("annual");
  });

  it("treats null as unavailable and labels its disabled transport honestly as Interim", () => {
    expect(statementBasisAvailable(null)).toBe(false);
    expect(statementBasisAvailable(mkInterimOnlyFund().statements.quarterly)).toBe(true);
    expect(statementCadenceLabel(null, "quarterly", false)).toBe("Interim");
    expect(statementCadenceLabel(null, "quarterly", true)).toBe("中期");
  });
});

describe("incomeView · a US issuer is never differenced", () => {
  const set = mkQuarterSet();

  it("leaves 12 rising quarters exactly as reported", () => {
    const view = incomeView("MSFT", set, "quarterly");
    expect(view.market).toBe("us");
    expect(view.cumulative).toBe(false);
    // The as-reported figures, not the fabricated ones.
    expect(view.income.revenue).toEqual(MSFT_REVENUE);
    expect(view.income.revenue[8]).toBe(82_900_000_000);
    expect(view.income.revenue).not.toEqual(MSFT_IF_DIFFERENCED);
    // Reference-identical: nothing copied it, so nothing can have rewritten it.
    expect(view.income.revenue).toBe(set.income.revenue);
  });

  it("stays as-reported even though the VALUES do look cumulative", () => {
    // The shape check alone still says "cumulative" — this is the whole point: the market gate
    // runs FIRST, so no growth pattern can turn differencing on for a US filer.
    expect(isCumulativeShape(MSFT_REVENUE)).toBe(true);
    expect(incomeView("MSFT", set, "quarterly").cumulative).toBe(false);
  });

  it("differences the identical series for a mainland-China issuer", () => {
    const view = incomeView("600519.SS", set, "quarterly");
    expect(view.market).toBe("cn");
    expect(view.cumulative).toBe(true);
    expect(view.income.revenue).toEqual(MSFT_IF_DIFFERENCED);
  });

  it("never differences an annual set, whatever the market", () => {
    expect(incomeView("600519.SS", set, "annual").cumulative).toBe(false);
    expect(incomeView("600519.SS", set, "annual").income.revenue).toBe(set.income.revenue);
  });

  it("normalizes every additive flow but never subtracts EPS denominators", () => {
    const set2 = mkQuarterSet({
      income: mkIncome({
        revenue: MSFT_REVENUE,
        net_income: MSFT_REVENUE,
        eps_basic: MSFT_REVENUE,
        cogs: MSFT_REVENUE,
      }),
    });
    const cn = incomeView("600519.SS", set2, "quarterly");
    for (const k of ["revenue", "net_income", "cogs"] as const) {
      expect(cn.income[k]).toEqual(MSFT_IF_DIFFERENCED);
    }
    expect(cn.income.eps_basic).toEqual([
      MSFT_REVENUE[0], null, null, null,
      MSFT_REVENUE[4], null, null, null,
      MSFT_REVENUE[8], null, null, null,
    ]);
    const us = incomeView("MSFT", set2, "quarterly");
    for (const k of ["revenue", "net_income", "eps_basic", "cogs"] as const) {
      expect(us.income[k]).toEqual(MSFT_REVENUE);
    }
  });

  it("tolerates a period set that predates a contract field", () => {
    const thin = mkQuarterSet({ income: { revenue: MSFT_REVENUE } as IncomeBlock });
    expect(incomeView("MSFT", thin, "quarterly").income.ebitda).toEqual([]);
    expect(incomeView("MSFT", undefined, "quarterly").income.revenue).toEqual([]);
  });
});

// ── F1(a) · one basis per row, never a raw cell inside a differenced one ──────────────────

describe("discreteQuarters", () => {
  const labels = ["Q1 '25", "Q2 '25", "Q3 '25", "Q4 '25"];

  it("takes Q1 as-is and differences the rest of the fiscal year", () => {
    expect(discreteQuarters([100, 250, 400, 600], labels)).toEqual([100, 150, 150, 200]);
  });

  it("emits a genuine loss quarter as the negative it is", () => {
    // Cumulative net income legitimately FALLS in a loss-making quarter. Substituting the raw
    // year-to-date figure (the old `d >= 0 ? d : cur`) both hid the loss and put a cumulative
    // total in a row of discrete quarters.
    const out = discreteQuarters([100, 250, 180, 300], labels);
    expect(out).toEqual([100, 150, -70, 120]);
    expect(out[2]).not.toBe(180); // the raw cumulative value must not appear
  });

  it("shows a dash rather than a total when the cumulative base is unknown", () => {
    // Series opens mid-year: nothing to difference the first column against.
    expect(discreteQuarters([300, 420], ["Q3 '25", "Q4 '25"])).toEqual([null, 120]);
    // Fiscal year changes with no Q1 column — the new year's base was never filed here.
    expect(discreteQuarters([300, 420, 90], ["Q3 '25", "Q4 '25", "Q2 '26"])).toEqual([
      null, 120, null,
    ]);
  });

  it("propagates a null hole instead of reaching past it", () => {
    expect(discreteQuarters([100, null, 400, 600], labels)).toEqual([100, null, null, 200]);
  });
});

// ── F1(b) · the chart and the table read the SAME arrays ─────────────────────────────────

describe("incomeChartValues", () => {
  it("hands the chart the exact arrays the table prints", () => {
    for (const sym of ["MSFT", "600519.SS"]) {
      const view = incomeView(sym, mkQuarterSet(), "quarterly");
      const chart = incomeChartValues(view);
      // Reference equality, not just value equality: a surface that re-derived its own series
      // (the defect — chart plotted 82.9B while the table printed 1.6B) fails here.
      expect(chart.revenue).toBe(view.income.revenue);
      expect(chart.gross_profit).toBe(view.income.gross_profit);
      expect(chart.op_income).toBe(view.income.op_income);
      expect(chart.pretax_income).toBe(view.income.pretax_income);
      expect(chart.net_income).toBe(view.income.net_income);
    }
  });

  it("plots the differenced series on a cumulative-YTD name, never the raw one", () => {
    const set = mkQuarterSet();
    const chart = incomeChartValues(incomeView("600519.SS", set, "quarterly"));
    expect(chart.revenue).toEqual(MSFT_IF_DIFFERENCED);
    expect(chart.revenue).not.toBe(set.income.revenue);
  });

  it("is the only way StatementsPage can reach an income series", () => {
    // The value tests above prove the LIB keeps one series. This pins the WIRING: vitest
    // collects lib/__tests__ only (vitest.config.ts), so a component that went back to
    // reading `set.income` for its chart would otherwise pass every test while printing one
    // number and plotting another. Same idiom as indicatorPaneSeries.test.ts.
    const src = readFileSync(
      path.resolve(__dirname, "..", "..", "components", "fin", "StatementsPage.tsx"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bset\??\.income\b/);
    expect(code).toContain("incomeChartValues(view)");
    expect(code).toContain("incomeView(sym, set, aq)");
  });
});

// ── F1(c) · the disclosure names the market it is describing ─────────────────────────────

describe("cumulativeQuarterNote", () => {
  const set = mkQuarterSet();

  it("says nothing on a US issuer, however deep the history", () => {
    expect(cumulativeQuarterNote(incomeView("MSFT", set, "quarterly"), false)).toBeNull();
    expect(cumulativeQuarterNote(incomeView("MSFT", set, "quarterly"), true)).toBeNull();
  });

  it("names mainland China for a mainland-China filer", () => {
    const view = incomeView("600519.SS", set, "quarterly");
    expect(cumulativeQuarterNote(view, false)).toContain("mainland-China");
    expect(cumulativeQuarterNote(view, true)).toContain("中国内地");
    expect(cumulativeQuarterNote(view, false)).not.toContain("Hong Kong");
  });

  it("names Hong Kong for a Hong Kong filer", () => {
    const view = incomeView("0700.HK", set, "quarterly");
    expect(cumulativeQuarterNote(view, false)).toContain("Hong Kong");
    expect(cumulativeQuarterNote(view, true)).toContain("香港");
    expect(cumulativeQuarterNote(view, false)).not.toContain("mainland-China");
  });

  it("discloses the dashes the normalization introduces, in both languages", () => {
    const view = incomeView("600519.SS", set, "quarterly");
    expect(cumulativeQuarterNote(view, false)).toContain("dash");
    expect(cumulativeQuarterNote(view, true)).toContain("短横线");
  });

  it("does not call a partial mixed ladder discrete", () => {
    const mixed = {
      ...set,
      reporting_cadence: "mixed",
      flow_basis: "mixed_period",
      is_cumulative: set.periods.map(() => true),
      period_kind: set.periods.map(() => "year_to_date"),
    } as StatementPeriodSet;
    const view = incomeView("0700.HK", mixed, "quarterly");
    expect(cumulativeQuarterNote(view, false)).toContain("source-verifiable reporting periods");
    expect(cumulativeQuarterNote(view, false)).not.toContain("discrete reporting periods");
    expect(cumulativeQuarterNote(view, true)).toContain("经来源验证的报告期间");
  });
});

// ── F2 · "Operating expenses (excl. COGS)" is never a COGS-inclusive number ───────────────

describe("opexExclCogs", () => {
  // AAPL FY2025, the row that shipped at −158.8B before it was derived.
  const AAPL = mkIncome({
    revenue: [416_100_000_000],
    cogs: [220_900_000_000],
    gross_profit: [195_200_000_000],
    opex: [62_100_000_000],
    op_income: [133_100_000_000],
  });

  it("derives the reported figure instead of subtracting COGS from it", () => {
    expect(opexExclCogs(AAPL)).toEqual([62_100_000_000]);
    // `opex − cogs`, the shape this row used to render:
    expect(opexExclCogs(AAPL)[0]).not.toBe(-158_800_000_000);
  });

  it("still derives correctly when the raw field is the COGS-INCLUSIVE total", () => {
    // gen_fund_us's SECONDARY yfinance label for `opex` is "Total Expenses" (COGS + opex).
    const inc = mkIncome({ ...AAPL, opex: [283_000_000_000] });
    expect(opexExclCogs(inc)).toEqual([62_100_000_000]);
  });

  it("recovers the figure from revenue − COGS when gross profit itself is null", () => {
    // 416.1B − 220.9B − 133.1B = 62.1B — the same answer as gross_profit − op_income.
    const inc = mkIncome({ ...AAPL, gross_profit: [null] });
    expect(opexExclCogs(inc)).toEqual([62_100_000_000]);
  });

  it("shows a dash rather than shipping the raw total under an 'excl. COGS' label", () => {
    // Only the ambiguous raw field is available. It may be "Operating Expense" (already
    // exclusive) or "Total Expenses" (COGS-inclusive) and nothing in the payload says which —
    // so the honest answer is that we do not know, not a number that might be either.
    const inc = mkIncome({
      revenue: [null], cogs: [null], gross_profit: [null],
      opex: [283_000_000_000], op_income: [133_100_000_000],
    });
    expect(opexExclCogs(inc)).toEqual([null]);
  });

  it("is null wherever operating income is missing", () => {
    const inc = mkIncome({ ...AAPL, op_income: [null] });
    expect(opexExclCogs(inc)).toEqual([null]);
  });

  it("reads the normalized block, so a differenced statement cannot mix bases", () => {
    const set = mkQuarterSet({
      income: mkIncome({
        revenue: MSFT_REVENUE,
        gross_profit: MSFT_REVENUE,
        op_income: MSFT_REVENUE.map((v) => (v as number) / 2),
      }),
    });
    const view = incomeView("600519.SS", set, "quarterly");
    // gross_profit and op_income are both differenced before the subtraction, so the row is
    // half of the DIFFERENCED gross profit — not half of a year-to-date total.
    expect(view.opexExclCogs).toEqual(MSFT_IF_DIFFERENCED.map((v) => (v as number) / 2));
  });
});

describe("financial-family presentation", () => {
  it("uses the trusted vendor operating-expense total without inventing gross profit", () => {
    const set = mkQuarterSet({
      source_family: "bank",
      flow_basis: "discrete_period",
      reporting_cadence: "semiannual",
      income: mkIncome({ revenue: [100], opex: [60], op_income: [40] }),
    });
    const view = incomeView("0005.HK", set, "quarterly");
    expect(view.sourceFamily).toBe("bank");
    expect(view.operatingExpenses).toBe(set.income.opex);
    expect(view.opexExclCogs).toBe(set.income.opex);
    expect(operatingExpenseLabel(view.sourceFamily, false)).toBe("Operating expenses");
    expect(isIndustrialStatement(view.sourceFamily)).toBe(false);
    expect(financialFamilyDisclosure(view.sourceFamily, false)).toContain("industrial COGS");
    expect(financialFamilyDisclosure(view.sourceFamily, false)).toContain("are omitted");
  });

  it("uses the statement family aligned to each historical period", () => {
    const set = mkQuarterSet({
      periods: ["H2 2024", "H1 2025"],
      source_family: "industrial",
      source_family_by_period: ["bank", "industrial"],
      flow_basis: "discrete_period",
      reporting_cadence: "mixed",
      income: mkIncome({
        revenue: [100, 150],
        cogs: [null, 50],
        gross_profit: [null, 100],
        opex: [60, 999],
        op_income: [40, 80],
      }),
    });
    const view = incomeView("0267.HK", set, "quarterly");
    expect(view.sourceFamilies).toEqual(["bank", "industrial"]);
    expect(view.operatingExpenses).toEqual([60, 20]);
  });

  it("fails closed when one displayed history crosses industrial and financial families", () => {
    const set = mkQuarterSet({
      periods: ["H2 2024", "H1 2025"],
      source_family: "financial_services",
      source_family_by_period: ["industrial", "financial_services"],
      flow_basis: "discrete_period",
      reporting_cadence: "mixed",
      income: mkIncome({
        revenue: [100, 150],
        cogs: [40, null],
        gross_profit: [60, null],
        opex: [999, 90],
        op_income: [45, 60],
      }),
    });
    const view = incomeView("1973.HK", set, "quarterly");

    expect(view.sourceFamily).toBe("financial_services");
    expect(view.sourceFamilies).toEqual(["industrial", "financial_services"]);
    expect(incomeViewFamilyMode(view)).toBe("mixed");
    expect(isIndustrialIncomeView(view)).toBe(false);
    expect(incomeViewTopLineLabel(view, false)).toBe("Revenue / total operating income");
    expect(incomeViewTopLineLabel(view, true)).toBe("营业收入 / 经营收入总额");
    expect(incomeViewOperatingExpenseLabel(view, false)).toBe("Operating expenses");
    expect(incomeViewFamilyDisclosure(view, false)).toContain("spans industrial and financial-services");
    expect(incomeViewFamilyDisclosure(view, false)).toContain("omitted from the combined view");
  });

  it("omits industrial-only statement rows unless every displayed period is industrial", () => {
    const code = componentSource("fin", "StatementsPage.tsx");
    expect(code).toContain(
      'if (isIndustrialIncomeView(view)) {\n      rows.push(\n        mk(pick(zh, "Cost of goods sold"',
    );
    expect(code).toContain(
      'if (isIndustrialIncomeView(view)) {\n      rows.push(mk(pick(zh, "EBITDA", "EBITDA"), inc.ebitda));',
    );
    expect(code).not.toContain("isIndustrialStatement(view.sourceFamily)");
  });

  it("suppresses industrial valuation and margin rows for financials while preserving AAPL", () => {
    const financial = renderToStaticMarkup(createElement(StatisticsPage, {
      fund: mkStatisticsFund("bank"),
      sym: "0005.HK",
    }));
    const industrial = renderToStaticMarkup(createElement(StatisticsPage, {
      fund: mkStatisticsFund("industrial"),
      sym: "AAPL",
    }));
    const industrialRows = [
      "Price to sales ratio",
      "Enterprise value to EBITDA",
      "EV to sales",
      "Price to FCF",
      "Gross margin",
    ];

    for (const label of industrialRows) {
      expect(financial).not.toContain(`scope="row">${label}</th>`);
      expect(industrial).toContain(`scope="row">${label}</th>`);
    }
    expect(financial).toContain("omitted for financial-services statement formats");
  });
});

describe("nullable statement-set consumers", () => {
  it("keeps every Overview card annual and disables the absent interim basis", () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      sym: "2720.HK",
      fund: mkStatisticsFund("industrial"),
      onNavigate: () => {},
    }));

    expect(html.match(/<button class="on">Annual<\/button>/g)).toHaveLength(4);
    expect(html.match(/<button class="" disabled="">Interim<\/button>/g)).toHaveLength(4);
    expect(html).not.toContain(">Quarterly</button>");
  });

  it("selects a valid semiannual set when annual is null across reported consumers", () => {
    const fund = mkInterimOnlyFund("industrial");
    const overview = renderToStaticMarkup(createElement(OverviewPage, {
      sym: "0001.HK",
      fund,
      onNavigate: () => {},
    }));
    const statements = renderToStaticMarkup(createElement(StatementsPage, {
      sym: "0001.HK",
      fund,
      onOpenTx: () => {},
    }));
    const revenue = renderToStaticMarkup(createElement(RevenuePage, { fund, sym: "0001.HK" }));

    expect(overview.match(/<button class="" disabled="">Annual<\/button>/g)).toHaveLength(4);
    expect(overview.match(/<button class="on">Semiannual<\/button>/g)).toHaveLength(4);
    expect(statements).toContain('<button class="" disabled="">Annual</button>');
    expect(statements).toContain('<button class="on">Semiannual</button>');
    expect(statements).toContain("H1 2025");
    expect(revenue).toContain('<button class="" disabled="">Annual</button>');
    expect(revenue).toContain('<button class="on">Semiannual</button>');
    expect(revenue).toContain("H1 2025");
  });

  it("uses an interim bank receipt when annual is null instead of reopening industrial rows", () => {
    const html = renderToStaticMarkup(createElement(StatisticsPage, {
      fund: mkInterimOnlyFund("bank"),
      sym: "0005.HK",
    }));

    expect(html).toContain('<button class="" disabled="">Annual</button>');
    expect(html).toContain('<button class="on">Semiannual</button>');
    expect(html).not.toContain('scope="row">Gross margin</th>');
    expect(html).toContain("omitted for financial-services statement formats");
  });
});

describe("nullable statement currency", () => {
  function renderCurrencyConsumers(fund: Fund): Record<string, string> {
    return {
      Statements: renderToStaticMarkup(createElement(StatementsPage, {
        sym: fund.ticker, fund, onOpenTx: () => {},
      })),
      Revenue: renderToStaticMarkup(createElement(RevenuePage, {
        sym: fund.ticker, fund,
      })),
      Earnings: renderToStaticMarkup(createElement(EarningsPage, {
        sym: fund.ticker, fund,
      })),
      Statistics: renderToStaticMarkup(createElement(StatisticsPage, {
        sym: fund.ticker, fund,
      })),
      Forecast: renderToStaticMarkup(createElement(ForecastPage, {
        sym: fund.ticker, fund, bars: [], zh: false,
      })),
      Overview: renderToStaticMarkup(createElement(OverviewPage, {
        sym: fund.ticker, fund, onNavigate: () => {},
      })),
    };
  }

  it("normalizes known codes and localizes an explicit unknown receipt", () => {
    expect(statementCurrencyCode(" hkd ")).toBe("HKD");
    expect(statementCurrencyCode(null)).toBeNull();
    expect(statementCurrencyLabel(" hkd ", false)).toBe("Currency: HKD");
    expect(statementCurrencyLabel(" hkd ", true)).toBe("货币：HKD");
    expect(statementCurrencyLabel(null, false)).toBe("Statement currency unavailable");
    expect(statementCurrencyLabel(null, true)).toBe("报表货币不可用");
  });

  it("never fabricates USD, HKD, or the quote currency on statement consumers", () => {
    for (const [name, html] of Object.entries(renderCurrencyConsumers(mkCurrencyFund(null)))) {
      expect(html, name).toContain("Statement currency unavailable");
      expect(html, name).not.toContain("Currency: USD");
      expect(html, name).not.toContain("Currency: HKD");
      expect(html, name).not.toContain("Currency: CNY");
      expect(html, name).not.toMatch(/Currency:\s*null/i);
    }
  });

  it("preserves an explicit known statement currency on every consumer", () => {
    for (const [name, html] of Object.entries(renderCurrencyConsumers(mkCurrencyFund("hkd")))) {
      expect(html, name).toContain("Currency: HKD");
      expect(html, name).not.toContain("Statement currency unavailable");
    }
  });

  it("suppresses Overview's market-cap comparisons when the statement unit is unknown", () => {
    const unknown = renderCurrencyConsumers(mkCurrencyFund(null)).Overview;
    expect(unknown.match(/Comparison suppressed/g)?.length).toBeGreaterThanOrEqual(2);
    expect(unknown).toContain("Statement currency is unavailable");
    expect(unknown).not.toContain("Uses today&#x27;s market cap against each period&#x27;s revenue");

    const known = renderCurrencyConsumers(mkCurrencyFund("USD")).Overview;
    expect(known).not.toContain("Statement currency is unavailable");
    expect(known).toContain("Uses today&#x27;s market cap against each period&#x27;s revenue");
  });

  it("keeps every statement-currency fallback out of component source", () => {
    for (const parts of [
      ["fin", "StatementsPage.tsx"],
      ["fin", "RevenuePage.tsx"],
      ["fin", "EarningsPage.tsx"],
      ["fin", "StatisticsPage.tsx"],
      ["fin", "ForecastPage.tsx"],
      ["fin", "OverviewPage.tsx"],
    ]) {
      const code = componentSource(...parts);
      expect(code, parts.at(-1)).not.toMatch(/stmt_currency\s*(?:\?\?|\|\|)\s*(?:["'](?:USD|HKD|CNY)["']|ccy|quoteCur)/);
      expect(code, parts.at(-1)).toContain("statementCurrencyLabel(");
    }

    const overview = componentSource("fin", "OverviewPage.tsx");
    expect(overview).toContain("const comparisonSuppressed = statementCurrencyUnknown || crossCur");
    expect(overview).toContain("{comparisonSuppressed ? (");
    expect(overview).toContain("{comparisonSuppressed || !valIsIndustrial ? (");
  });
});

// ── F3 · the Revenue tab and the Statements tab agree ────────────────────────────────────

describe("revenueHistory shares the Statements tab's normalization", () => {
  function mkFund(ticker: string, quarterly: StatementPeriodSet): Fund {
    return {
      ticker,
      statements: { annual: quarterly, quarterly },
    } as unknown as Fund;
  }

  it("prints the same quarter as the Statements tab for a cumulative-YTD name", () => {
    const set = mkQuarterSet();
    const fund = mkFund("600519.SS", set);
    const stmtValues = incomeView("600519.SS", set, "quarterly").income.revenue;
    expect(revenueHistory(fund, "quarterly").map((p) => p.value)).toEqual(stmtValues);
    // The raw column is what the tab used to show while Statements showed the differenced one.
    expect(revenueHistory(fund, "quarterly")[9].value).toBe(1_600_000_000);
    expect(revenueHistory(fund, "quarterly")[9].value).not.toBe(84_500_000_000);
  });

  it("prints the as-reported quarter for a US name", () => {
    const set = mkQuarterSet();
    const fund = mkFund("MSFT", set);
    expect(revenueHistory(fund, "quarterly").map((p) => p.value)).toEqual(MSFT_REVENUE);
    expect(revenueHistory(fund, "quarterly")[9].value).toBe(84_500_000_000);
  });
});

// ── F4 · EVERY quarterly-capable income surface reads the same normalization ──────────────
//
// F1–F3 pinned the Statements tab and the Revenue tab. Four more surfaces read `set.income` RAW,
// so a CN/HK name plotted year-to-date totals on the rail's Financials mini, on the Overview's
// P/S line, Performance combo and conversion waterfall, and on the Earnings tab's EPS fallback —
// while the Statements tab printed the discrete quarter. Same quarter, two numbers, two tabs.

/**
 * Net income on the same 12 cumulative columns as MSFT_REVENUE — its OWN series, not a fraction
 * of revenue. A margin line that normalized only its bars and kept an inline `ni / rev` would
 * pass against a proportional fixture by coincidence; against this one it cannot.
 */
const CUM_NET_INCOME: (number | null)[] = [
  18_000_000_000, 20_000_000_000, 26_000_000_000, 31_000_000_000,
  22_000_000_000, 25_000_000_000, 33_000_000_000, 38_000_000_000,
  24_000_000_000, 28_000_000_000, 35_000_000_000, 41_000_000_000,
];
const CUM_NET_INCOME_IF_DIFFERENCED: (number | null)[] = [
  18_000_000_000, 2_000_000_000, 6_000_000_000, 5_000_000_000,
  22_000_000_000, 3_000_000_000, 8_000_000_000, 5_000_000_000,
  24_000_000_000, 4_000_000_000, 7_000_000_000, 6_000_000_000,
];
/** Cumulative EPS on those columns. Quarter-multiples so every difference is exact in binary. */
const CUM_EPS: (number | null)[] = [
  0.5, 1.25, 2.0, 2.75, 0.75, 1.5, 2.5, 3.25, 1.0, 2.0, 3.0, 4.0,
];
const CUM_EPS_SAFE: (number | null)[] = [
  0.5, null, null, null, 0.75, null, null, null, 1.0, null, null, null,
];

/** Both markets that genuinely file cumulative year-to-date interims, checked side by side. */
const CUMULATIVE_SYMS = ["600519.SS", "0700.HK"] as const;

/**
 * A cumulative-YTD quarterly statement carrying every field these surfaces touch. Revenue and the
 * six bridge rows share MSFT_REVENUE's columns (so the differenced answer is MSFT_IF_DIFFERENCED);
 * net income and EPS carry their own.
 */
function mkCumulativeSet(): StatementPeriodSet {
  return mkQuarterSet({
    income: mkIncome({
      revenue: MSFT_REVENUE,
      cogs: MSFT_REVENUE,
      gross_profit: MSFT_REVENUE,
      opex: MSFT_REVENUE,
      op_income: MSFT_REVENUE,
      nonop_income: MSFT_REVENUE,
      pretax_income: MSFT_REVENUE,
      taxes: MSFT_REVENUE,
      net_income: CUM_NET_INCOME,
      eps_basic: CUM_EPS,
    }),
  });
}

/**
 * A US issuer AFTER the Massive backfill: 69 quarterly columns, strictly rising, each column the
 * quarter as filed. This is the shape the retired value-pattern detector reads as "cumulative
 * year-to-date" — it always needed ≥8 periods, and yfinance only ever supplied 5, which is the
 * only reason the defect stayed dormant. Nothing below may difference it.
 */
const DEEP_US_LABELS: string[] = Array.from(
  { length: 69 },
  (_, i) => `Q${(i % 4) + 1} ${2009 + Math.floor(i / 4)}`,
);
const DEEP_US_REVENUE: (number | null)[] = Array.from(
  { length: 69 },
  (_, i) => 1_000_000_000 + i * 250_000_000,
);
const DEEP_US_NET_INCOME: (number | null)[] = Array.from(
  { length: 69 },
  (_, i) => 200_000_000 + i * 50_000_000,
);
const DEEP_US_EPS: (number | null)[] = Array.from({ length: 69 }, (_, i) => 0.25 + i * 0.25);

function mkDeepUsSet(): StatementPeriodSet {
  return mkQuarterSet({
    periods: DEEP_US_LABELS,
    period_end: DEEP_US_LABELS.map(() => "2026-03-31"),
    income: mkIncome({
      revenue: DEEP_US_REVENUE,
      net_income: DEEP_US_NET_INCOME,
      eps_basic: DEEP_US_EPS,
    }),
  });
}

/** Component source with comments stripped — a sentence ABOUT `set.income` is not a read of it. */
function componentSource(...parts: string[]): string {
  const src = readFileSync(path.resolve(__dirname, "..", "..", "components", ...parts), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every `<identifier>.income` read in a component, normalized-block reads excluded. */
function rawIncomeReads(code: string): string[] {
  const reads = code.match(/[A-Za-z_$][\w$]*\??\.income\b/g) ?? [];
  return reads.filter((m) => !/[Vv]iew\??\.income$/.test(m));
}

// ── F4(a) · the derived series ride ONE normalized block ─────────────────────────────────

describe("netMarginPct", () => {
  it("computes a cumulative-YTD name's margin from the DIFFERENCED pair", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const view = incomeView(sym, mkCumulativeSet(), "quarterly");
      expect(view.cumulative).toBe(true);
      const margin = netMarginPct(view.income.revenue, view.income.net_income);
      // Q2 '25: 4.0B of discrete net income on 1.6B of discrete revenue.
      expect(margin[9]).toBe(250);
      // The raw pair would have said 28.0B / 84.5B — a margin belonging to no quarter at all.
      expect(margin).not.toEqual(netMarginPct(MSFT_REVENUE, CUM_NET_INCOME));
    }
  });

  it("is the as-reported margin for a US name", () => {
    const view = incomeView("MSFT", mkCumulativeSet(), "quarterly");
    expect(netMarginPct(view.income.revenue, view.income.net_income)).toEqual(
      netMarginPct(MSFT_REVENUE, CUM_NET_INCOME),
    );
  });

  it("is null wherever a quarter has no revenue to divide by", () => {
    expect(netMarginPct([100, 0, null, 400], [10, 5, 20, null])).toEqual([10, null, null, null]);
  });
});

describe("opExpenseStep — the waterfall's gross-profit → operating-income bridge", () => {
  /**
   * AAPL FY2025, read off the LIVE vendor payload on 2026-08-08 (the same figures
   * tests/test_massive_financials.py pins in its fixture). `operating_expenses` comes back
   * 62.151B and ALREADY excludes cost of revenue — it equals gross_profit − op_income exactly,
   * which is what makes the double-subtraction detectable from the numbers alone.
   */
  const REV = 416_161_000_000;
  const COGS = 220_960_000_000;
  const GROSS = 195_201_000_000;
  const RAW_OPEX = 62_151_000_000;
  const OP_INCOME = 133_050_000_000;
  const aapl = mkIncome({
    revenue: [REV], cogs: [COGS], gross_profit: [GROSS],
    opex: [RAW_OPEX], op_income: [OP_INCOME],
  });

  it("bridges gross profit to operating income exactly", () => {
    const step = opExpenseStep(opexExclCogs(aapl), 0) as number;
    expect(GROSS + step).toBe(OP_INCOME);
  });

  it("is the 62.2B the filing reports, NOT the −158.8B double-subtraction", () => {
    const step = opExpenseStep(opexExclCogs(aapl), 0) as number;
    expect(step).toBe(-62_151_000_000);
    // What the page used to plot: -Math.abs(opex - cogs). Kept as the thing that must not return.
    expect(step).not.toBe(-Math.abs(RAW_OPEX - COGS));
    expect(Math.abs(RAW_OPEX - COGS)).toBe(158_809_000_000); // the wrong number, for the record
    // ...and the old value did not even close the bridge.
    expect(GROSS - Math.abs(RAW_OPEX - COGS)).not.toBe(OP_INCOME);
  });

  it("draws operating expenses that net NEGATIVE as the rise they are, not a fall", () => {
    // Operating income ABOVE gross profit (large other operating income): the honest step is
    // positive. `Math.abs` would have folded it into a fall of the same size.
    const inc = mkIncome({ gross_profit: [100], op_income: [140] });
    const step = opExpenseStep(opexExclCogs(inc), 0) as number;
    expect(step).toBe(40);
    expect(100 + step).toBe(140);
  });

  it("is null when nothing is derivable, so the step is omitted rather than guessed", () => {
    expect(opExpenseStep(opexExclCogs(mkIncome({ revenue: [100] })), 0)).toBeNull();
    expect(opExpenseStep([null], 0)).toBeNull();
    expect(opExpenseStep([], 0)).toBeNull();
  });
});

describe("incomeBridgeSteps — a signed bridge that closes", () => {
  it("walks every adjacent subtotal and closes exactly at net income", () => {
    const steps = incomeBridgeSteps(mkIncome({
      revenue: [416], gross_profit: [195], op_income: [133],
      pretax_income: [140], net_income: [145],
    }), 0);
    expect(steps.map((step) => step.value)).toEqual([416, -221, 195, -62, 133, 7, 140, 5, 145]);
    expect(steps.at(-1)).toEqual({ key: "net_income", value: 145, total: true });
  });

  it("keeps gains and tax benefits positive instead of folding them with Math.abs", () => {
    const steps = incomeBridgeSteps(mkIncome({
      revenue: [100], gross_profit: [60], op_income: [40],
      pretax_income: [48], net_income: [52],
    }), 0);
    expect(steps.find((step) => step.key === "to_pretax_income")?.value).toBe(8);
    expect(steps.find((step) => step.key === "to_net_income")?.value).toBe(4);
  });

  it("fails closed when a load-bearing subtotal is unavailable", () => {
    expect(incomeBridgeSteps(mkIncome({ revenue: [100], net_income: [10] }), 0)).toEqual([]);
  });
});

describe("priceToSalesSeries", () => {
  const MKTCAP = 3_200_000_000_000;

  it("divides today's market cap by the DIFFERENCED quarter", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      const view = incomeView(sym, set, "quarterly");
      const ps = priceToSalesSeries(view.income.revenue, MKTCAP, set.periods);
      expect(ps[9]).toBe(MKTCAP / 1_600_000_000);
      // The raw column would put the market cap over a year-to-date total.
      expect(ps[9]).not.toBe(MKTCAP / 84_500_000_000);
    }
  });

  it("divides by the as-reported quarter for a US name", () => {
    const set = mkCumulativeSet();
    const view = incomeView("MSFT", set, "quarterly");
    expect(priceToSalesSeries(view.income.revenue, MKTCAP, set.periods)).toEqual(
      MSFT_REVENUE.map((rev) => MKTCAP / (rev as number)),
    );
  });

  it("keeps computePS's contract: nulls the length of `periods` when no market cap is known", () => {
    const set = mkCumulativeSet();
    expect(priceToSalesSeries(set.income.revenue, null, set.periods)).toEqual(
      set.periods.map(() => null),
    );
    expect(priceToSalesSeries([], null, [])).toEqual([]);
    // A period with no revenue, or a zero one, has no P/S — never Infinity.
    expect(priceToSalesSeries([0, null, 4], 8, ["a", "b", "c"])).toEqual([null, null, 2]);
  });
});

// ── F4(b) · each fixed surface prints the Statements tab's numbers ────────────────────────

describe("every quarterly income surface agrees with the Statements tab", () => {
  it("FinancialsMini's bars and margin line print the differenced quarter", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      // What the Statements tab prints for this symbol, timeframe and set.
      const stmt = incomeView(sym, set, "quarterly");
      // What the rail's Financials mini plots.
      const mini = incomeChartValues(incomeView(sym, set, "quarterly"));
      expect(mini.revenue).toEqual(stmt.income.revenue);
      expect(mini.net_income).toEqual(stmt.income.net_income);
      expect(mini.revenue).toEqual(MSFT_IF_DIFFERENCED);
      expect(mini.net_income).toEqual(CUM_NET_INCOME_IF_DIFFERENCED);
      // Not the raw arrays the widget used to read straight off the set.
      expect(mini.revenue).not.toEqual(set.income.revenue);
      expect(mini.net_income).not.toEqual(set.income.net_income);
      expect(netMarginPct(mini.revenue, mini.net_income)).toEqual(
        netMarginPct(stmt.income.revenue, stmt.income.net_income),
      );
    }
  });

  it("FinancialsMini's ANNUAL toggle is never differenced", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      const view = incomeView(sym, set, "annual");
      expect(view.cumulative).toBe(false);
      expect(incomeChartValues(view).revenue).toBe(set.income.revenue);
    }
  });

  it("the Overview P/S line is built on the Statements tab's revenue", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      const stmt = incomeView(sym, set, "quarterly");
      expect(priceToSalesSeries(stmt.income.revenue, 1_000_000_000_000, set.periods)).toEqual(
        MSFT_IF_DIFFERENCED.map((rev) => 1_000_000_000_000 / (rev as number)),
      );
    }
  });

  it("the Overview Performance combo prints the Statements tab's revenue and net income", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      const stmt = incomeView(sym, set, "quarterly");
      const perf = incomeChartValues(incomeView(sym, set, "quarterly"));
      // Two tabs are two component instances, so this is VALUE equality across the tab boundary…
      expect(perf.revenue).toEqual(stmt.income.revenue);
      expect(perf.net_income).toEqual(stmt.income.net_income);
      expect(perf.revenue).toEqual(MSFT_IF_DIFFERENCED);
      expect(perf.net_income).toEqual(CUM_NET_INCOME_IF_DIFFERENCED);
      // …and REFERENCE equality inside the card, so its bars and its margin line cannot drift.
      expect(incomeChartValues(stmt).revenue).toBe(stmt.income.revenue);
      expect(incomeChartValues(stmt).net_income).toBe(stmt.income.net_income);
    }
  });

  it("the Overview waterfall walks the Statements tab's columns, all eight of them", () => {
    // buildWaterfall reads exactly these fields; every one of them must arrive normalized, or the
    // bridge walks a discrete revenue down to a year-to-date net income.
    const WATERFALL_FIELDS = [
      "revenue", "cogs", "gross_profit", "opex", "op_income", "nonop_income", "taxes", "net_income",
    ] as const;
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      const stmt = incomeView(sym, set, "quarterly");
      for (const k of WATERFALL_FIELDS) {
        expect(stmt.income[k]).toEqual(
          k === "net_income" ? CUM_NET_INCOME_IF_DIFFERENCED : MSFT_IF_DIFFERENCED,
        );
        expect(stmt.income[k]).not.toEqual(set.income[k]);
      }
    }
  });

  it("the Earnings EPS fallback prints the Statements tab's Basic EPS row", () => {
    for (const sym of CUMULATIVE_SYMS) {
      const set = mkCumulativeSet();
      const stmt = incomeView(sym, set, "quarterly");
      // The fallback is always the QUARTERLY set, so it always reads this view.
      expect(stmt.income.eps_basic).toEqual(CUM_EPS_SAFE);
      expect(stmt.income.eps_basic).not.toEqual(set.income.eps_basic);
      // And the disclosure names the market it is describing, rather than asserting differencing
      // unconditionally the way the page's own fallback note used to.
      expect(cumulativeQuarterNote(stmt, false)).toContain(sym.endsWith(".HK") ? "Hong Kong" : "mainland-China");
    }
  });
});

// ── F4(c) · the wiring: no surface can reach a raw income series ──────────────────────────

describe("no financials surface can reach a raw income series", () => {
  // Same idiom as the StatementsPage guard above: vitest collects lib/__tests__ only, so a
  // component that went back to `set.income` would pass every value test in this file while
  // plotting a number the Statements tab never prints.

  it("StockAnalysisImpl's FinancialsMini reads only the normalized block", () => {
    const code = componentSource("StockAnalysisImpl.tsx");
    expect(rawIncomeReads(code)).toEqual([]);
    expect(code).not.toMatch(/\bps\??\.income\b/);
    expect(code).toContain('incomeView(fund?.ticker, ps, timeframe)');
    expect(code).toContain("incomeChartValues(view)");
    expect(code).toContain("resolveStatementBasis(");
    expect(code).toContain("disabled={!annualAvailable}");
    // The margin line is the shared helper, not a second inline copy of `ni / rev`.
    expect(code).toContain("netMarginPct(rev, ni)");
  });

  it("OverviewPage's valuation, performance and waterfall read only the normalized block", () => {
    const code = componentSource("fin", "OverviewPage.tsx");
    // `latestEps` is the ONE raw read left, and it is called only with the ANNUAL set — a
    // timeframe incomeView never differences. Anything else appearing here is a regression.
    expect(rawIncomeReads(code)).toEqual(["set?.income"]);
    expect(code).toContain("incomeView(sym, valSet, valAQ)");
    expect(code).toContain("incomeView(sym, perfSet, perfAQ)");
    expect(code).toContain("incomeView(sym, wfSet, wfAQ)");
    expect(code).toContain("incomeView(sym, hSet, healthAQ)");
    expect(code.match(/resolveStatementBasis\(requested/g)?.length).toBe(4);
    expect(code).toContain("disabled={!annualAvailable}");
    expect(code).toContain("disabled={!interimAvailable}");
    // The waterfall takes the normalized BLOCK, so no set is in scope for it to read.
    expect(code).toContain("buildWaterfall(wfView.income, wfIdx, zh)");
    expect(code).toMatch(/function buildWaterfall\(inc: IncomeBlock, i: number,/);
    // The pure helper uses signed adjacent-subtotal deltas. The component only localizes labels.
    expect(code).toContain("incomeBridgeSteps(inc, i)");
    expect(code).not.toMatch(/opex\s*-\s*cogs/);
    expect(code).not.toMatch(/Math\.abs\((opex|taxes)/);
    // P/S moved to lib/finSeries — the page-private copy is gone, not shadowed.
    expect(code).not.toContain("function computePS");
    expect(code).toContain("priceToSalesSeries(valView.income.revenue");
    expect(code).toContain("netMarginPct(perfInc.revenue, perfInc.net_income)");
    expect(code).toContain("isIndustrialIncomeView(valView)");
    expect(code).toContain("isIndustrialIncomeView(wfView)");
    expect(code).toContain("const hIsIndustrial = isIndustrialIncomeView(hView)");
    expect(code).toMatch(/\.\.\.\(hIsIndustrial\s*\?\s*\[\{ name: pick\(zh, "Free cash flow"/);
    expect(code).not.toMatch(/isIndustrialStatement\([^)]*\.sourceFamily/);
  });

  it("EarningsPage reads only the normalized block, and keeps no second copy of the math", () => {
    const code = componentSource("fin", "EarningsPage.tsx");
    expect(rawIncomeReads(code)).toEqual([]);
    expect(code).toContain('incomeView(sym ?? fund.ticker, stmtQtr, "quarterly")');
    expect(code).toContain("const canonicalInterimEps = buildEpsFromStatements(stmtEpsView)");
    expect(code).toContain("estimateSeriesHasValue(estimates?.eps_q)");
    expect(code).not.toContain("!!estimates?.eps_q?.periods?.length");
    expect(code).toContain('statementCadenceLabel(stmtQtr, "quarterly", !!zh)');
    expect(code).toContain("disabled={!epsInterimAvailable}");
    expect(code).toContain("const canonicalInterimRevenue = buildRevenueFromStatements(stmtRevenueView)");
    // The page's own out-of-date reimplementation is DELETED, not merely unused: `discreteEps`
    // kept the raw cumulative value on a negative difference (hiding a genuine loss quarter under
    // a year-to-date total) and `isCumulativeEps` was the shape-only detector with no market gate.
    expect(code).not.toMatch(/discreteEps/);
    expect(code).not.toMatch(/isCumulativeEps/);
  });

  it("ForecastPage's statement actuals use the canonical annual view", () => {
    const code = componentSource("fin", "ForecastPage.tsx");
    expect(rawIncomeReads(code)).toEqual([]);
    expect(code).toContain('incomeView(fund?.ticker, ann, "annual")');
    expect(code).toContain("incomeViewTopLineLabel(annualView");
    expect(code).toContain("isIndustrialIncomeView(annualView)");
  });

  it("all mixed-family income consumers use view-wide labels and gates", () => {
    for (const parts of [
      ["fin", "StatementsPage.tsx"],
      ["fin", "RevenuePage.tsx"],
      ["fin", "OverviewPage.tsx"],
      ["fin", "ForecastPage.tsx"],
      ["StockAnalysis.tsx"],
    ]) {
      const code = componentSource(...parts);
      expect(code, parts.at(-1)).not.toMatch(/incomeTopLineLabel\([^)]*\.sourceFamily/);
      expect(code, parts.at(-1)).not.toMatch(/isIndustrialStatement\([^)]*\.sourceFamily/);
    }
    const statistics = componentSource("fin", "StatisticsPage.tsx");
    expect(statistics).toContain("const familyReceipt = annualAvailable");
    expect(statistics).toContain("? fund.statements?.quarterly");
    expect(statistics).toContain("industrialMetricsApply = !!familyReceipt && isIndustrialIncomeView(annualIncomeView)");
    expect(statistics).toContain("resolveStatementBasis(requestedMode, annualAvailable, interimAvailable)");
    expect(statistics.match(/\.\.\.\(industrialMetricsApply/g)?.length).toBeGreaterThanOrEqual(7);
    expect(statistics).toContain("!industrialMetricsApply");
  });
});

// ── F4(d) · the negative: 69 rising US quarters, differenced by nothing ───────────────────

describe("a US name with 69 rising quarters is differenced by no surface", () => {
  it("looks cumulative by SHAPE and is still left exactly as reported", () => {
    // The market gate runs first, so the shape check never gets to decide.
    expect(isCumulativeShape(DEEP_US_REVENUE)).toBe(true);
    for (const sym of ["MSFT", "NVDA"]) {
      const set = mkDeepUsSet();
      const view = incomeView(sym, set, "quarterly");
      expect(view.cumulative).toBe(false);
      expect(view.income.revenue).toBe(set.income.revenue);
      expect(view.income.revenue).toEqual(DEEP_US_REVENUE);
      // The fabricated column is a real, computable array — and must appear nowhere.
      expect(view.income.revenue).not.toEqual(discreteQuarters(DEEP_US_REVENUE, DEEP_US_LABELS));
    }
  });

  it("plots the as-reported quarter on every fixed surface", () => {
    const set = mkDeepUsSet();
    const view = incomeView("MSFT", set, "quarterly");
    const chart = incomeChartValues(view);
    // FinancialsMini bars + Overview Performance bars
    expect(chart.revenue).toEqual(DEEP_US_REVENUE);
    expect(chart.net_income).toEqual(DEEP_US_NET_INCOME);
    // both margin lines
    expect(netMarginPct(chart.revenue, chart.net_income)).toEqual(
      netMarginPct(DEEP_US_REVENUE, DEEP_US_NET_INCOME),
    );
    // Overview P/S line
    expect(priceToSalesSeries(view.income.revenue, 4_000_000_000_000, set.periods)).toEqual(
      DEEP_US_REVENUE.map((rev) => 4_000_000_000_000 / (rev as number)),
    );
    // Earnings EPS fallback
    expect(view.income.eps_basic).toEqual(DEEP_US_EPS);
    // Statements tab, for the cross-tab equality this whole section is about
    expect(revenueHistory(
      { ticker: "MSFT", statements: { annual: set, quarterly: set } } as unknown as Fund,
      "quarterly",
    ).map((p) => p.value)).toEqual(DEEP_US_REVENUE);
  });

  it("says nothing about cumulative reporting on a US filer's surfaces", () => {
    const view = incomeView("MSFT", mkDeepUsSet(), "quarterly");
    expect(cumulativeQuarterNote(view, false)).toBeNull();
    expect(cumulativeQuarterNote(view, true)).toBeNull();
  });
});
