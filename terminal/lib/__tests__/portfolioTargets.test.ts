import { describe, it, expect } from "vitest";
import * as targetsModule from "@/lib/portfolioTargets";
import {
  normalizeWeightPct,
  normalizeBandPct,
  computePortfolioTargets,
  targetsAvailability,
  targetsCopy,
  EN_DENYLIST,
  ZH_DENYLIST,
  T_BASIS,
  T_BASIS_SHORT,
  T_EMPTY_BOOK,
  T_NO_TARGETS,
  T_UNTARGETED_HINT_UNWEIGHABLE,
  T_UNWEIGHABLE,
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

// R6 (g): every scan below reads the ACTUAL `targetsCopy` output for a fixture, and every
// exported bilingual constant is discovered by reflection over the module's own exports — there
// is no hand-picked array a new string can be forgotten out of.
function allRenderedStrings(summary: PortfolioTargetsSummary, shapeReadoutVisible = true): string[] {
  const out: string[] = [];
  const copy = targetsCopy(summary, "en", { shapeReadoutVisible });
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
    for (const row of copy.orphaned.rows) {
      collectBilingual(row.target, out);
      collectBilingual(row.band, out);
    }
  }
  return out;
}

/** Every exported `{ en, zh }` constant in the module, found by reflection so a newly added
 *  string is scanned automatically instead of waiting to be listed by hand. */
function allExportedCopy(): { name: string; value: { en: string; zh: string } }[] {
  return Object.entries(targetsModule as Record<string, unknown>)
    .filter(([, value]) => !!value && typeof value === "object"
      && typeof (value as { en?: unknown }).en === "string"
      && typeof (value as { zh?: unknown }).zh === "string")
    .map(([name, value]) => ({ name, value: value as { en: string; zh: string } }));
}

