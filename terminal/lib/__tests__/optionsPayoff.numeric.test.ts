import { describe, expect, it } from "vitest";
import {
  analyzeExpirationPayoff,
  entryCashflow,
  payoffAtExpiry,
  payoffLegAtExpiry,
  type PayoffLegInput,
} from "@/lib/optionsPayoff";

const leg = (overrides: Partial<PayoffLegInput> = {}): PayoffLegInput => ({
  id: "a", right: "C", side: "long", strike: 100, premium: 4, quantity: 1,
  ...overrides,
});

const offsets = (premium: number): PayoffLegInput[] => [
  leg({ premium }), leg({ id: "b", side: "short", premium }),
];

function expectRefusal(legs: PayoffLegInput[]) {
  const result = analyzeExpirationPayoff(legs);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.knots).toEqual([]);
  expect(result.chart).toEqual([]);
  expect(result.breakEvens).toEqual([]);
}

describe("options expiration payoff — numeric boundaries", () => {
  it("refuses finite inputs whose derived economics overflow", () => {
    expectRefusal([leg({ premium: 1e308 })]);
    expectRefusal([leg({ strike: 1e308 })]);
    expectRefusal(offsets(1e308));
    expect(entryCashflow([leg({ premium: 1e308 })])).toBeNaN();
    expect(payoffAtExpiry([leg()], 1e308)).toBeNaN();
  });

  it("refuses chart-sample overflow rather than silently filtering it", () => {
    expectRefusal([
      leg({ strike: 1e307, premium: 0 }),
      leg({ id: "b", side: "short", strike: 1e307, premium: 0 }),
    ]);
  });

  it("nets admitted fractional premiums before money rounding", () => {
    const legs = offsets(4.00005);
    const result = analyzeExpirationPayoff(legs);
    expect(result.valid).toBe(true);
    expect(result.entryCashflow).toBe(0);
    expect(result.bestExpiryPnl).toBe(0);
    expect(result.maxLoss).toBe(0);
    expect(result.breakEvens).toEqual([]);
    expect(result.breakEvenRanges).toEqual([{ from: 0, to: null }]);
    for (const price of [0, 99.99995, 100, 100.00005, 105, 200]) {
      expect(payoffAtExpiry(legs, price)).toBe(0);
    }
    const unpaired = [leg({ premium: 4.00004 }), leg({ id: "b", premium: 4.00004 })];
    expect(payoffAtExpiry(unpaired, 0)).toBe(-800.01);
    expect(analyzeExpirationPayoff(unpaired).maxLoss).toBe(800.01);
  });

  it("retains exact decimal cancellation without an arbitrary zero tolerance", () => {
    const legs = [
      leg({ id: "a", premium: 0.29 }),
      leg({ id: "b", premium: 0.01 }),
      leg({ id: "c", side: "short", premium: 0.30 }),
      leg({ id: "d", side: "short", premium: 0 }),
    ];
    const result = analyzeExpirationPayoff(legs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens).toEqual([]);
    expect(result.breakEvenRanges).toEqual([{ from: 0, to: null }]);
    for (const price of [0, 100, 105, 200]) expect(payoffAtExpiry(legs, price)).toBe(0);
  });

  it("preserves both break-evens below the former four-decimal grid", () => {
    const legs = [
      leg({ id: "lc100", premium: 0, quantity: 2000 }),
      leg({ id: "lp100", right: "P", premium: 0, quantity: 2000 }),
      leg({ id: "lc200", strike: 200, premium: 0.05 }),
    ];
    const result = analyzeExpirationPayoff(legs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens).toEqual([99.999975, 100.000025]);
    expect(result.breakEvenRanges).toEqual([]);
    expect(result.maxLoss).toBe(5);
    expect(payoffAtExpiry(legs, 100)).toBe(-5);
    for (const root of result.breakEvens) {
      expect(payoffAtExpiry(legs, root)).toBe(0);
      expect(result.chart.some((point) => point.price === root)).toBe(true);
    }
  });

  it("uses raw economics to locate fractional-premium roots", () => {
    expect(analyzeExpirationPayoff([leg({ premium: 4.00005 })]).breakEvens).toEqual([104.00005]);
    const tiny = analyzeExpirationPayoff([leg({ premium: 1e-10 })]);
    expect(tiny.valid).toBe(true);
    expect(tiny.breakEvens).toEqual([100.0000000001]);
    expect(tiny.breakEvenRanges).toEqual([]);
  });

  it("preserves tiny and closely spaced strike/range endpoints", () => {
    const tiny = analyzeExpirationPayoff([leg({ strike: 1e-12, premium: 0 })]);
    expect(tiny.valid).toBe(true);
    expect(tiny.breakEvenRanges).toEqual([{ from: 0, to: 1e-12 }]);
    expect(tiny.knots.some((point) => point.price === 1e-12)).toBe(true);
    const narrow = analyzeExpirationPayoff([
      leg({ strike: 100.00001, premium: 0 }),
      leg({ id: "b", right: "P", strike: 100, premium: 0 }),
    ]);
    expect(narrow.valid).toBe(true);
    expect(narrow.breakEvenRanges).toEqual([{ from: 100, to: 100.00001 }]);
    expect(narrow.knots.some((point) => point.price === 100.00001)).toBe(true);
  });

  it("refuses a root displacement that rounds back to a known non-root knot", () => {
    expectRefusal([leg({ premium: 1e-20 })]);
  });
});


