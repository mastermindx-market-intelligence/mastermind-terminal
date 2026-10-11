import { describe, expect, it } from "vitest";
import {
  absoluteSpotMoveStats,
  admitAggPayload,
  admitMovesPayload,
  admitVolPayload,
  finiteAggStats,
  histogram,
  percentileOf,
  sourceReceipts,
  type MovesPayload,
} from "@/lib/optionsStatistics";

const moves: MovesPayload = {
  schema: "options_hub.moves/v1",
  asof: "2026-10-01",
  root: "SPY",
  spot_ref: 100,
  atm_iv: 20,
  regime: "slippery",
  expected_move: { band_mult: 1.96, horizon_days: 1, pct: 2, lo: 98, hi: 102 },
  calibration: {
    contained_rate: 0.96,
    n_sessions: 100,
    hits: 96,
    misses: 4,
    band_mult: 1.96,
    since: "2025-01-01",
    through: "2026-09-30",
    ci: [0.91, 0.98] as [number, number],
  },
};

const vol = { schema: "options_hub.vol/v1", asof: "2026-10-01", root: "SPY", history: [{ date: "2026-10-01", atm_iv: 20, iv_rank: null, close: null }] };
const agg = {
  schema: "options_hub.aggtrend/v1",
  asof: "2026-09-30",
  root: "SPY",
  n_days: 4,
  series: [
    { d: "2026-09-25", s: 100 },
    { d: "2026-09-28", s: 101 },
    { d: "2026-09-29", s: 99 },
    { d: "2026-09-30", s: 102 },
  ],
  stats: {
    gamma: { mean: 1, sd: 2, min: -4, p05: -3, p50: 1, p95: 4, max: 5, last: 2, pctile: 72, n: 100 },
  },
};

describe("Options Statistics source admission", () => {
  it("admits exact-root calibrated moves and rejects wrong roots", () => {
    expect(admitMovesPayload(moves, "SPY")?.expected_move?.pct).toBe(2);
    expect(admitMovesPayload(moves, "QQQ")).toBeNull();
  });

  it("rejects contradictory calibration counts and invalid confidence intervals", () => {
    expect(admitMovesPayload({ ...moves, calibration: { ...moves.calibration, misses: 3 } }, "SPY")).toBeNull();
    expect(admitMovesPayload({ ...moves, calibration: { ...moves.calibration, ci: [0.99, 0.9] } }, "SPY")).toBeNull();
  });

  it("admits exact-root vol/aggregate owners and rejects cross-root payloads", () => {
    expect(admitVolPayload(vol, "SPY")).not.toBeNull();
    expect(admitVolPayload({ ...vol, root: "MU" }, "SPY")).toBeNull();
    expect(admitVolPayload({ ...vol, asof: 20261001 }, "SPY")).toBeNull();
    expect(admitAggPayload(agg, "SPY")).not.toBeNull();
    expect(admitAggPayload({ ...agg, root: "ARM" }, "SPY")).toBeNull();
  });
});

describe("Options Statistics descriptive math", () => {
  it("computes consecutive absolute close-to-close moves in percent", () => {
    const stats = absoluteSpotMoveStats(agg.series)!;
    expect(stats.n).toBe(3);
    expect(stats.since).toBe("2026-09-25");
    expect(stats.through).toBe("2026-09-30");
    expect(stats.values[0]).toBeCloseTo(1, 10);
    expect(stats.values[1]).toBeCloseTo(Math.abs(99 / 101 - 1) * 100, 10);
  });

  it("breaks the return chain at missing or invalid spots instead of bridging", () => {
    const stats = absoluteSpotMoveStats([
      { d: "2026-09-25", s: 100 },
      { d: "2026-09-28", s: undefined },
      { d: "2026-09-29", s: 110 },
      { d: "2026-09-30", s: 111 },
      { d: "2026-10-01", s: 112 },
    ])!;
    expect(stats.n).toBe(2);
    expect(stats.values[0]).toBeCloseTo(Math.abs(111 / 110 - 1) * 100, 10);
  });

  it("uses midrank percentile on ties", () => {
    expect(percentileOf(2, [1, 2, 2, 3])).toBe(50);
    expect(percentileOf(5, [])).toBeNull();
  });

  it("builds nonnegative histogram counts without losing observations", () => {
    const bins = histogram([0, 0.1, 0.5, 1, 2, 3, 4], 6);
    expect(bins).toHaveLength(6);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(7);
    expect(bins.every((bin) => bin.lo >= 0 && bin.hi > bin.lo)).toBe(true);
  });

  it("fails malformed aggregate stats closed", () => {
    expect(finiteAggStats(agg, "gamma")?.pctile).toBe(72);
    expect(finiteAggStats({ ...agg, stats: { gamma: { ...agg.stats.gamma, pctile: 200 } } }, "gamma")).toBeNull();
  });

  it("keeps each source clock independent in receipts", () => {
    const receipts = sourceReceipts(moves, vol, agg);
    expect(receipts.map((row) => row.asof)).toEqual(["2026-10-01", "2026-10-01", "2026-09-30"]);
    expect(receipts[0].detail).toContain("100 calibration sessions through 2026-09-30");
  });
});
