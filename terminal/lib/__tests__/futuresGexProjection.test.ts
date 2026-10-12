import { describe, it, expect } from "vitest";
import { projectFuturesGex, type FuturesGexQuotePair } from "../futuresGexProjection";

const q: FuturesGexQuotePair = {
  pair: "ES", indexRoot: "SPX", futuresContract: "ESZ6",
  indexPrice: 7500, futuresPrice: 7616.25,
  indexTimestampMs: 1_792_000_000_000,
  futuresTimestampMs: 1_792_000_001_000,
};

describe("projectFuturesGex", () => {
  it("projects SPX to a named ES contract preserving original values and signed exposure", () => {
    const result = projectFuturesGex(q, [
      { strike: 7500, gammaNetMn: -250 },
      { strike: 7512.5, gammaNetMn: 0 },
      { strike: 7490, gammaNetMn: null },
    ]);
    expect(result).toMatchObject({
      pair: "ES", indexRoot: "SPX", futuresContract: "ESZ6",
      basis: 116.25, skewMs: 1000,
      mapped: [
        { sourceStrike: 7500, futuresPrice: 7616.25, displayTickPrice: 7616.25, gammaNetMn: -250 },
        { sourceStrike: 7512.5, futuresPrice: 7628.75, displayTickPrice: 7628.75, gammaNetMn: 0 },
        { sourceStrike: 7490, futuresPrice: 7606.25, gammaNetMn: null },
      ],
    });
  });

  it("maps NDX onto NQ with a different contract and tick-rounded labels", () => {
    const result = projectFuturesGex({
      ...q, pair: "NQ", indexRoot: "NDX", futuresContract: "NQZ6",
      indexPrice: 25500.1, futuresPrice: 25525.35,
    }, [{ strike: 25600.1, gammaNetMn: 80 }]);
    expect(result?.mapped[0].futuresPrice).toBeCloseTo(25625.35);
    expect(result?.mapped[0].displayTickPrice).toBe(25625.25);
  });

  it("rejects mismatched index and futures pairs", () => {
    expect(projectFuturesGex({ ...q, indexRoot: "NDX" }, [])).toBeNull();
    expect(projectFuturesGex({ ...q, futuresContract: "NQZ6" }, [])).toBeNull();
    expect(projectFuturesGex({ ...q, futuresContract: "ES=F" }, [])).toBeNull();
  });

  it("rejects unsynchronised snapshots instead of painting wrong levels", () => {
    expect(projectFuturesGex({ ...q, futuresTimestampMs: q.indexTimestampMs + 5001 }, [])).toBeNull();
    expect(projectFuturesGex({ ...q, futuresTimestampMs: q.indexTimestampMs + 5000 }, [])).not.toBeNull();
    expect(projectFuturesGex(q, [], -1)).toBeNull();
  });

  it("fails closed for invalid prices, clocks, and gamma cells", () => {
    expect(projectFuturesGex({ ...q, indexPrice: 0 }, [])).toBeNull();
    expect(projectFuturesGex({ ...q, futuresPrice: NaN }, [])).toBeNull();
    expect(projectFuturesGex({ ...q, indexTimestampMs: 0 }, [])).toBeNull();
    expect(projectFuturesGex(q, [{ strike: 7500, gammaNetMn: NaN }])).toBeNull();
    expect(projectFuturesGex(q, [{ strike: Infinity, gammaNetMn: 5 }])).toBeNull();
  });

  it("does not mutate source values and recalculates for a new quarterly basis", () => {
    const source = Object.freeze([{ strike: 7500, gammaNetMn: -50 }]);
    const first = projectFuturesGex(q, source)!;
    const next = projectFuturesGex({ ...q, futuresContract: "ESH7", futuresPrice: 7628.25 }, source)!;
    expect(first.mapped[0].futuresPrice).toBe(7616.25);
    expect(next.mapped[0].futuresPrice).toBe(7628.25);
    expect(source[0].strike).toBe(7500);
  });
});
