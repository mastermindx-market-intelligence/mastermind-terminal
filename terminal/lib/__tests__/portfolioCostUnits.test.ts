import { describe, expect, it } from "vitest";
import { computePortfolioRisk, riskCopy, type RiskInputPosition } from "../portfolioRisk";
import { computePortfolioTargets } from "../portfolioTargets";
import { computePortfolioRiskHistory } from "../portfolioRiskHistory";
import { positiveCostCohort } from "../portfolioMoney";

const p = (ticker: string, entryCurrency: string | null = "USD", shares = 1, entryPrice = 100): RiskInputPosition & { entryCurrency: string | null } =>
  ({ ticker, entryCurrency, shares, entryPrice, status: "open" });
const target = { ticker: "AAA", targetWeightPct: 50, bandPct: 5, updatedAt: null };
const closes = [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 101 }, { date: "2026-01-03", close: 103 }];

describe("actual monetary cohort consumers", () => {
  for (const [label, positions, gap] of [
    ["mixed currencies", [p("AAA"), p("BBB", "HKD")], "currency_mismatch"],
    ["one unknown positive lot", [p("AAA"), p("BBB", null)], "currency_unknown"],
    ["mixed duplicate-ticker lots", [p("AAA"), p("AAA", "HKD")], "currency_mismatch"],
    ["positive multiplication overflow", [p("AAA"), p("BBB", "USD", 2, 1e308)], "amount_overflow"],
  ] as const) {
    it(`${label}: risk withholds the whole weight basis`, () => {
      const risk = computePortfolioRisk(positions, {});
      expect(risk.totalCost).toBeNull(); expect(risk.concentration).toBeNull();
      expect(risk.sectors).toEqual([]); expect(risk.sizes).toEqual([]); expect(risk.liquidity).toBeNull();
      expect(risk.gaps.some(g => String(g.reason) === gap)).toBe(true);
      const copy = riskCopy(risk);
      expect(JSON.stringify(copy)).not.toContain("NaN");
    });
    it(`${label}: targets keep the user's population but cannot invent drift`, () => {
      const summary = computePortfolioTargets(positions, [target]);
      expect(summary.drifts[0]).toMatchObject({ ticker: "AAA", currentWeightPct: null, driftPct: null, status: "unweighable" });
      expect(summary.targetsSumPct).toBe(50);
      for (const holding of summary.untargeted) expect(holding.currentWeightPct).toBeNull();
    });
    it(`${label}: history cannot normalize away the invalid monetary lot`, () => {
      const history = computePortfolioRiskHistory(positions, { AAA: closes, BBB: closes }, closes, null, { minAligned: 2 });
      expect(history.coverageStatus).toBe("unavailable");
      expect(history.included).toEqual([]); expect(history.cost.known).toBeNull();
      expect(history.sharpe).toBeNull(); expect(history.sortino).toBeNull(); expect(history.beta).toBeNull();
      expect(history.gaps.some(g => String(g.reason) === gap)).toBe(true);
    });
  }
  it("same-unit controls retain risk and targets agreement", () => {
    const positions = [p("AAA"), p("BBB", "USD", 3)];
    expect(computePortfolioRisk(positions, {}).concentration?.top1).toEqual({ ticker: "BBB", weightPct: 75 });
    expect(computePortfolioTargets(positions, [target]).drifts[0].currentWeightPct).toBe(25);
    expect(positiveCostCohort(positions).money).toEqual({ amount: 400, currency: "USD" });
  });
  it("zero/closed and existing signed-cost policies do not gain monetary authority", () => {
    expect(positiveCostCohort([p("AAA"), p("ZERO", null, 0), { ...p("CLOSED", "HKD"), status: "closed" }]).money)
      .toEqual({ amount: 100, currency: "USD" });
    expect(positiveCostCohort([p("AAA"), p("SHORT", "HKD", -1)]).money)
      .toEqual({ amount: 100, currency: "USD" });
  });
});
