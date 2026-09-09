import { describe, it, expect } from "vitest";
import {
  normalizeWeightPct,
  normalizeBandPct,
  computePortfolioTargets,
  targetsCopy,
  EN_DENYLIST,
  ZH_DENYLIST,
  T_TITLE,
  T_UNAVAILABLE,
  T_ERR_INVALID_TARGET,
  T_ERR_INVALID_BAND,
  T_ERR_NOT_HOLDING,
  T_ERR_NOT_FOUND,
  T_ARIA_TARGET,
  T_ARIA_BAND,
  T_CLEAR,
  T_SAVED,
  T_SAVE_FAIL,
  T_CURRENT,
  T_TARGET,
  T_DRIFT,
  T_BAND,
  type PortfolioTarget,
  type PortfolioTargetsSummary,
} from "@/lib/portfolioTargets";
import { computePortfolioRisk, type RiskInputPosition } from "@/lib/portfolioRisk";

const pos = (
  ticker: string,
  shares: number | null,
  entryPrice: number | null,
  status: "open" | "closed" = "open",
): RiskInputPosition => ({ ticker, shares, entryPrice, status });

const tgt = (ticker: string, targetWeightPct: number, bandPct = 5): PortfolioTarget => ({
  ticker, targetWeightPct, bandPct, updatedAt: null,
});

function denylistHits(text: string, tokens: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter((token) => {
    if (/[A-Za-z]/.test(token)) {
      const re = new RegExp(`(?:^|[^A-Za-z])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^A-Za-z])`, "i");
      return re.test(text) || lower.includes(token.toLowerCase());
    }
    return text.includes(token);
  });
}

function collectBilingual(value: { en: string; zh: string } | null | undefined, into: string[]) {
  if (!value) return;
  into.push(value.en, value.zh);
}

function allRenderedStrings(summary: PortfolioTargetsSummary): string[] {
  const out: string[] = [];
  const copy = targetsCopy(summary, "en");
  collectBilingual(copy.title, out);
  collectBilingual(copy.standing, out);
  collectBilingual(copy.basis, out);
  collectBilingual(copy.sumNote, out);
  collectBilingual(copy.emptyState, out);
  for (const row of copy.rows) {
    collectBilingual(row.current, out);
    collectBilingual(row.target, out);
    collectBilingual(row.drift, out);
    collectBilingual(row.band, out);
    collectBilingual(row.status, out);
    collectBilingual(row.unweighableNote, out);
  }
  if (copy.untargeted) {
    collectBilingual(copy.untargeted.header, out);
    for (const row of copy.untargeted.rows) collectBilingual(row.hint, out);
  }
  if (copy.orphaned) {
    collectBilingual(copy.orphaned.header, out);
    collectBilingual(copy.orphaned.explanation, out);
  }
  for (const staticCopy of [
    T_TITLE, T_UNAVAILABLE, T_ERR_INVALID_TARGET, T_ERR_INVALID_BAND,
    T_ERR_NOT_HOLDING, T_ERR_NOT_FOUND, T_ARIA_TARGET, T_ARIA_BAND,
    T_CLEAR, T_SAVED, T_SAVE_FAIL, T_CURRENT, T_TARGET, T_DRIFT, T_BAND,
  ]) {
    collectBilingual(staticCopy, out);
  }
  return out;
}

