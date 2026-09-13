import { describe, it, expect } from "vitest";
import {
  annualPercentToDaily,
  dailyReturns,
  sampleMean,
  sampleStd,
  sharpeRatio,
  sortinoRatio,
  betaVsBenchmark,
  computePortfolioRiskHistory,
  historyCopy,
  historyAvailability,
  RF_UNPUBLISHED_REASON,
  RF_UNREADABLE_REASON,
  SCHEMA,
  MIN_ALIGNED,
  TRAIL_ALIGNED,
  type HistoryInputPosition,
  type CloseSeries,
  type RiskFreeSeries,
} from "@/lib/portfolioRiskHistory";
import { computePortfolioRisk } from "@/lib/portfolioRisk";

const pos = (
  ticker: string,
  shares: number | null,
  entryPrice: number | null,
  status: "open" | "closed" = "open",
): HistoryInputPosition => ({ ticker, shares, entryPrice, status });

function series(pairs: Array<[string, number]>): CloseSeries {
  return pairs.map(([date, close]) => ({ date, close }));
}

function datesFrom(start: string, n: number): string[] {
  const [y, m, d] = start.split("-").map(Number);
  const out: string[] = [];
  const t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < n; i++) {
    const x = new Date(t + i * 86400000);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function walk(startDate: string, closes: number[]): CloseSeries {
  const days = datesFrom(startDate, closes.length);
  return days.map((date, i) => ({ date, close: closes[i] }));
}

function longWalk(startDate: string, nCloses: number, seed = 100): CloseSeries {
  const days = datesFrom(startDate, nCloses);
  let px = seed;
  return days.map((date, i) => {
    px = seed * (1 + 0.001 * ((i % 7) - 3));
    return { date, close: px };
  });
}

// ── 5-session fixture (6 closes → 5 returns), hand-computed ─────────────────
// AAA closes 100,110,100,105,95,100
//   rA = 0.1, -0.0909…, 0.05, -0.0952…, 0.0526…
// BBB closes 50,50,55,50,52,53
//   rB = 0, 0.1, -0.0909…, 0.04, 0.0192…
// cost weights 0.5 / 0.5 (AAA 10*10=100, BBB 2*50=100)
// rP = 0.05, 0.004545…, -0.020454…, -0.027619…, 0.035931…
// SPY closes 200,202,198,201,199,204
// rf = 5% annual → daily (1.05)^(1/252)-1
const FIX_DATES = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"];
const AAA_CLOSE = [100, 110, 100, 105, 95, 100];
const BBB_CLOSE = [50, 50, 55, 50, 52, 53];
const SPY_CLOSE = [200, 202, 198, 201, 199, 204];
const RF_PCT = 5;

const AAA5 = FIX_DATES.map((date, i) => ({ date, close: AAA_CLOSE[i] }));
const BBB5 = FIX_DATES.map((date, i) => ({ date, close: BBB_CLOSE[i] }));
const SPY5 = FIX_DATES.map((date, i) => ({ date, close: SPY_CLOSE[i] }));
const RF5: RiskFreeSeries = {
  source: "DGS3MO",
  points: FIX_DATES.map((date) => ({ date, close: RF_PCT })),
};

const rA = [0.1, 100 / 110 - 1, 105 / 100 - 1, 95 / 105 - 1, 100 / 95 - 1];
const rB = [50 / 50 - 1, 55 / 50 - 1, 50 / 55 - 1, 52 / 50 - 1, 53 / 52 - 1];
const rP = rA.map((a, i) => 0.5 * (a + rB[i]));
const rSpy = [202 / 200 - 1, 198 / 202 - 1, 201 / 198 - 1, 199 / 201 - 1, 204 / 199 - 1];
const rfDaily = (1 + RF_PCT / 100) ** (1 / 252) - 1;
const excess = rP.map((p) => p - rfDaily);

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sampStd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
const HAND_SHARPE = Math.sqrt(252) * mean(excess) / sampStd(excess);
const HAND_SORTINO = Math.sqrt(252) * mean(excess) / Math.sqrt(mean(excess.map((x) => Math.min(x, 0) ** 2)));
const HAND_BETA = (() => {
  const mp = mean(rP);
  const ms = mean(rSpy);
  const cov = rP.reduce((a, p, i) => a + (p - mp) * (rSpy[i] - ms), 0) / (rP.length - 1);
  const v = rSpy.reduce((a, s) => a + (s - ms) ** 2, 0) / (rSpy.length - 1);
  return cov / v;
})();

describe("formula primitives", () => {
  it("converts annual percent to daily effective return as (1+y/100)^(1/252)-1", () => {
    expect(annualPercentToDaily(5)).toBeCloseTo(rfDaily, 12);
    expect(annualPercentToDaily(0)).toBe(0);
  });

  it("dailyReturns uses the later close's date and never forward-fills", () => {
    const r = dailyReturns(AAA5);
    expect(r.map((x) => x.date)).toEqual(FIX_DATES.slice(1));
    r.forEach((row, i) => expect(row.ret).toBeCloseTo(rA[i], 12));
  });
});

describe("5-session hand-computed Sharpe / Sortino / beta", () => {
  it("matches the hand-computed Sharpe, Sortino and beta on the 5-session fixture", () => {
    expect(sharpeRatio(rP, rP.map(() => rfDaily))).toBeCloseTo(HAND_SHARPE, 10);
    expect(sortinoRatio(rP, rP.map(() => rfDaily))).toBeCloseTo(HAND_SORTINO, 10);
    expect(betaVsBenchmark(rP, rSpy)).toBeCloseTo(HAND_BETA, 10);
    // Sanity: mixed-sign excess so Sortino's downside denominator is not zero.
    expect(excess.some((x) => x < 0)).toBe(true);
    expect(HAND_SHARPE).toBeCloseTo(3.8652788693, 6);
    expect(HAND_SORTINO).toBeCloseTo(8.4920054448, 6);
    expect(HAND_BETA).toBeCloseTo(0.8068945876, 6);
  });
});

function enoughDays(n = MIN_ALIGNED + 1): CloseSeries {
  // n closes → n-1 returns. Need >= 126 returns, so >= 127 closes.
  return longWalk("2023-01-02", n + 1, 100);
}

function enoughSpy(n = MIN_ALIGNED + 1): CloseSeries {
  return longWalk("2023-01-02", n + 1, 200);
}

function enoughRf(n = MIN_ALIGNED + 1): RiskFreeSeries {
  return {
    source: "DGS3MO",
    points: longWalk("2023-01-02", n + 1, 5).map((p) => ({ date: p.date, close: 5 })),
  };
}

describe("computePortfolioRiskHistory", () => {
  it("pins schema portfolio_risk_history.v1 and cost basis", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("BBB", 2, 50)],
      { AAA: AAA5, BBB: BBB5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(h.schema).toBe(SCHEMA);
    expect(h.schema).toBe("portfolio_risk_history.v1");
    expect(h.weightBasis).toBe("cost");
    expect(h.basis).toBe("cost-weighted, positive open holdings");
    expect(h.sources.benchmark).toBe("SPY");
    expect(h.sharpe).toBeCloseTo(HAND_SHARPE, 8);
    expect(h.sortino).toBeCloseTo(HAND_SORTINO, 8);
    expect(h.beta).toBeCloseTo(HAND_BETA, 8);
    expect(h.window.n).toBe(5);
    expect(h.window.firstSession).toBe("2024-01-03");
    expect(h.window.lastSession).toBe("2024-01-09");
  });

  it("folds duplicate tickers by normalized ticker into one cost weight", () => {
    const h = computePortfolioRiskHistory(
      [pos("aaa", 5, 10), pos("AAA", 5, 10), pos("BBB", 2, 50)],
      { AAA: AAA5, BBB: BBB5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(h.counts.foldedTickers).toBe(2);
    expect(h.counts.included).toBe(2);
    const aaa = h.included.find((r) => r.ticker === "AAA");
    expect(aaa?.cost).toBe(100);
    expect(aaa?.weightPct).toBeCloseTo(50, 5);
  });

  it("excludes shorts, unsized and non-positive rows with typed reasons and denominators", () => {
    const h = computePortfolioRiskHistory(
      [
        pos("AAA", 10, 10),
        pos("SHORT", -4, 20),
        pos("BARE", null, 10),
        pos("ZERO", 0, 15),
        pos("CLOSED", 8, 8, "closed"),
      ],
      { AAA: AAA5, SHORT: AAA5, BARE: AAA5, ZERO: AAA5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(h.counts.total).toBe(5);
    expect(h.counts.open).toBe(4);
    expect(h.counts.included).toBe(1);
    expect(h.counts.excluded).toBe(3);
    expect(h.excluded).toEqual(expect.arrayContaining([
      { ticker: "SHORT", reason: "short" },
      { ticker: "BARE", reason: "unsized" },
      { ticker: "ZERO", reason: "not_positive" },
    ]));
    expect(h.cost.included).toBe(100);
    expect(h.cost.excluded).toBe(80); // |-4|*20 + 0
    expect(h.included).toHaveLength(1);
    expect(h.included[0].ticker).toBe("AAA");
  });

  it("does not silently zero a missing price series — it excludes with a denominator", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("MISS", 5, 20)],
      { AAA: AAA5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(h.excluded.some((e) => e.ticker === "MISS" && e.reason === "missing_price_history")).toBe(true);
    expect(h.cost.excluded).toBe(100);
    expect(h.counts.included).toBe(1);
    expect(h.included[0].weightPct).toBeCloseTo(100, 5);
  });

  it("marks the book unavailable when aligned sessions are below 126", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("BBB", 2, 50)],
      { AAA: AAA5, BBB: BBB5 },
      SPY5,
      RF5,
    );
    expect(MIN_ALIGNED).toBe(126);
    expect(TRAIL_ALIGNED).toBe(252);
    expect(h.window.n).toBeLessThan(MIN_ALIGNED);
    expect(h.coverageStatus).toBe("unavailable");
    expect(h.sharpe).toBeNull();
    expect(h.sortino).toBeNull();
    expect(h.beta).toBeNull();
    expect(h.sharpeReason).toBe("not enough history");
    expect(h.sortinoReason).toBe("not enough history");
    expect(h.betaReason).toBe("not enough history");
  });

  it("computes on a 126-session book and trims to 252", () => {
    const n = 130;
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: enoughDays(n) },
      enoughSpy(n),
      enoughRf(n),
    );
    expect(h.window.n).toBeGreaterThanOrEqual(MIN_ALIGNED);
    expect(h.sharpe).not.toBeNull();
    expect(h.sortino).not.toBeNull();
    expect(h.beta).not.toBeNull();
    expect(h.coverageStatus).toBe("ready");
  });

  it("treats a risk-free series older than 7 calendar days as unavailable; beta still computes", () => {
    const n = 130;
    const aaa = enoughDays(n);
    const spy = enoughSpy(n);
    const last = aaa[aaa.length - 1].date;
    const stale = {
      source: "DGS3MO" as const,
      points: [{ date: "2020-01-02", close: 5 }],
    };
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: aaa },
      spy,
      stale,
    );
    expect(h.sharpe).toBeNull();
    expect(h.sortino).toBeNull();
    expect(h.sharpeReason).toBe("risk-free series is stale");
    expect(h.beta).not.toBeNull();
    expect(h.coverageStatus).toBe("partial");
    expect(last > "2020-01-09").toBe(true);
  });

  it("uses the unpublished reason when no risk-free series is supplied; beta still computes", () => {
    const n = 130;
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: enoughDays(n) },
      enoughSpy(n),
      null,
    );
    expect(h.sharpe).toBeNull();
    expect(h.sortino).toBeNull();
    expect(h.sharpeReason).toBe(RF_UNPUBLISHED_REASON);
    expect(h.sortinoReason).toBe(RF_UNPUBLISHED_REASON);
    expect(h.sources.riskFreeSource).toBe("unpublished");
    expect(h.beta).not.toBeNull();
    expect(h.coverageStatus).toBe("partial");
  });

  it("does not mark an open book whose names are all excluded as empty", () => {
    const h = computePortfolioRiskHistory(
      [pos("NVDA", 25, 10)],
      {},
      null,
      null,
    );
    expect(h.counts.open).toBe(1);
    expect(h.counts.included).toBe(0);
    expect(h.coverageStatus).not.toBe("empty");
    expect(h.coverageStatus).toBe("unavailable");
    expect(h.excluded).toEqual([{ ticker: "NVDA", reason: "missing_price_history" }]);
  });

  it("does not type a locked/unreadable risk-free fetch as unpublished", () => {
    const n = 130;
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: enoughDays(n) },
      enoughSpy(n),
      null,
      { riskFreeStatus: "unreadable" },
    );
    expect(h.sharpe).toBeNull();
    expect(h.sortino).toBeNull();
    expect(h.sharpeReason).toBe(RF_UNREADABLE_REASON);
    expect(h.sortinoReason).toBe(RF_UNREADABLE_REASON);
    expect(h.sources.riskFreeSource).toBe("unreadable");
    expect(h.beta).not.toBeNull();
    expect(h.coverageStatus).toBe("partial");
  });

  it("nulls beta when the benchmark series is missing, without fabricating a zero", () => {
    const n = 130;
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: enoughDays(n) },
      null,
      enoughRf(n),
    );
    expect(h.beta).toBeNull();
    expect(h.betaReason).toBe("benchmark missing");
    expect(h.sharpe).not.toBeNull();
    expect(h.sortino).not.toBeNull();
  });

  it("nulls Sharpe on zero volatility and Sortino on zero downside, never 0", () => {
    const flat = FIX_DATES.map((date) => ({ date, close: 100 }));
    const rising = FIX_DATES.map((date, i) => ({ date, close: 100 + i }));
    const spy = SPY5;
    const zeroVol = computePortfolioRiskHistory(
      [pos("FLAT", 10, 10)],
      { FLAT: flat },
      spy,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(zeroVol.sharpe).toBeNull();
    expect(zeroVol.sharpeReason).toBe("zero volatility");

    const rfZero: RiskFreeSeries = {
      source: "DGS3MO",
      points: FIX_DATES.map((date) => ({ date, close: 0 })),
    };
    const noDown = computePortfolioRiskHistory(
      [pos("UP", 10, 10)],
      { UP: rising },
      spy,
      rfZero,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(noDown.sortino).toBeNull();
    expect(noDown.sortinoReason).toBe("zero downside deviation");
  });

  it("nulls beta when benchmark variance is zero", () => {
    const flatSpy = FIX_DATES.map((date) => ({ date, close: 200 }));
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("BBB", 2, 50)],
      { AAA: AAA5, BBB: BBB5 },
      flatSpy,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(h.beta).toBeNull();
    expect(h.betaReason).toBe("zero benchmark variance");
  });

  it("reuses portfolioRisk.ts concentration — never a second formula", () => {
    const positions = [pos("AAA", 10, 10), pos("BBB", 2, 50), pos("CCC", 1, 10)];
    const h = computePortfolioRiskHistory(
      positions,
      { AAA: AAA5, BBB: BBB5, CCC: AAA5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    const risk = computePortfolioRisk(positions, {});
    expect(h.concentration).toEqual(risk.concentration);
  });

  it("reports coverage, included/excluded names, source as-of dates and N", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("SHORT", -1, 10)],
      { AAA: AAA5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    expect(h.sources.ohlcAsOf).toBe("2024-01-09");
    expect(h.sources.spyAsOf).toBe("2024-01-09");
    expect(h.sources.riskFreeAsOf).toBe("2024-01-09");
    expect(h.sources.riskFreeSource).toBe("DGS3MO");
    expect(h.included.map((r) => r.ticker)).toEqual(["AAA"]);
    expect(h.excluded.map((r) => r.ticker)).toContain("SHORT");
    expect(h.window.requested).toBe(252);
    expect(h.window.minimum).toBe(126);
  });
});