/** The six states R6 (g) names, each produced by a real fixture through the real pipeline. */
const STATE_FIXTURES: { state: string; summary: PortfolioTargetsSummary; shapeReadoutVisible: boolean }[] = [
  {
    state: "populated (mixed within/outside band)",
    summary: computePortfolioTargets(
      [pos("AAA", 100, 200), pos("BBB", 100, 200)],
      [tgt("AAA", 95, 5), tgt("BBB", 30, 5)],
    ),
    shapeReadoutVisible: true,
  },
  {
    // Both faces of unweighable: a TARGETED row with no entry price (the status sentence) and an
    // UNTARGETED short (the hint), alongside one weighable holding.
    state: "unweighable (targeted with no entry price, and an untargeted short)",
    summary: computePortfolioTargets(
      [pos("AAA", 10, null), pos("BBB", 100, 100), pos("SHORT", -50, 100)],
      [tgt("AAA", 40, 5)],
    ),
    shapeReadoutVisible: false,
  },
  {
    state: "orphaned (target on a position no longer held)",
    summary: computePortfolioTargets([pos("KEEP", 10, 100)], [tgt("GONE", 40, 5), tgt("KEEP", 80, 5)]),
    shapeReadoutVisible: true,
  },
  {
    state: "empty book",
    summary: computePortfolioTargets([], []),
    shapeReadoutVisible: false,
  },
  {
    state: "no targets yet (sized holdings, none targeted)",
    summary: computePortfolioTargets([pos("AAA", 10, 100), pos("BBB", 10, 100)], []),
    shapeReadoutVisible: true,
  },
  {
    state: "sum mismatch",
    summary: computePortfolioTargets(
      [pos("AAA", 10, 100), pos("BBB", 10, 100)],
      [tgt("AAA", 80, 5), tgt("BBB", 80, 5)],
    ),
    shapeReadoutVisible: true,
  },
];

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

  it("contains none of EN_DENYLIST in ANY exported bilingual constant, found by reflection", () => {
    const exported = allExportedCopy();
    expect(exported.length).toBeGreaterThan(20);
    for (const { name, value } of exported) {
      expect(denylistHits(value.en, EN_DENYLIST), `${name}.en`).toEqual([]);
    }
  });

  it("contains none of ZH_DENYLIST in ANY exported bilingual constant, found by reflection", () => {
    for (const { name, value } of allExportedCopy()) {
      expect(denylistHits(value.zh, ZH_DENYLIST), `${name}.zh`).toEqual([]);
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

  // R6 (g): the scan must reach every state, including the three the round-1 review found no
  // fixture ever produced — unweighable, empty book, no targets yet.
  it("scans the real targetsCopy output of every state (populated, unweighable, orphaned, empty book, no targets, sum mismatch)", () => {
    const seen: string[] = [];
    for (const fixture of STATE_FIXTURES) {
      const strings = allRenderedStrings(fixture.summary, fixture.shapeReadoutVisible);
      expect(strings.length, fixture.state).toBeGreaterThan(0);
      for (const text of strings) {
        expect(denylistHits(text, EN_DENYLIST), `${fixture.state}: ${text}`).toEqual([]);
        expect(denylistHits(text, ZH_DENYLIST), `${fixture.state}: ${text}`).toEqual([]);
      }
      seen.push(...strings);
    }
    // Proof the states really were reached: the three previously unscanned sentences are present.
    expect(seen).toContain(T_UNWEIGHABLE.en);
    expect(seen).toContain(T_EMPTY_BOOK.en);
    expect(seen).toContain(T_NO_TARGETS.en);
    expect(seen).toContain(T_UNTARGETED_HINT_UNWEIGHABLE.zh.split("{ticker}").join("SHORT"));
  });
});

// ── Round 2, ruling R2 — one weight formula, shared with portfolioRisk.ts ──────────────────────
//
// `portfolioRisk.ts` guards every position with `if (cost == null || !(cost > 0))` and records a
// `no_size` gap. Round 1 found `portfolioTargets.ts` checking finiteness only, so a short
// (negative shares) or a zero-cost row was folded into totalCost and every OTHER holding's weight
// moved. These fixtures call BOTH functions on the SAME book and pin that they agree.
describe("computePortfolioTargets — one weight formula, agreeing with computePortfolioRisk", () => {
  it("gives a short (negative shares) no weight, and every other holding keeps portfolioRisk's weight", () => {
    const positions = [pos("AAA", 100, 100), pos("BBB", 50, 100), pos("SHORT", -50, 100)];
    const summary = computePortfolioTargets(positions, [
      tgt("AAA", 60, 5), tgt("BBB", 30, 5), tgt("SHORT", 10, 5),
    ]);
    const risk = computePortfolioRisk(positions, {});

    // portfolioRisk's own published numbers for this book.
    expect(risk.totalCost).toBe(15000);
    expect(risk.concentration?.top1).toEqual({ ticker: "AAA", weightPct: 66.7 });
    expect(risk.concentration?.topNWeightPct).toBe(100);
    expect(risk.gaps).toContainEqual({ ticker: "SHORT", reason: "no_size" });

    const weight = (ticker: string) =>
      summary.drifts.find((d) => d.ticker === ticker)?.currentWeightPct;
    expect(weight("AAA")).toBe(risk.concentration?.top1?.weightPct);
    expect(weight("BBB")).toBe(33.3);
    expect((weight("AAA") ?? 0) + (weight("BBB") ?? 0)).toBe(risk.concentration?.topNWeightPct);

    const short = summary.drifts.find((d) => d.ticker === "SHORT");
    expect(short?.currentWeightPct).toBeNull();
    expect(short?.driftPct).toBeNull();
    expect(short?.status).toBe("unweighable");
  });

  it("marks a zero-cost holding unweighable — never a fabricated 0% and never a band verdict", () => {
    const positions = [pos("AAA", 100, 100), pos("ZERO", 0, 50)];
    const summary = computePortfolioTargets(positions, [tgt("AAA", 90, 5), tgt("ZERO", 10, 5)]);
    const risk = computePortfolioRisk(positions, {});

    expect(risk.totalCost).toBe(10000);
    expect(risk.gaps).toContainEqual({ ticker: "ZERO", reason: "no_size" });
    expect(summary.drifts.find((d) => d.ticker === "AAA")?.currentWeightPct)
      .toBe(risk.concentration?.top1?.weightPct);

    const zero = summary.drifts.find((d) => d.ticker === "ZERO");
    expect(zero?.currentWeightPct).toBeNull();
    expect(zero?.driftPct).toBeNull();
    expect(zero?.status).toBe("unweighable");
    expect(zero?.status).not.toBe("outside_band");
  });

  it("never fabricates a 0% weight when the whole book has zero cost", () => {
    const summary = computePortfolioTargets([pos("ZERO", 0, 50)], [tgt("ZERO", 40, 5)]);
    expect(summary.drifts[0].currentWeightPct).toBeNull();
    expect(summary.drifts[0].driftPct).toBeNull();
    expect(summary.drifts[0].status).toBe("unweighable");
  });

  it("passes a null weight through to an UNTARGETED row instead of dropping the holding", () => {
    const summary = computePortfolioTargets([pos("AAA", 100, 100), pos("SHORT", -50, 100)], []);
    const short = summary.untargeted.find((u) => u.ticker === "SHORT");
    expect(short).toBeDefined();
    expect(short?.currentWeightPct).toBeNull();
    expect(summary.untargeted.find((u) => u.ticker === "AAA")?.currentWeightPct).toBe(100);
  });

  // Heal round h3 REQUIRED 2: two open lots of the same ticker are legal (0007 has no unique
  // (user_id, ticker)). A holding is a ticker, not a lot — both compute functions must name the
  // holding and agree on its weight. RED on the pre-fix tree: risk sized each lot separately, so
  // top1 was the larger AAA lot at 50.0% while targets already reported the holding at 75.0%.
  it("treats two lots of the same ticker as one holding: AAA 100@100 + AAA 50@100 + BBB 50@100 is AAA 75.0% on both sides", () => {
    const book = [pos("AAA", 100, 100), pos("AAA", 50, 100), pos("BBB", 50, 100)];
    const summary = computePortfolioTargets(book, [tgt("AAA", 70, 5), tgt("BBB", 30, 5)]);
    const risk = computePortfolioRisk(book, {});
    expect(summary.drifts.find((d) => d.ticker === "AAA")?.currentWeightPct).toBe(75);
    expect(summary.drifts.find((d) => d.ticker === "BBB")?.currentWeightPct).toBe(25);
    expect(risk.concentration?.top1).toEqual({ ticker: "AAA", weightPct: 75 });
    expect(risk.concentration?.top1?.ticker).toBe(
      summary.drifts.find((d) => d.ticker === "AAA")?.ticker,
    );
    expect(risk.concentration?.top1?.weightPct).toBe(
      summary.drifts.find((d) => d.ticker === "AAA")?.currentWeightPct,
    );
  });
});

// ── Round 2, ruling R4 — the sum note gates on the ROUNDED sum ─────────────────────────────────
describe("targetsCopy — sum note gates on the rounded sum, never on float residue", () => {
  const book = [pos("AAA", 1, 100), pos("BBB", 1, 100), pos("CCC", 1, 100)];

  it("prints no note for 28.4 / 35.8 / 35.8 (float sum 99.99999999999999)", () => {
    const raw = 28.4 + 35.8 + 35.8;
    expect(raw).not.toBe(100); // the float residue that produced the false sentence
    const summary = computePortfolioTargets(book, [tgt("AAA", 28.4), tgt("BBB", 35.8), tgt("CCC", 35.8)]);
    expect(targetsCopy(summary, "en").sumNote).toBeNull();
  });

  it("prints no note for 65.6 / 33.3 / 1.1", () => {
    const summary = computePortfolioTargets(book, [tgt("AAA", 65.6), tgt("BBB", 33.3), tgt("CCC", 1.1)]);
    expect(targetsCopy(summary, "en").sumNote).toBeNull();
  });

  it("prints the note, with the rounded figure, for 28.4 / 35.8 / 35.7", () => {
    const summary = computePortfolioTargets(book, [tgt("AAA", 28.4), tgt("BBB", 35.8), tgt("CCC", 35.7)]);
    const note = targetsCopy(summary, "en").sumNote;
    expect(note).not.toBeNull();
    expect(note?.en).toContain("99.9%");
    expect(note?.en).not.toContain("99.90000000000001");
    expect(note?.zh).toContain("99.9%");
  });
});

// ── Round 2, ruling R6 (a) — T_NO_TARGETS is reachable ────────────────────────────────────────
describe("targetsCopy — empty-state sentence", () => {
  it("renders T_NO_TARGETS as the lead sentence when sized holdings exist with no targets set", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100), pos("BBB", 10, 100)], []);
    const copy = targetsCopy(summary, "en");
    expect(copy.emptyState).toEqual(T_NO_TARGETS);
    expect(copy.untargeted?.rows).toHaveLength(2);
  });

  it("still renders T_EMPTY_BOOK when nothing is held at all", () => {
    expect(targetsCopy(computePortfolioTargets([], []), "en").emptyState).toEqual(T_EMPTY_BOOK);
  });

  it("renders T_EMPTY_BOOK, not T_NO_TARGETS, when the only holdings are unweighable", () => {
    const summary = computePortfolioTargets([pos("AAA", null, null)], []);
    expect(targetsCopy(summary, "en").emptyState).toEqual(T_EMPTY_BOOK);
  });

  it("renders no lead sentence once a weighable target exists", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], [tgt("AAA", 50)]);
    expect(targetsCopy(summary, "en").emptyState).toBeNull();
  });
});