describe("normalizeWeightPct", () => {
  it("accepts a finite value between 0 and 100 inclusive", () => {
    expect(normalizeWeightPct(0)).toEqual({ kind: "value", value: 0 });
    expect(normalizeWeightPct(100)).toEqual({ kind: "value", value: 100 });
    expect(normalizeWeightPct(37.5)).toEqual({ kind: "value", value: 37.5 });
  });
  it("rejects a negative value", () => {
    expect(normalizeWeightPct(-0.1)).toEqual({ kind: "invalid" });
  });
  it("rejects a value over 100", () => {
    expect(normalizeWeightPct(100.1)).toEqual({ kind: "invalid" });
  });
  it("rejects a non-finite value (NaN, Infinity)", () => {
    expect(normalizeWeightPct(Number.NaN)).toEqual({ kind: "invalid" });
    expect(normalizeWeightPct(Number.POSITIVE_INFINITY)).toEqual({ kind: "invalid" });
  });
  it("rejects a non-numeric string", () => {
    expect(normalizeWeightPct("abc")).toEqual({ kind: "invalid" });
  });
  it("accepts a numeric string and trims it", () => {
    expect(normalizeWeightPct("  12.5  ")).toEqual({ kind: "value", value: 12.5 });
  });
});

describe("normalizeBandPct", () => {
  it("accepts a finite value between 0 and 50 inclusive", () => {
    expect(normalizeBandPct(0)).toEqual({ kind: "value", value: 0 });
    expect(normalizeBandPct(50)).toEqual({ kind: "value", value: 50 });
    expect(normalizeBandPct(5)).toEqual({ kind: "value", value: 5 });
  });
  it("rejects a negative value", () => {
    expect(normalizeBandPct(-1)).toEqual({ kind: "invalid" });
  });
  it("rejects a value over 50", () => {
    expect(normalizeBandPct(50.1)).toEqual({ kind: "invalid" });
  });
  it("rejects a non-finite value", () => {
    expect(normalizeBandPct(Number.NaN)).toEqual({ kind: "invalid" });
    expect(normalizeBandPct(Number.NEGATIVE_INFINITY)).toEqual({ kind: "invalid" });
  });
});