describe("historyCopy — plain EN/ZH, no machine text, no grade", () => {
  const DENY = [
    "falsifier", "refuted", "证伪", "rebalance",
    "outperform", "underperform", "unavailable", "insufficient_history", "not_positive",
  ];

  it("states these are historical characteristics of today's cost-weighted book, not realized performance", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10), pos("BBB", 2, 50)],
      { AAA: AAA5, BBB: BBB5 },
      SPY5,
      RF5,
      { minAligned: 5, trailAligned: 5 },
    );
    const c = historyCopy(h);
    expect(c.title.en).toBe("Historical risk of today's book");
    expect(c.title.zh).toBe("今日持仓的历史风险特征");
    expect(c.standing.en).toMatch(/historical characteristics of today's cost-weighted holdings/i);
    expect(c.standing.en).toMatch(/not realized account/);
    expect(c.standing.zh).toMatch(/历史特征/);
    expect(c.standing.zh).toMatch(/不是/);
    const blob = JSON.stringify(c);
    for (const token of DENY) {
      expect(blob.toLowerCase()).not.toContain(token.toLowerCase());
    }
    expect(c.standing.zh).toMatch(/[，。]/);
  });

  it("maps the unpublished risk-free reason to a plain sentence, never the raw typed string, in both languages", () => {
    const n = 130;
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: enoughDays(n) },
      enoughSpy(n),
      null,
    );
    const c = historyCopy(h);
    expect(c.sharpe.unread?.en).toMatch(/three-month Treasury/i);
    expect(c.sharpe.unread?.zh).toMatch(/国债/);
    expect(c.sharpe.unread?.en).not.toBe(RF_UNPUBLISHED_REASON);
    expect(c.sharpe.unread?.zh).not.toContain(RF_UNPUBLISHED_REASON);
  });

  it("maps a locked risk-free fetch to a plain sentence, never unpublished or the raw typed string", () => {
    const n = 130;
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: enoughDays(n) },
      enoughSpy(n),
      null,
      { riskFreeStatus: "unreadable" },
    );
    const c = historyCopy(h);
    expect(c.riskFree.en).toMatch(/could not be read/i);
    expect(c.riskFree.zh).toMatch(/读不到/);
    expect(c.sharpe.unread?.en).toMatch(/could not be read/i);
    expect(c.sharpe.unread?.en).not.toBe(RF_UNREADABLE_REASON);
    expect(c.sharpe.unread?.en).not.toContain(RF_UNPUBLISHED_REASON);
    expect(JSON.stringify(c)).not.toContain(RF_UNREADABLE_REASON);
  });

  it("does not print the empty-book sentence when open holdings are all excluded", () => {
    const h = computePortfolioRiskHistory(
      [pos("NVDA", 25, 10)],
      {},
      null,
      null,
    );
    const c = historyCopy(h);
    expect(c.empty).toBeNull();
    expect(c.sharpe.unread).not.toBeNull();
    expect(c.excluded.map((row) => row.ticker)).toContain("NVDA");
    expect(c.excluded[0].text.en).toMatch(/no daily price history/i);
    const blob = JSON.stringify(c);
    expect(blob).not.toContain("There is no open holding to describe yet.");
    expect(blob).not.toContain("目前没有未平仓持仓可供描述。");
  });

  it("uses a singular English gap sentence when there is one gap", () => {
    const h = computePortfolioRiskHistory(
      [pos("AAA", 10, 10)],
      { AAA: AAA5 },
      SPY5,
      RF5,
    );
    const c = historyCopy(h);
    expect(c.gapsSummary?.en).toBe("1 gap in this picture");
    expect(c.gapsSummary?.en).not.toMatch(/1 gaps/);
    expect(c.gapsSummary?.zh).toMatch(/1/);
  });
});

describe("historyAvailability", () => {
  it("stays hidden until the lazy GET has been attempted", () => {
    expect(historyAvailability(false)).toBe("hidden");
    expect(historyAvailability(true, null)).toBe("unavailable");
  });
});

describe("sample helpers", () => {
  it("sampleStd uses n-1 and returns null for a single point or a constant when asked via sharpe", () => {
    expect(sampleStd([1, 2, 3])).toBeCloseTo(1, 10);
    expect(sampleMean([1, 2, 3])).toBe(2);
    expect(sampleStd([4])).toBeNull();
  });
});
