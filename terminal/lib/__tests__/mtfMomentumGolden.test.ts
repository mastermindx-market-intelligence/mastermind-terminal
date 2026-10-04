import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { confluenceScore, momentumPoints, type MomentumPoint } from "../mtfMomentum";

type Check = [number, number | null, number | null, number | null, number | null,
  number | null, MomentumPoint["phase"]];
const golden = JSON.parse(readFileSync(join(__dirname, "../../../tests/mtf_momentum_golden.json"), "utf8")) as {
  schema: string;
  cases: Array<{ name: string; length: number; checks: Check[] }>;
  aggregateInputs: Array<{ tf: string; index: number; weight: number }>;
  aggregates: Array<{ bottom: number | null; expected: number }>;
};

function bars(name: string, length: number) {
  return Array.from({ length }, (_, i) => {
    const j = i % 34;
    const cents = name === "flat" ? 10000 : name === "rising" ? 10000 + 40 * i
      : name === "falling" ? 10000 - 30 * i
      : 10000 + 2 * i + 80 * (j <= 17 ? j : 34 - j) + 13 * (i % 11);
    return { h: (cents + (name === "flat" ? 0 : 130)) / 100,
      l: (cents - (name === "flat" ? 0 : 170)) / 100, c: cents / 100 };
  });
}

describe("shared Python/Terminal MTF numerical contract", () => {
  it("uses the versioned synthetic fixture, not historical-return evidence", () => {
    expect(golden.schema).toBe("mastermind.mtf_momentum_golden/v2");
  });
  for (const item of golden.cases) {
    it(`${item.name}: pins warmup, phase boundaries and component values`, () => {
      const points = momentumPoints(bars(item.name, item.length));
      const keys = ["stochK", "stochD", "rsiMacd", "rsiSignal", "score"] as const;
      for (const [index, k, d, m, s, score, phase] of item.checks) {
        const wanted = [k, d, m, s, score];
        keys.forEach((key, i) => {
          if (wanted[i] == null) expect(points[index][key]).toBeNull();
          else expect(points[index][key]).toBeCloseTo(wanted[i]!, 10);
        });
        expect(points[index].phase).toBe(phase);
      }
      expect(points.findIndex((p) => p.score != null)).toBe(item.length >= 78 ? 77 : -1);
    });
  }
  it("pins the shared confluence prior, including missing bottom context", () => {
    const points = momentumPoints(bars("oscillating", 240));
    const inputs = golden.aggregateInputs.map((item) => ({ ...item, point: points[item.index] }));
    for (const row of golden.aggregates) {
      expect(confluenceScore(inputs, row.bottom)).toBeCloseTo(row.expected, 10);
    }
  });
});