describe("computePortfolioTargets — arithmetic fixtures", () => {
  it("computes drift as current weight minus target for a single fully-weighted holding", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 100, 200)],
      [tgt("AAA", 80, 5)],
    );
    expect(summary.weightBasis).toBe("cost");
    expect(summary.schema).toBe("portfolio_targets.v1");
    expect(summary.drifts).toHaveLength(1);
    expect(summary.drifts[0]).toMatchObject({
      ticker: "AAA",
      currentWeightPct: 100,
      targetWeightPct: 80,
      bandPct: 5,
      driftPct: 20,
      status: "outside_band",
    });
  });

  it("treats a drift exactly equal to the band as within_band, not outside_band (inclusive boundary)", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 100, 200)],
      [tgt("AAA", 95, 5)],
    );
    expect(summary.drifts[0].driftPct).toBe(5);
    expect(summary.drifts[0].status).toBe("within_band");
  });

  it("computes weight by cost across a two-holding book, matching portfolioRisk's cost basis", () => {
    const positions = [pos("AAA", 10, 1000), pos("BBB", 100, 100)];
    const summary = computePortfolioTargets(positions, [tgt("AAA", 70, 5), tgt("BBB", 30, 5)]);
    const aaa = summary.drifts.find((d) => d.ticker === "AAA");
    const bbb = summary.drifts.find((d) => d.ticker === "BBB");
    expect(aaa?.currentWeightPct).toBe(50);
    expect(bbb?.currentWeightPct).toBe(50);
    expect(aaa?.driftPct).toBe(-20);
    expect(aaa?.status).toBe("outside_band");
    expect(bbb?.driftPct).toBe(20);
    expect(bbb?.status).toBe("outside_band");

    const risk = computePortfolioRisk(positions, {});
    expect(risk.weightBasis).toBe("cost");
    expect(risk.concentration?.top1?.weightPct).toBe(50);
    expect(aaa?.currentWeightPct).toBe(risk.concentration?.top1?.weightPct);
    expect(bbb?.currentWeightPct).toBe(risk.concentration?.top1?.weightPct);
  });

  it("excludes closed positions from current weight and from every target state", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 10, 100), pos("BBB", 10, 100, "closed")],
      [tgt("AAA", 100, 5)],
    );
    expect(summary.drifts).toHaveLength(1);
    expect(summary.drifts[0].ticker).toBe("AAA");
    expect(summary.drifts[0].currentWeightPct).toBe(100);
    expect(summary.drifts.some((d) => d.ticker === "BBB")).toBe(false);
    expect(summary.untargeted.some((u) => u.ticker === "BBB")).toBe(false);
  });

  it("marks an open position with shares but no entry price as unweighable, never zero-weighted", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 10, null)],
      [tgt("AAA", 40, 5)],
    );
    expect(summary.drifts).toHaveLength(1);
    expect(summary.drifts[0].status).toBe("unweighable");
    expect(summary.drifts[0].currentWeightPct).toBeNull();
    expect(summary.drifts[0].driftPct).toBeNull();
    expect(summary.orphaned.some((o) => o.ticker === "AAA")).toBe(false);
  });

  it("marks an open position with entry price but no shares as unweighable, never zero-weighted", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", null, 100)],
      [tgt("AAA", 40, 5)],
    );
    expect(summary.drifts).toHaveLength(1);
    expect(summary.drifts[0].status).toBe("unweighable");
    expect(summary.drifts[0].currentWeightPct).toBeNull();
    expect(summary.orphaned).toEqual([]);
  });

  it("lists a held, sized position with no saved target as untargeted, never as an implicit 0% target", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], []);
    expect(summary.drifts).toEqual([]);
    expect(summary.untargeted).toEqual([{ ticker: "AAA", currentWeightPct: 100 }]);
    expect(summary.targetsSumPct).toBeNull();
  });

  it("flags a target whose ticker is closed as orphaned, and excludes it from drifts", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 10, 100, "closed"), pos("BBB", 10, 100)],
      [tgt("AAA", 40, 8)],
    );
    expect(summary.drifts.some((d) => d.ticker === "AAA")).toBe(false);
    expect(summary.orphaned).toEqual([{ ticker: "AAA", targetWeightPct: 40, bandPct: 8 }]);
  });

  it("flags a target whose ticker no longer appears in positions at all as orphaned", () => {
    const summary = computePortfolioTargets(
      [pos("BBB", 10, 100)],
      [tgt("AAA", 25, 5)],
    );
    expect(summary.drifts).toEqual([]);
    expect(summary.orphaned).toEqual([{ ticker: "AAA", targetWeightPct: 25, bandPct: 5 }]);
  });

  it("keeps an orphaned target's own targetWeightPct and bandPct untouched, it only changes classification", () => {
    const saved = tgt("GONE", 33.3, 12);
    const summary = computePortfolioTargets([], [saved]);
    expect(summary.orphaned).toEqual([{
      ticker: "GONE",
      targetWeightPct: 33.3,
      bandPct: 12,
    }]);
  });

  it("reports targetsSumPct as the literal sum of typed targets, never rescaled to fit 100", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 10, 100), pos("BBB", 10, 100)],
      [tgt("AAA", 80), tgt("BBB", 80)],
    );
    expect(summary.targetsSumPct).toBe(160);
  });

  it("reports targetsSumOffBy100 as the signed difference from 100 (positive when over, negative when under)", () => {
    const over = computePortfolioTargets(
      [pos("AAA", 10, 100)],
      [tgt("AAA", 150)],
    );
    expect(over.targetsSumOffBy100).toBe(50);
    const under = computePortfolioTargets(
      [pos("AAA", 10, 100)],
      [tgt("AAA", 40)],
    );
    expect(under.targetsSumOffBy100).toBe(-60);
  });

  it("returns null for both sum fields when zero targets are set, never zero", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], []);
    expect(summary.targetsSumPct).toBeNull();
    expect(summary.targetsSumOffBy100).toBeNull();
  });

  it("rounds each holding's current weight and drift independently to one decimal, not via allocatePercentages", () => {
    // Three equal costs: independent 1-decimal rounding is 33.3 + 33.3 + 33.3 = 99.9,
    // whereas allocatePercentages would force a 100.0 legend sum.
    const positions = [pos("AAA", 1, 1), pos("BBB", 1, 1), pos("CCC", 1, 1)];
    const summary = computePortfolioTargets(
      positions,
      [tgt("AAA", 30), tgt("BBB", 30), tgt("CCC", 30)],
    );
    const weights = summary.drifts.map((d) => d.currentWeightPct);
    expect(weights).toEqual([33.3, 33.3, 33.3]);
    expect(weights.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBeCloseTo(99.9, 10);
    expect(summary.drifts[0].driftPct).toBe(3.3);
  });
});