describe("options expiration payoff — audited decimal and root contract", () => {
  it("rounds decimal ties toward positive infinity on every public money surface", () => {
    for (const [side, cashflow] of [["long", -0.28], ["short", 0.29]] as const) {
      const input = leg({ side, premium: 0.00285 });
      const result = analyzeExpirationPayoff([input]);
      expect(entryCashflow([input])).toBe(cashflow);
      expect(payoffLegAtExpiry(input, 0)).toBe(cashflow);
      expect(payoffAtExpiry([input], 0)).toBe(cashflow);
      expect(result.valid).toBe(true);
      expect(result.entryCashflow).toBe(cashflow);
      expect(result.knots[0].pnl).toBe(cashflow);
      expect(result.chart.find((point) => point.price === 100)?.pnl).toBe(cashflow);
      if (side === "long") expect(result.maxLoss).toBe(0.29);
      else expect(result.bestExpiryPnl).toBe(0.29);
    }
  });

  it("matches exact signed cent rounding across 119988 premium/quantity cases", () => {
    for (const quantity of [1, 2, 3, 7, 99, 100000]) {
      for (let n = 1; n < 10000; n++) {
        for (const side of ["long", "short"] as const) {
          // premium = n/100000 dollars/share, therefore n*quantity/10 cents.
          const units = BigInt(n) * BigInt(quantity) * BigInt(side === "short" ? 1 : -1);
          const quotient = units / BigInt(10);
          const remainder = units % BigInt(10);
          const adjustment = remainder >= BigInt(5) ? BigInt(1) : remainder < BigInt(-5) ? BigInt(-1) : BigInt(0);
          expect(entryCashflow([leg({ premium: n / 1e5, quantity, side })]))
            .toBe(Number(quotient + adjustment) / 100);
        }
      }
    }
  });

  it("refuses in-domain tail and interior roots with half-cent-or-larger residuals", () => {
    for (const right of ["C", "P"] as const) {
      for (const side of ["long", "short"] as const) {
        for (const quantity of [1, 100000]) {
          expectRefusal([leg({ right, side, strike: 1e12, premium: 0.00015, quantity })]);
        }
      }
    }
  });

  it("keeps faithful large-coordinate roots", () => {
    for (const right of ["C", "P"] as const) {
      for (const side of ["long", "short"] as const) {
        const inputs = [leg({ right, side, strike: 1e12, premium: 0.0001, quantity: 100000 })];
        const result = analyzeExpirationPayoff(inputs);
        expect(result.valid).toBe(true);
        expect(result.breakEvens.length).toBe(1);
        expect(payoffAtExpiry(inputs, result.breakEvens[0])).toBe(0);
      }
    }
  });

  it("keeps ordinary repeating-rational roots within the cent-resolution contract", () => {
    const inputs = [leg({ premium: 0, quantity: 3 }), leg({ id: "b", strike: 200, premium: 0.01 })];
    const result = analyzeExpirationPayoff(inputs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens.length).toBe(1);
    expect(result.breakEvens[0]).toBeGreaterThan(100);
    expect(result.breakEvens[0]).toBeLessThan(101);
    expect(payoffAtExpiry(inputs, result.breakEvens[0])).toBe(0);
  });

  it("ignores out-of-domain tail roots for strictly positive and negative portfolios", () => {
    for (const reverse of [false, true]) {
      const inputs = [
        leg({ id: "a", premium: 0 }),
        leg({ id: "b", strike: 50, premium: 0 }),
        leg({ id: "c", strike: 50, side: "short", premium: 1e-20 }),
      ].map((input): PayoffLegInput => reverse
        ? { ...input, side: input.side === "long" ? "short" : "long" } : input);
      const result = analyzeExpirationPayoff(inputs);
      expect(result.valid).toBe(true);
      expect(result.breakEvens).toEqual([]);
      expect(result.breakEvenRanges).toEqual([]);
    }
  });

  it("keeps a faithful tiny interior root across an extreme finite interval", () => {
    const inputs = [
      leg({ id: "a", right: "P", strike: 1e300, premium: 1e300 }),
      leg({ id: "b", side: "short", strike: 1e300, premium: 1e-24 }),
    ];
    const result = analyzeExpirationPayoff(inputs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens.length).toBe(1);
    expect(Math.abs(result.breakEvens[0] - 1e-24)).toBeLessThan(Number.EPSILON * 1e-24);
    expect(payoffAtExpiry(inputs, result.breakEvens[0])).toBe(0);
  });

  it("does not reject an exact neutral sum because one leg ordering has a large prefix", () => {
    const inputs = [
      leg({ id: "a", premium: 1e306 }), leg({ id: "b", premium: 1e306 }),
      leg({ id: "c", side: "short", premium: 1e306 }), leg({ id: "d", side: "short", premium: 1e306 }),
    ];
    for (const ordered of [inputs, [inputs[0], inputs[2], inputs[1], inputs[3]], [...inputs].reverse()]) {
      expect(entryCashflow(ordered)).toBe(0);
      const result = analyzeExpirationPayoff(ordered);
      expect(result.valid).toBe(true);
      expect(result.breakEvenRanges).toEqual([{ from: 0, to: null }]);
    }
  });
});


