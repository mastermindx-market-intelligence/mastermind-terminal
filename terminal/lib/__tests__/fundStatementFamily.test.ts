import { describe, expect, it } from "vitest";
import {
  applyLegacyStatementFamilyFallback,
  type Fund,
  type IncomeBlock,
  type StatementPeriodSet,
} from "../fund";
import { incomeView, isIndustrialIncomeView } from "../finStatementMath";

function income(): IncomeBlock {
  return {
    revenue: [181_847_000_000],
    cogs: [null],
    gross_profit: [null],
    opex: [null],
    op_income: [null],
    nonop_income: [null],
    pretax_income: [58_072_000_000],
    taxes: [13_372_000_000],
    net_income: [58_471_000_000],
    eps_basic: [19.76],
    eps_diluted: [19.75],
    ebitda: [null],
  };
}

function periodSet(over: Partial<StatementPeriodSet> = {}): StatementPeriodSet {
  return {
    periods: ["2025"],
    period_end: ["2025-12-31"],
    income: income(),
    balance: {} as StatementPeriodSet["balance"],
    cashflow: {} as StatementPeriodSet["cashflow"],
    ...over,
  };
}

function legacyFund(sector: string | null, over: Partial<StatementPeriodSet> = {}): Fund {
  return {
    ticker: "JPM",
    profile: { sector },
    statements: {
      annual: periodSet(over),
      quarterly: periodSet(over),
    },
  } as unknown as Fund;
}

describe("legacy financial-services statement classification", () => {
  it("uses the sourced profile sector to fail closed on industrial presentations", () => {
    const legacy = legacyFund("Financial Services");
    const classified = applyLegacyStatementFamilyFallback(legacy);

    expect(classified).not.toBe(legacy);
    expect(classified.statements.annual!.source_family).toBe("financial_services");
    expect(classified.statements.annual!.source_family_basis).toBe("profile_sector_absent_industrial_structure");
    expect(classified.statements.quarterly!.source_family).toBe("financial_services");
    expect(isIndustrialIncomeView(incomeView("JPM", classified.statements.annual, "annual"))).toBe(false);
  });

  it("treats the GICS \"Financials\" sector the live JPM artifact carries the same way", () => {
    // Live JPM.fund.json (2026-10-11) says sector "Financials", not "Financial Services";
    // matching only the latter left a bank statement presented — and comparable — as industrial.
    const legacy = legacyFund("Financials");
    const classified = applyLegacyStatementFamilyFallback(legacy);
    expect(classified.statements.annual!.source_family).toBe("financial_services");
    expect(isIndustrialIncomeView(incomeView("JPM", classified.statements.annual, "annual"))).toBe(false);
  });

  it.each(["V", "MA", "SPGI", "CME", "ICE"])(
    "keeps %s industrial when its sourced statement carries COGS/gross profit",
    (ticker) => {
      const legacy = legacyFund("Financial Services", {
        income: {
          ...income(),
          cogs: [40_000_000_000],
          gross_profit: [141_847_000_000],
          op_income: [90_000_000_000],
        },
      });
      legacy.ticker = ticker;

      expect(applyLegacyStatementFamilyFallback(legacy)).toBe(legacy);
      expect(legacy.statements.annual!.source_family).toBeUndefined();
      expect(isIndustrialIncomeView(incomeView(ticker, legacy.statements.annual, "annual"))).toBe(true);
    },
  );

  it("treats either COGS or gross profit as sufficient industrial structural evidence", () => {
    for (const structural of [
      { cogs: [1], gross_profit: [null] },
      { cogs: [null], gross_profit: [1] },
    ]) {
      const legacy = legacyFund("Financial Services", {
        income: { ...income(), ...structural },
      });
      expect(applyLegacyStatementFamilyFallback(legacy)).toBe(legacy);
    }
  });

  it("does not classify a non-financial profile", () => {
    const legacy = legacyFund("Technology");
    expect(applyLegacyStatementFamilyFallback(legacy)).toBe(legacy);
    expect(legacy.statements.annual!.source_family).toBeUndefined();
  });

  it("leaves a source-gap artifact with null statement sets usable", () => {
    const gap = legacyFund("Financial Services");
    (gap.statements as unknown as { annual: null; quarterly: null }).annual = null;
    (gap.statements as unknown as { annual: null; quarterly: null }).quarterly = null;
    expect(applyLegacyStatementFamilyFallback(gap)).toBe(gap);
  });

  it("classifies an existing set when its sibling statement set is null", () => {
    const gap = legacyFund("Financial Services");
    (gap.statements as unknown as { annual: null }).annual = null;
    const classified = applyLegacyStatementFamilyFallback(gap);
    expect((classified.statements as unknown as { annual: null }).annual).toBeNull();
    expect(classified.statements.quarterly!.source_family).toBe("financial_services");
  });

  it("never overrides producer-owned scalar or historical family evidence", () => {
    const scalar = legacyFund("Financial Services", { source_family: "industrial" });
    expect(applyLegacyStatementFamilyFallback(scalar)).toBe(scalar);
    expect(scalar.statements.annual!.source_family).toBe("industrial");

    const historical = legacyFund("Financial Services", {
      source_family_by_period: ["industrial"],
    });
    expect(applyLegacyStatementFamilyFallback(historical)).toBe(historical);
    expect(historical.statements.annual!.source_family).toBeUndefined();
  });
});
