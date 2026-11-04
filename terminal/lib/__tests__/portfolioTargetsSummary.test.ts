import { describe, expect, it } from "vitest";
import { computePortfolioTargets, isPortfolioTargetsSummary } from "../portfolioTargets";

const target = (ticker: string, targetWeightPct = 20) => ({ ticker, targetWeightPct, bandPct: 5, updatedAt: null });
const valid = computePortfolioTargets(
  [{ ticker: "AAPL", shares: 1, entryPrice: 10, entryCurrency: "USD", status: "open" },
   { ticker: "MSFT", shares: 1, entryPrice: 10, entryCurrency: "USD", status: "open" },
   { ticker: "NO-SIZE", shares: null, entryPrice: null, status: "open" },
   { ticker: "UNTARGETED", shares: null, entryPrice: null, status: "open" }],
  [target("AAPL", 50), target("MSFT", 20), target("NO-SIZE", 10), target("OLD", 5)],
);

describe("portfolio targets successful-read summary contract", () => {
  it("accepts actual producer empty, populated, unweighable and orphan-only outputs", () => {
    expect(isPortfolioTargetsSummary(computePortfolioTargets([], []))).toBe(true);
    expect(isPortfolioTargetsSummary(valid)).toBe(true);
    expect(valid.drifts.map((row) => row.status)).toEqual(["within_band", "outside_band", "unweighable"]);
    expect(valid.untargeted[0].currentWeightPct).toBeNull();
    expect(valid.targetsSumOffBy100).toBe(-15);
    expect(isPortfolioTargetsSummary(computePortfolioTargets([], [target("OLD")]))).toBe(true);
  });

  it.each([undefined, null])("accepts omitted or null cost-gap metadata (%s)", costGap => {
    const legacy = { ...valid };
    delete legacy.costGap;
    expect(isPortfolioTargetsSummary(legacy)).toBe(true);
    expect(isPortfolioTargetsSummary({ ...legacy, costGap })).toBe(true);
  });

  it.each([
    ["currency_unknown", null, 10, 100],
    ["currency_mismatch", "HKD", 10, 100],
    ["amount_overflow", "USD", 2, Number.MAX_VALUE],
  ] as const)("accepts the real producer's %s refusal with null weights", (gap, currency, shares, entryPrice) => {
    const summary = computePortfolioTargets([
      { ticker: "AAA", shares: 10, entryPrice: 100, entryCurrency: "USD", status: "open" },
      { ticker: "BBB", shares, entryPrice, entryCurrency: currency, status: "open" },
    ], [target("AAA", 70)]);
    expect(summary.costGap).toBe(gap);
    expect(isPortfolioTargetsSummary(summary)).toBe(true);
    expect(summary.drifts[0].currentWeightPct).toBeNull();
    expect(summary.untargeted[0].currentWeightPct).toBeNull();
  });

  it.each([
    ["null", null], ["array", []], ["boolean", true], ["string", "summary"],
    ["missing members", {}],
    ["unknown schema", { ...valid, schema: "portfolio_targets.v2" }],
    ["wrong weight basis", { ...valid, weightBasis: "market" }],
    ["unknown cost gap", { ...valid, costGap: "future_cause" }],
    ["object cost gap", { ...valid, costGap: {} }],
    ["numeric cost gap", { ...valid, costGap: 1 }],
    ["missing total", { ...valid, targetsSumPct: undefined }],
    ["string total", { ...valid, targetsSumPct: "85" }],
    ["non-finite total", { ...valid, targetsSumPct: Infinity }],
    ["boolean difference", { ...valid, targetsSumOffBy100: false }],
    ["non-finite difference", { ...valid, targetsSumOffBy100: NaN }],
    ["missing drifts", { ...valid, drifts: undefined }],
    ["null drifts", { ...valid, drifts: null }],
    ["object untargeted", { ...valid, untargeted: {} }],
    ["string orphaned", { ...valid, orphaned: "OLD" }],
  ])("refuses %s", (_name, summary) => {
    expect(isPortfolioTargetsSummary(summary)).toBe(false);
  });

  it.each([
    ["null drift", { ...valid, drifts: [null] }],
    ["non-string ticker", { ...valid, drifts: [{ ...valid.drifts[0], ticker: 1 }] }],
    ["non-numeric current weight", { ...valid, drifts: [{ ...valid.drifts[0], currentWeightPct: "50" }] }],
    ["non-finite current weight", { ...valid, drifts: [{ ...valid.drifts[0], currentWeightPct: Infinity }] }],
    ["null target weight", { ...valid, drifts: [{ ...valid.drifts[0], targetWeightPct: null }] }],
    ["non-finite target weight", { ...valid, drifts: [{ ...valid.drifts[0], targetWeightPct: NaN }] }],
    ["missing band", { ...valid, drifts: [{ ...valid.drifts[0], bandPct: undefined }] }],
    ["non-finite band", { ...valid, drifts: [{ ...valid.drifts[0], bandPct: Infinity }] }],
    ["non-numeric drift", { ...valid, drifts: [{ ...valid.drifts[0], driftPct: "30" }] }],
    ["non-finite drift", { ...valid, drifts: [{ ...valid.drifts[0], driftPct: NaN }] }],
    ["unknown status", { ...valid, drifts: [{ ...valid.drifts[0], status: "ready" }] }],
    ["null untargeted row", { ...valid, untargeted: [null] }],
    ["invalid untargeted ticker", { ...valid, untargeted: [{ ticker: {}, currentWeightPct: null }] }],
    ["missing untargeted weight", { ...valid, untargeted: [{ ticker: "MSFT" }] }],
    ["non-finite untargeted weight", { ...valid, untargeted: [{ ticker: "MSFT", currentWeightPct: Infinity }] }],
    ["null orphaned row", { ...valid, orphaned: [null] }],
    ["invalid orphaned ticker", { ...valid, orphaned: [{ ticker: false, targetWeightPct: 20, bandPct: 5 }] }],
    ["missing orphaned target", { ...valid, orphaned: [{ ticker: "OLD", bandPct: 5 }] }],
    ["non-finite orphaned band", { ...valid, orphaned: [{ ticker: "OLD", targetWeightPct: 20, bandPct: Infinity }] }],
  ])("refuses %s without passing unsafe rows to the readout", (_name, summary) => {
    expect(isPortfolioTargetsSummary(summary)).toBe(false);
  });
});