describe("targetsCopy — denylist (no suggested trade, no rebalance imperative)", () => {
  it("fails when a rendered string contains a denylist token (positive control)", () => {
    expect(denylistHits("Please rebalance the book", EN_DENYLIST)).toContain("rebalance");
    expect(denylistHits("建议买入", ZH_DENYLIST).length).toBeGreaterThan(0);
  });

  it("contains none of EN_DENYLIST in any static copy string, case-insensitive", () => {
    const strings: string[] = [];
    for (const staticCopy of [
      T_TITLE, T_UNAVAILABLE, T_ERR_INVALID_TARGET, T_ERR_INVALID_BAND,
      T_ERR_NOT_HOLDING, T_ERR_NOT_FOUND, T_ARIA_TARGET, T_ARIA_BAND,
      T_CLEAR, T_SAVED, T_SAVE_FAIL, T_CURRENT, T_TARGET, T_DRIFT, T_BAND,
    ]) {
      collectBilingual(staticCopy, strings);
    }
    for (const text of strings) {
      expect(denylistHits(text, EN_DENYLIST), text).toEqual([]);
    }
  });

  it("contains none of ZH_DENYLIST in any static copy string", () => {
    const strings: string[] = [];
    for (const staticCopy of [
      T_TITLE, T_UNAVAILABLE, T_ERR_INVALID_TARGET, T_ERR_INVALID_BAND,
      T_ERR_NOT_HOLDING, T_ERR_NOT_FOUND, T_ARIA_TARGET, T_ARIA_BAND,
      T_CLEAR, T_SAVED, T_SAVE_FAIL, T_CURRENT, T_TARGET, T_DRIFT, T_BAND,
    ]) {
      collectBilingual(staticCopy, strings);
    }
    for (const text of strings) {
      expect(denylistHits(text, ZH_DENYLIST), text).toEqual([]);
    }
  });

  it("contains none of EN_DENYLIST in a populated-with-drift fixture render (mixed within/outside band)", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 100, 200), pos("BBB", 100, 200)],
      [tgt("AAA", 95, 5), tgt("BBB", 30, 5)],
    );
    for (const text of allRenderedStrings(summary)) {
      expect(denylistHits(text, EN_DENYLIST), text).toEqual([]);
    }
  });

  it("contains none of ZH_DENYLIST in the same populated-with-drift fixture render", () => {
    const summary = computePortfolioTargets(
      [pos("AAA", 100, 200), pos("BBB", 100, 200)],
      [tgt("AAA", 95, 5), tgt("BBB", 30, 5)],
    );
    for (const text of allRenderedStrings(summary)) {
      expect(denylistHits(text, ZH_DENYLIST), text).toEqual([]);
    }
  });

  it("contains none of EN_DENYLIST or ZH_DENYLIST in the orphaned-target and sum-mismatch copy specifically", () => {
    const summary = computePortfolioTargets(
      [pos("KEEP", 10, 100)],
      [tgt("GONE", 40, 5), tgt("KEEP", 80, 5)],
    );
    const copy = targetsCopy(summary, "en");
    expect(copy.orphaned).not.toBeNull();
    expect(copy.sumNote).not.toBeNull();
    const strings = allRenderedStrings(summary);
    for (const text of strings) {
      expect(denylistHits(text, EN_DENYLIST), text).toEqual([]);
      expect(denylistHits(text, ZH_DENYLIST), text).toEqual([]);
    }
  });
});
