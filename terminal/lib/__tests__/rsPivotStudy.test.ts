import { describe, expect, it } from "vitest";
import { runRSPivotStudy, summarizeTrades } from "../rsPivotStudy";
import type { Bar6 } from "../intradayShared";

// ET-display epochs, weekdays only; regular full session 13 x 30m.
function history(days = 36, mutate?: (b: Bar6, day: number, bar: number) => void): Bar6[] {
  const out: Bar6[] = [];
  let p = 100;
  const first = Date.parse("2026-08-03T00:00:00Z") / 1000;
  let emitted = 0;
  for (let d = 0; emitted < days; d++) {
    const base = first + d * 86400;
    const wd = new Date(base * 1000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let i = 0; i < 13; i++) {
      const epoch = base + 9.5 * 3600 + i * 1800;
      p += 0.09 + Math.sin(emitted * 13 + i) * 0.23;
      const row: Bar6 = [epoch, p - 0.12, p + 0.38, p - 0.4, p, 10000];
      mutate?.(row, emitted, i);
      out.push(row);
    }
    emitted++;
  }
  return out;
}
describe("RS 30-minute shadow lab", () => {
  it("rejects duplicate, unsorted, invalid OHLC", () => {
    const s = history();
    expect(() => runRSPivotStudy([s[0], s[0]], s)).toThrow(/duplicate|out-of-order/);
    const wrong = s.map(b => [...b] as Bar6);
    wrong[0][2] = wrong[0][3] - 1;
    expect(() => runRSPivotStudy(wrong, s)).toThrow(/malformed/);
  });
  it("requires aligned complete 30-minute sessions, no benchmark synthesis", () => {
    const s = history();
    const benchmark = s.filter((_, i) => i % 13 !== 0);
    expect(() => runRSPivotStudy(s, benchmark)).toThrow(/Insufficient/);
  });
  it("runs reproducibly and returns research-only arm comparisons", () => {
    const s = history();
    const b = s.map(x => [x[0], x[1] * 0.999, x[2] * 0.999, x[3] * 0.999, x[4] * 0.999, x[5]] as Bar6);
    const a = runRSPivotStudy(s, b);
    expect(a.authority).toBe("exploratory_display_only");
    expect(a.results.map(x => x.arm)).toEqual(["rs_pivot", "pivot", "rs_ema", "ema"]);
    expect(runRSPivotStudy(s, b)).toEqual(a);
    expect(a.coverage.alignedBars).toBe(s.length - 13); // Labor Day closed session is excluded.
  });
  it("never invents profitability from empty trades", () => {
    const empty = summarizeTrades([]);
    expect(empty.winRate).toBeNull();
    expect(empty.expectancyR).toBeNull();
    expect(empty.trades).toBe(0);
  });
});