// ── Round 2, ruling R6 (c) — a null-weight untargeted row never prints "—%" ────────────────────
describe("targetsCopy — untargeted hint", () => {
  it("uses the unweighable hint for a null-weight row, never an em dash beside a percent sign", () => {
    const summary = computePortfolioTargets([pos("AAA", 100, 100), pos("SHORT", -50, 100)], []);
    const row = targetsCopy(summary, "en").untargeted?.rows.find((r) => r.ticker === "SHORT");
    expect(row?.hint.en).toBe("SHORT — not weighable yet (size or price missing).");
    expect(row?.hint.zh).toBe("SHORT——暂时无法计算权重（缺少数量或价格）。");
    expect(row?.hint.en).not.toContain("—%");
    expect(row?.hint.zh).not.toContain("—%");
  });

  it("keeps the ordinary hint for a weighable row", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], []);
    const row = targetsCopy(summary, "en").untargeted?.rows[0];
    expect(row?.hint.en).toBe("AAA — 100% of your book today");
    expect(row?.hint.zh).toBe("AAA — 目前占你持仓的 100%");
  });
});

// ── Round 2, ruling R6 (b) — the orphaned row carries the unit-bearing band string ─────────────
describe("targetsCopy — orphaned rows carry unit-bearing copy", () => {
  it("renders the band with its unit in both languages, never a bare number", () => {
    const summary = computePortfolioTargets([pos("KEEP", 10, 100)], [tgt("GONE", 40, 5)]);
    const row = targetsCopy(summary, "en").orphaned?.rows[0];
    expect(row?.ticker).toBe("GONE");
    expect(row?.band.en).toBe("±5 pts");
    expect(row?.band.zh).toBe("±5 个百分点");
    expect(row?.target.en).toBe("40%");
    expect(row?.target.zh).toBe("40%");
  });
});

