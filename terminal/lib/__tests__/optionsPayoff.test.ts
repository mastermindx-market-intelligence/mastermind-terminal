import { describe, expect, it } from "vitest";
import {
  OPTION_CONTRACT_MULTIPLIER,
  analyzeExpirationPayoff,
  entryCashflow,
  payoffAtExpiry,
  payoffLegAtExpiry,
  type PayoffLegInput,
} from "@/lib/optionsPayoff";

const leg = (overrides: Partial<PayoffLegInput> = {}): PayoffLegInput => ({
  id: "a",
  right: "C",
  side: "long",
  strike: 100,
  premium: 4,
  quantity: 1,
  ...overrides,
});

describe("options expiration payoff — deterministic owner", () => {
  it("uses the disclosed 100-share multiplier", () => {
    expect(OPTION_CONTRACT_MULTIPLIER).toBe(100);
    expect(payoffLegAtExpiry(leg(), 110)).toBe(600);
    expect(payoffLegAtExpiry(leg(), 90)).toBe(-400);
  });

  it("long call has one break-even, bounded loss, and unlimited profit", () => {
    const a = analyzeExpirationPayoff([leg()]);
    expect(a.valid).toBe(true);
    expect(a.entryCashflow).toBe(-400);
    expect(a.breakEvens).toEqual([104]);
    expect(a.maxLoss).toBe(400);
    expect(a.maxLossUnlimited).toBe(false);
    expect(a.bestExpiryPnl).toBeNull();
    expect(a.bestExpiryPnlUnlimited).toBe(true);
    expect(a.highPriceSlope).toBe(100);
  });

  it("long put has bounded profit and bounded loss", () => {
    const a = analyzeExpirationPayoff([leg({ right: "P", strike: 100, premium: 5 })]);
    expect(a.breakEvens).toEqual([95]);
    expect(a.bestExpiryPnl).toBe(9500);
    expect(a.bestExpiryPnlUnlimited).toBe(false);
    expect(a.maxLoss).toBe(500);
    expect(a.maxLossUnlimited).toBe(false);
  });

  it("bull call spread calculates debit, break-even, max profit and max loss", () => {
    const legs = [
      leg({ id: "long", strike: 100, premium: 4.2 }),
      leg({ id: "short", side: "short", strike: 110, premium: 1.6 }),
    ];
    const a = analyzeExpirationPayoff(legs);
    expect(a.entryCashflow).toBe(-260);
    expect(a.breakEvens).toEqual([102.6]);
    expect(a.bestExpiryPnl).toBe(740);
    expect(a.maxLoss).toBe(260);
    expect(a.bestExpiryPnlUnlimited).toBe(false);
    expect(a.maxLossUnlimited).toBe(false);
    expect(payoffAtExpiry(legs, 110)).toBe(740);
  });

  it("credit put spread keeps the entry credit and bounded downside", () => {
    const legs = [
      leg({ id: "short-put", right: "P", side: "short", strike: 100, premium: 4 }),
      leg({ id: "long-put", right: "P", side: "long", strike: 90, premium: 1.5 }),
    ];
    const a = analyzeExpirationPayoff(legs);
    expect(entryCashflow(legs)).toBe(250);
    expect(a.breakEvens).toEqual([97.5]);
    expect(a.bestExpiryPnl).toBe(250);
    expect(a.maxLoss).toBe(750);
  });

  it("iron condor reports both break-even roots", () => {
    const legs = [
      leg({ id: "lp", right: "P", strike: 90, premium: 0.7 }),
      leg({ id: "sp", right: "P", side: "short", strike: 95, premium: 1.5 }),
      leg({ id: "sc", side: "short", strike: 105, premium: 1.4 }),
      leg({ id: "lc", strike: 110, premium: 0.6 }),
    ];
    const a = analyzeExpirationPayoff(legs);
    expect(a.entryCashflow).toBe(160);
    expect(a.breakEvens).toEqual([93.4, 106.6]);
    expect(a.bestExpiryPnl).toBe(160);
    expect(a.maxLoss).toBe(340);
  });

  it("net short call ratio correctly exposes unlimited upside loss", () => {
    const legs = [
      leg({ id: "long", strike: 100, premium: 5, quantity: 1 }),
      leg({ id: "short", side: "short", strike: 110, premium: 2, quantity: 2 }),
    ];
    const a = analyzeExpirationPayoff(legs);
    expect(a.highPriceSlope).toBe(-100);
    expect(a.maxLossUnlimited).toBe(true);
    expect(a.maxLoss).toBeNull();
    expect(a.bestExpiryPnlUnlimited).toBe(false);
    expect(a.breakEvens.length).toBe(2);
  });

  it("genuine zero premium stays zero rather than unavailable", () => {
    const a = analyzeExpirationPayoff([leg({ premium: 0 })]);
    expect(a.valid).toBe(true);
    expect(a.entryCashflow).toBe(0);
    expect(a.maxLoss).toBe(0);
    expect(a.breakEvens).toEqual([]);
    expect(a.breakEvenRanges).toEqual([{ from: 0, to: 100 }]);
  });

  it("reports the negative best expiry P/L when every outcome loses", () => {
    const a = analyzeExpirationPayoff([
      leg({ id: "long", side: "long", strike: 100, premium: 5 }),
      leg({ id: "short", side: "short", strike: 100, premium: 4 }),
    ]);
    expect(a.entryCashflow).toBe(-100);
    expect(a.bestExpiryPnlUnlimited).toBe(false);
    expect(a.bestExpiryPnl).toBe(-100);
    expect(a.maxLoss).toBe(100);
    expect(a.breakEvens).toEqual([]);
    expect(a.breakEvenRanges).toEqual([]);
  });

  it("never evaluates negative underlying prices", () => {
    const a = analyzeExpirationPayoff([leg()]);
    expect(a.chart.length).toBeGreaterThan(20);
    expect(Math.min(...a.chart.map((p) => p.price))).toBeGreaterThanOrEqual(0);
    expect(payoffAtExpiry([leg()], -1)).toBeNaN();
  });

  it("rejects malformed legs rather than coercing them", () => {
    const malformed = leg({ strike: Number.NaN, premium: -1, quantity: 1.5 });
    const a = analyzeExpirationPayoff([malformed]);
    expect(a.valid).toBe(false);
    expect(a.chart).toEqual([]);
    expect(a.errors.join(" ")).toMatch(/strike/);
    expect(a.errors.join(" ")).toMatch(/premium/);
    expect(a.errors.join(" ")).toMatch(/quantity/);
  });

  it("rejects duplicate leg ids and more than six legs", () => {
    const duplicate = analyzeExpirationPayoff([leg({ id: "same" }), leg({ id: "same", strike: 110 })]);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors).toContain("leg ids must be unique");
    const tooMany = analyzeExpirationPayoff(Array.from({ length: 7 }, (_, i) => leg({ id: String(i), strike: 90 + i })));
    expect(tooMany.valid).toBe(false);
    expect(tooMany.errors.some((e) => e.includes("at most 6"))).toBe(true);
  });

  it("keeps exact strike knots in the plotted series", () => {
    const legs = [leg({ id: "a", strike: 100 }), leg({ id: "b", side: "short", strike: 110, premium: 1 })];
    const a = analyzeExpirationPayoff(legs);
    expect(a.chart.some((p) => p.price === 100)).toBe(true);
    expect(a.chart.some((p) => p.price === 110)).toBe(true);
  });
});