describe("options expiration payoff — topology research vectors", () => {
  it("preserves four isolated roots across six legs", () => {
    const legs: PayoffLegInput[] = [
      leg({ id: "lc90", strike: 90, premium: 18 }),
      leg({ id: "sc100", side: "short", strike: 100, premium: 13, quantity: 2 }),
      leg({ id: "lc110", strike: 110, premium: 9 }),
      leg({ id: "lc120", strike: 120, premium: 6 }),
      leg({ id: "sc130", side: "short", strike: 130, premium: 4, quantity: 2 }),
      leg({ id: "lc140", strike: 140, premium: 3 }),
    ];
    const result = analyzeExpirationPayoff(legs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens).toEqual([92, 108, 122, 138]);
    expect(result.breakEvenRanges).toEqual([]);
    expect(result.bestExpiryPnl).toBe(800);
    expect(result.maxLoss).toBe(200);
  });

  it("preserves three disconnected zero-P/L ranges", () => {
    const legs: PayoffLegInput[] = [
      leg({ id: "lc90", strike: 90, premium: 18 }),
      leg({ id: "sc100", side: "short", strike: 100, premium: 13, quantity: 2 }),
      leg({ id: "lc110", strike: 110, premium: 8 }),
      leg({ id: "lc120", strike: 120, premium: 6 }),
      leg({ id: "sc130", side: "short", strike: 130, premium: 4, quantity: 2 }),
      leg({ id: "lc140", strike: 140, premium: 2 }),
    ];
    const result = analyzeExpirationPayoff(legs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens).toEqual([]);
    expect(result.breakEvenRanges).toEqual([
      { from: 0, to: 90 },
      { from: 110, to: 120 },
      { from: 140, to: null },
    ]);
  });

  it("keeps a strike-touch root that is negative on both sides", () => {
    const legs: PayoffLegInput[] = [
      leg({ id: "lc90", strike: 90, premium: 20 }),
      leg({ id: "sc100", side: "short", strike: 100, premium: 6, quantity: 2 }),
      leg({ id: "lc110", strike: 110, premium: 2 }),
    ];
    const result = analyzeExpirationPayoff(legs);
    expect(result.valid).toBe(true);
    expect(result.breakEvens).toEqual([100]);
    expect(result.breakEvenRanges).toEqual([]);
    expect(payoffAtExpiry(legs, 99.99)).toBe(-1);
    expect(payoffAtExpiry(legs, 100)).toBe(0);
    expect(payoffAtExpiry(legs, 100.01)).toBe(-1);
  });
});