// ── Round 2, ruling R6 (e) — T_BASIS cross-references the shape readout only when it is there ──
describe("targetsCopy — basis note", () => {
  it("cross-references the shape readout when that readout is rendered", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], [tgt("AAA", 50)]);
    expect(targetsCopy(summary, "en", { shapeReadoutVisible: true }).basis).toEqual(T_BASIS);
  });

  it("uses the short form when the shape readout is not rendered", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], [tgt("AAA", 50)]);
    const copy = targetsCopy(summary, "en", { shapeReadoutVisible: false });
    expect(copy.basis).toEqual(T_BASIS_SHORT);
    expect(copy.basis.en).not.toContain("above");
    expect(copy.basis.zh).not.toContain("上方");
  });

  it("defaults to the short form, so it can never claim a readout that is absent", () => {
    const summary = computePortfolioTargets([pos("AAA", 10, 100)], [tgt("AAA", 50)]);
    expect(targetsCopy(summary, "en").basis).toEqual(T_BASIS_SHORT);
  });
});

// ── Round 2, ruling R1 (BLOCKER) — orphaned targets survive an empty open book ─────────────────
describe("targetsAvailability — the targets section has its own gate", () => {
  const withOrphan = computePortfolioTargets([], [tgt("GONE", 40, 5)]);
  const emptyBook = computePortfolioTargets([], []);

  it("stays mounted with zero open positions when the summary carries orphaned rows", () => {
    expect(withOrphan.orphaned).toHaveLength(1);
    expect(targetsAvailability(false, withOrphan, true)).toBe("ready");
  });

  it("is ready whenever open positions exist", () => {
    expect(targetsAvailability(true, emptyBook, true)).toBe("ready");
  });

  it("is hidden when there is neither an open position nor an orphaned target", () => {
    expect(targetsAvailability(false, emptyBook, true)).toBe("hidden");
  });

  it("is unavailable only after an attempted read failed on a book with open positions", () => {
    expect(targetsAvailability(true, null, true)).toBe("unavailable");
    expect(targetsAvailability(true, null, false)).toBe("hidden");
    expect(targetsAvailability(false, null, true)).toBe("hidden");
  });
});

describe("computePortfolioTargets + targetsCopy — a closed last holding keeps its target visible", () => {
  it("keeps the orphaned row and leads with the empty-book sentence when the book is emptied", () => {
    const summary = computePortfolioTargets([pos("NVDA", 100, 200, "closed")], [tgt("NVDA", 80, 5)]);
    expect(summary.drifts).toEqual([]);
    expect(summary.untargeted).toEqual([]);
    expect(summary.orphaned).toEqual([{ ticker: "NVDA", targetWeightPct: 80, bandPct: 5 }]);

    const copy = targetsCopy(summary, "en", { shapeReadoutVisible: false });
    expect(copy.emptyState).toEqual(T_EMPTY_BOOK);
    expect(copy.orphaned?.rows.map((r) => r.ticker)).toEqual(["NVDA"]);
    expect(copy.orphaned?.explanation.en).toContain("kept, not deleted");
    expect(copy.orphaned?.explanation.zh).toContain("不会删除");
    // Heal round h3 REQUIRED 5: the sum note used to print "your targets add up to 80%, not 100%"
    // above the empty-book sentence, because orphaned targets still entered the sum. It must not
    // render when nothing weighable is held.
    expect(copy.sumNote).toBeNull();
  });
});
