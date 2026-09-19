import { describe, it, expect } from "vitest";
import {
  aggregate,
  signSensitivity,
  scenarioGrid,
  r5DteBucket,
  r5Stage0Alignment,
  emFrame,
  topology,
  expiryConcentration,
  buildMarketStructure,
  hedgeProfile,
  termStructure,
  tenorBand,
  dailyHedging,
  TILT_FRAGILE_ABS,
  REACHABLE_EM,
  type MscStrikeRow,
  type MscExpiryRow,
} from "../marketStructure";

// A tiny hand-computable book: call gamma +, put gamma −, net = call + put.
const ROWS: MscStrikeRow[] = [
  { strike: 90, gamma_net: -30, gamma_call: 10, gamma_put: -40, vanna_net: 5, charm_net: -2, delta_net: -100 },
  { strike: 100, gamma_net: 40, gamma_call: 60, gamma_put: -20, vanna_net: 15, charm_net: 3, delta_net: 200 },
  { strike: 110, gamma_net: 20, gamma_call: 30, gamma_put: -10, vanna_net: 10, charm_net: 1, delta_net: 50 },
];
// callAbs = 100, putAbs = 70, gamma = 30, vanna = 30, charm = 2, delta = 150

describe("aggregate", () => {
  it("sums each greek and both gross gamma sides", () => {
    const a = aggregate(ROWS);
    expect(a.gammaMn).toBe(30);
    expect(a.callAbsMn).toBe(100);
    expect(a.putAbsMn).toBe(70);
    expect(a.vannaMn).toBe(30);
    expect(a.charmMn).toBe(2);
    expect(a.deltaMn).toBe(150);
    expect(a.nStrikes).toBe(3);
  });

  it("keeps Σ gamma_net consistent with gamma_call + gamma_put", () => {
    const a = aggregate(ROWS);
    expect(a.callAbsMn - a.putAbsMn).toBeCloseTo(a.gammaMn, 10);
  });

  it("reports an absent lens as null rather than zero", () => {
    const bare: MscStrikeRow[] = [{ strike: 1, gamma_net: 1, gamma_call: 1, gamma_put: 0 }];
    const a = aggregate(bare);
    expect(a.vannaMn).toBeNull();
    expect(a.charmMn).toBeNull();
    expect(a.deltaMn).toBeNull();
  });

  it("flags a windowed ladder only when the uncut count exceeds what was summed", () => {
    expect(aggregate(ROWS, 12).windowed).toBe(true);
    expect(aggregate(ROWS, 3).windowed).toBe(false);
    expect(aggregate(ROWS).windowed).toBe(false);
    expect(aggregate(ROWS).nStrikesFull).toBeNull();
  });

  it("ignores non-finite values instead of poisoning the sum", () => {
    const dirty = [
      ...ROWS,
      { strike: 120, gamma_net: NaN, gamma_call: NaN, gamma_put: NaN } as MscStrikeRow,
    ];
    const a = aggregate(dirty);
    expect(a.gammaMn).toBe(30);
    expect(Number.isFinite(a.callAbsMn)).toBe(true);
  });

  it("handles an empty ladder", () => {
    const a = aggregate([]);
    expect(a.gammaMn).toBe(0);
    expect(a.nStrikes).toBe(0);
  });
});

describe("signSensitivity", () => {
  it("computes tilt, critical weight and the convention curve", () => {
    const s = signSensitivity(aggregate(ROWS));
    // tilt = (100 − 70) / 170
    expect(s.tilt).toBeCloseTo(30 / 170, 10);
    // w* = putAbs / callAbs
    expect(s.criticalWeight).toBeCloseTo(0.7, 10);
    // net(+1) is the published convention and must equal Σ gamma_net
    expect(s.naiveNetMn).toBe(30);
    expect(s.curve.find((p) => p.w === 1)!.netMn).toBe(30);
    expect(s.curve.find((p) => p.w === 0)!.netMn).toBe(-70);
    expect(s.curve.find((p) => p.w === -1)!.netMn).toBe(-170);
  });

  it("net(w) crosses zero exactly at the critical weight", () => {
    const s = signSensitivity(aggregate(ROWS));
    const w = s.criticalWeight!;
    expect(w * s.callAbsMn - s.putAbsMn).toBeCloseTo(0, 10);
  });

  it("calls a knife-edge book fragile and a lopsided book robust", () => {
    const knife = aggregate([
      { strike: 1, gamma_net: 2, gamma_call: 101, gamma_put: -99 },
    ]);
    const s1 = signSensitivity(knife);
    expect(Math.abs(s1.tilt!)).toBeLessThan(TILT_FRAGILE_ABS);
    expect(s1.verdict).toBe("fragile");

    const lopsided = aggregate([
      { strike: 1, gamma_net: 90, gamma_call: 100, gamma_put: -10 },
    ]);
    expect(signSensitivity(lopsided).verdict).toBe("robust");
  });

  it("marks a put-dominated book robust because no plausible weight makes it long gamma", () => {
    const putHeavy = aggregate([
      { strike: 1, gamma_net: -80, gamma_call: 20, gamma_put: -100 },
    ]);
    const s = signSensitivity(putHeavy);
    expect(s.criticalWeight!).toBeGreaterThan(1);
    expect(s.verdict).toBe("robust");
    // every sampled weight leaves the book short gamma
    expect(s.curve.every((p) => p.netMn < 0)).toBe(true);
  });

  it("returns unknown with no gamma at all", () => {
    const s = signSensitivity(aggregate([]));
    expect(s.tilt).toBeNull();
    expect(s.criticalWeight).toBeNull();
    expect(s.verdict).toBe("unknown");
  });
});

describe("scenarioGrid", () => {
  it("returns the negative of the dealer delta change (hedge is the mirror)", () => {
    const g = scenarioGrid(aggregate(ROWS), { dsPct: [1], dVolPts: [0], dtDays: 0 });
    // gamma 30 $mn per +1% ⇒ dealer delta +30 ⇒ they must SELL 30
    expect(g.cells[0][0]).toBeCloseTo(-30, 10);
  });

  it("is flat at the origin cell", () => {
    const g = scenarioGrid(aggregate(ROWS), { dsPct: [0], dVolPts: [0], dtDays: 0 });
    expect(g.cells[0][0]).toBe(0);
  });

  it("adds the vanna and charm terms in the same $mn unit", () => {
    const g = scenarioGrid(aggregate(ROWS), { dsPct: [2], dVolPts: [3], dtDays: 5 });
    // −(30·2 + 30·3 + 2·5) = −160
    expect(g.cells[0][0]).toBeCloseTo(-160, 10);
  });

  it("is antisymmetric in the spot axis when vanna and time are held at zero", () => {
    const g = scenarioGrid(aggregate(ROWS), { dsPct: [-2, 2], dVolPts: [0], dtDays: 0 });
    expect(g.cells[0][0]).toBeCloseTo(-g.cells[0][1], 10);
  });

  it("reports the colour-scale anchor and lens availability", () => {
    const g = scenarioGrid(aggregate(ROWS));
    expect(g.maxAbs).toBeGreaterThan(0);
    expect(g.hasVanna).toBe(true);
    expect(g.hasCharm).toBe(true);
    expect(g.charmPerDayMn).toBeCloseTo(-2, 10);
    expect(g.cells).toHaveLength(g.dVolPts.length);
    expect(g.cells[0]).toHaveLength(g.dsPct.length);
  });

  it("treats a missing lens as contributing nothing, and says so", () => {
    const bare = aggregate([{ strike: 1, gamma_net: 10, gamma_call: 10, gamma_put: 0 }]);
    const g = scenarioGrid(bare, { dsPct: [1], dVolPts: [5], dtDays: 3 });
    expect(g.hasVanna).toBe(false);
    expect(g.hasCharm).toBe(false);
    expect(g.charmPerDayMn).toBeNull();
    expect(g.cells[0][0]).toBeCloseTo(-10, 10);
  });
});

describe("R5 Stage 0 scenario-conditioned alignment", () => {
  const ASOF = "2026-09-18T20:00:00Z";
  const scenario = {
    spotPct: 1,
    volPts: 2,
    dtDays: 1,
    materialityMn: 4,
    positionTier: "naive_dealer_long_calls_short_puts/v1",
  };

  it("uses the frozen absolute-DTE buckets, not the gap-between-expiries tenor bands", () => {
    expect(r5DteBucket(0)).toBe("0DTE");
    expect(r5DteBucket(1)).toBe("1-2DTE");
    expect(r5DteBucket(2)).toBe("1-2DTE");
    expect(r5DteBucket(3)).toBe("3-7DTE");
    expect(r5DteBucket(7)).toBe("3-7DTE");
    expect(r5DteBucket(8)).toBe("8-30DTE");
    expect(r5DteBucket(30)).toBe("8-30DTE");
    expect(r5DteBucket(31)).toBe("31-90DTE");
    expect(r5DteBucket(90)).toBe("31-90DTE");
    expect(r5DteBucket(91)).toBe("91D+");
    expect(r5DteBucket(-1)).toBeNull();
  });

  it("decomposes each tenor through the existing scenarioGrid math", () => {
    const rows: MscExpiryRow[] = [
      {
        exp: "2026-09-18",
        gamma_net: 10,
        vanna_net: 4,
        charm_net: 1,
      },
      {
        exp: "2026-10-02",
        gamma_net: -5,
        vanna_net: 6,
        charm_net: -2,
      },
    ];
    const got = r5Stage0Alignment(rows, ASOF, scenario);
    const d0 = got.buckets.find((r) => r.bucket === "0DTE")!;
    const m = got.buckets.find((r) => r.bucket === "8-30DTE")!;

    // 0DTE: gamma = -(10*1)=-10; vanna = -(4*2)=-8; charm=-(1*1)=-1.
    expect(d0.gammaFlowMn).toBeCloseTo(-10, 10);
    expect(d0.vannaFlowMn).toBeCloseTo(-8, 10);
    expect(d0.charmFlowMn).toBeCloseTo(-1, 10);
    expect(d0.totalFlowMn).toBeCloseTo(-19, 10);
    expect(d0.alignment).toBe("aligned_negative");
    expect(d0.alignmentStrength).toBeCloseTo(-10 * -8 / 80, 10);

    // 14D: gamma = +5, vanna = -12, charm = +2 -> gamma/vanna oppose.
    expect(m.gammaFlowMn).toBeCloseTo(5, 10);
    expect(m.vannaFlowMn).toBeCloseTo(-12, 10);
    expect(m.charmFlowMn).toBeCloseTo(2, 10);
    expect(m.totalFlowMn).toBeCloseTo(-5, 10);
    expect(m.alignment).toBe("opposed");

    // Whole book reuses the same scenario math on the summed expiry state.
    expect(got.wholeBook.totalFlowMn).toBeCloseTo(-24, 10);
    expect(got.population).toBe("full_book_by_expiry");
    expect(got.outcomeLabelsOpened).toBe(false);
  });

  it("fails a tenor Vanna aggregate closed when only some expiries publish it", () => {
    const got = r5Stage0Alignment([
      { exp: "2026-09-19", gamma_net: 10, vanna_net: 3, charm_net: 1 },
      { exp: "2026-09-20", gamma_net: 5, charm_net: 2 },
    ], ASOF, scenario);
    const row = got.buckets.find((r) => r.bucket === "1-2DTE")!;
    expect(row.present).toBe(true);
    expect(row.expirations).toBe(2);
    expect(row.gammaMn).toBe(15);
    expect(row.vannaMn).toBeNull();
    expect(row.vannaFlowMn).toBeNull();
    expect(row.alignment).toBe("unavailable");
    expect(got.coverage.vannaRows).toBe(1);
  });

  it("keeps missing vanna unavailable and never turns it into a zero-flow factor", () => {
    const got = r5Stage0Alignment([
      { exp: "2026-09-19", gamma_net: 10, charm_net: 2 },
    ], ASOF, scenario);
    const row = got.buckets.find((r) => r.bucket === "1-2DTE")!;
    expect(row.present).toBe(true);
    expect(row.vannaMn).toBeNull();
    expect(row.vannaFlowMn).toBeNull();
    expect(row.alignment).toBe("unavailable");
    // The requested +2 vol-point shock needs Vanna. Missing Vanna therefore makes
    // the combined flow unknown rather than silently treating that leg as zero.
    expect(row.totalFlowMn).toBeNull();
    expect(got.coverage.vannaRows).toBe(0);

    // If the scenario explicitly asks for no IV shock, the missing Vanna lens is
    // irrelevant and the known gamma + charm legs can still close.
    const noVolShock = r5Stage0Alignment([
      { exp: "2026-09-19", gamma_net: 10, charm_net: 2 },
    ], ASOF, { ...scenario, volPts: 0 });
    expect(noVolShock.wholeBook.totalFlowMn).toBeCloseTo(-12, 10);
  });

  it("distinguishes one-factor dominance from both-factors-immaterial", () => {
    const dominant = r5Stage0Alignment([
      { exp: "2026-09-19", gamma_net: 20, vanna_net: 1, charm_net: 0 },
    ], ASOF, { ...scenario, materialityMn: 5 });
    expect(dominant.wholeBook.alignment).toBe("one_factor_dominant");

    const tiny = r5Stage0Alignment([
      { exp: "2026-09-19", gamma_net: 1, vanna_net: 1, charm_net: 0 },
    ], ASOF, { ...scenario, materialityMn: 5 });
    expect(tiny.wholeBook.alignment).toBe("immaterial");
  });

  it("treats equality with the frozen materiality threshold as material", () => {
    const got = r5Stage0Alignment([
      // gamma flow = -5 at +1% spot; vanna flow = -6 at +2 vol points.
      { exp: "2026-09-19", gamma_net: 5, vanna_net: 3, charm_net: 0 },
    ], ASOF, { ...scenario, materialityMn: 5 });
    expect(got.wholeBook.gammaFlowMn).toBeCloseTo(-5, 10);
    expect(got.wholeBook.vannaFlowMn).toBeCloseTo(-6, 10);
    expect(got.wholeBook.alignment).toBe("aligned_negative");
  });

  it("preserves all six buckets and marks empty ones absent rather than zero", () => {
    const got = r5Stage0Alignment([
      { exp: "2026-09-18", gamma_net: 3, vanna_net: 2, charm_net: 1 },
    ], ASOF, scenario);
    expect(got.buckets.map((r) => r.bucket)).toEqual([
      "0DTE", "1-2DTE", "3-7DTE", "8-30DTE", "31-90DTE", "91D+",
    ]);
    const absent = got.buckets.find((r) => r.bucket === "31-90DTE")!;
    expect(absent.present).toBe(false);
    expect(absent.gammaMn).toBeNull();
    expect(absent.totalFlowMn).toBeNull();
  });

  it("refuses expired/invalid rows without reclassifying them as 0DTE", () => {
    const got = r5Stage0Alignment([
      { exp: "2026-09-17", gamma_net: 99, vanna_net: 99, charm_net: 99 },
      { exp: "not-a-date", gamma_net: 99, vanna_net: 99, charm_net: 99 },
      { exp: "2026-09-19", gamma_net: 1, vanna_net: 1, charm_net: 1 },
    ], ASOF, scenario);
    expect(got.coverage.inputRows).toBe(3);
    expect(got.coverage.qualifiedRows).toBe(1);
    expect(got.coverage.invalidOrExpiredRows).toBe(2);
    expect(got.buckets.find((r) => r.bucket === "0DTE")!.present).toBe(false);
  });

  it("requires explicit bounded shocks, materiality and a position-tier label", () => {
    const rows: MscExpiryRow[] = [
      { exp: "2026-09-19", gamma_net: 1, vanna_net: 1, charm_net: 1 },
    ];
    expect(() => r5Stage0Alignment(rows, ASOF, { ...scenario, spotPct: 3.01 })).toThrow(/3%/);
    expect(() => r5Stage0Alignment(rows, ASOF, { ...scenario, volPts: -5.01 })).toThrow(/5pt/);
    expect(() => r5Stage0Alignment(rows, ASOF, { ...scenario, dtDays: -1 })).toThrow(/non-negative/);
    expect(() => r5Stage0Alignment(rows, ASOF, { ...scenario, materialityMn: -1 })).toThrow(/non-negative/);
    expect(() => r5Stage0Alignment(rows, ASOF, { ...scenario, positionTier: " " })).toThrow(/declared/);
    expect(() => r5Stage0Alignment(rows, "not-a-date", scenario)).toThrow(/valid YYYY-MM-DD/);
  });
});

describe("emFrame", () => {
  const moves = {
    expected_move: { band_mult: 2, horizon_days: 1, pct: 4, lo: 96, hi: 104 },
    calibration: { contained_rate: 0.94, n_sessions: 2397, ci: [0.93, 0.95] },
  };

  it("divides the published band by its multiplier to get 1σ", () => {
    const f = emFrame(100, [], moves);
    expect(f.emPct1sig).toBeCloseTo(2, 10);
    expect(f.emAbs1sig).toBeCloseTo(2, 10);
    expect(f.bandMult).toBe(2);
  });

  it("expresses each level as a distance in expected moves", () => {
    const f = emFrame(100, [{ key: "call_wall", price: 103 }, { key: "put_wall", price: 94 }], moves);
    const cw = f.levels.find((l) => l.key === "call_wall")!;
    expect(cw.distEm).toBeCloseTo(1.5, 10);
    expect(cw.side).toBe("above");
    expect(cw.distPct).toBeCloseTo(3, 10);
    const pw = f.levels.find((l) => l.key === "put_wall")!;
    expect(pw.distEm).toBeCloseTo(3, 10);
    expect(pw.side).toBe("below");
  });

  it("marks levels beyond the reachability horizon", () => {
    const f = emFrame(100, [{ key: "near", price: 101 }, { key: "far", price: 120 }], moves);
    expect(f.levels.find((l) => l.key === "near")!.reachable).toBe(true);
    expect(f.levels.find((l) => l.key === "far")!.reachable).toBe(false);
    // boundary is inclusive
    const edge = emFrame(100, [{ key: "edge", price: 100 + REACHABLE_EM * 2 }], moves);
    expect(edge.levels[0].reachable).toBe(true);
  });

  it("orders levels nearest-first", () => {
    const f = emFrame(
      100,
      [{ key: "far", price: 120 }, { key: "near", price: 101 }, { key: "mid", price: 105 }],
      moves,
    );
    expect(f.levels.map((l) => l.key)).toEqual(["near", "mid", "far"]);
  });

  it("drops levels with no price instead of rendering a hole", () => {
    const f = emFrame(100, [{ key: "a", price: null }, { key: "b", price: 101 }], moves);
    expect(f.levels.map((l) => l.key)).toEqual(["b"]);
  });

  it("carries the containment calibration through", () => {
    const f = emFrame(100, [], moves);
    expect(f.containedRate).toBeCloseTo(0.94, 10);
    expect(f.nSessions).toBe(2397);
    expect(f.ci).toEqual([0.93, 0.95]);
  });

  it("degrades to nulls without a moves payload rather than inventing a band", () => {
    const f = emFrame(100, [{ key: "cw", price: 110 }], null);
    expect(f.emPct1sig).toBeNull();
    expect(f.emAbs1sig).toBeNull();
    expect(f.levels[0].distEm).toBeNull();
    expect(f.levels[0].reachable).toBeNull();
    // the percent distance is still honest without a band
    expect(f.levels[0].distPct).toBeCloseTo(10, 10);
  });

  it("degrades without a spot too", () => {
    const f = emFrame(null, [{ key: "cw", price: 110 }], moves);
    expect(f.levels[0].distPct).toBeNull();
    expect(f.levels[0].distEm).toBeNull();
    expect(f.levels[0].side).toBe("at");
  });
});

describe("topology", () => {
  it("finds the absolute-gamma strike from magnitudes only", () => {
    const t = topology(ROWS);
    // |60| + |−20| = 80 at strike 100 beats 50 at 90 and 40 at 110
    expect(t.absGammaStrike).toBe(100);
    expect(t.absGammaMn).toBe(80);
    expect(t.totalAbsMn).toBe(170);
    expect(t.concentrationShare).toBeCloseTo(80 / 170, 10);
  });

  it("ranks strikes largest-first with shares that sum sensibly", () => {
    const t = topology(ROWS);
    expect(t.topStrikes.map((s) => s.strike)).toEqual([100, 90, 110]);
    const total = t.topStrikes.reduce((a, s) => a + s.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("does not depend on the dealer sign convention", () => {
    const flipped = ROWS.map((r) => ({
      ...r,
      gamma_call: -r.gamma_call,
      gamma_put: -r.gamma_put,
      gamma_net: -r.gamma_net,
    }));
    expect(topology(flipped).absGammaStrike).toBe(topology(ROWS).absGammaStrike);
    expect(topology(flipped).totalAbsMn).toBeCloseTo(topology(ROWS).totalAbsMn, 10);
  });

  it("returns nulls for an empty ladder", () => {
    const t = topology([]);
    expect(t.absGammaStrike).toBeNull();
    expect(t.concentrationShare).toBeNull();
    expect(t.topStrikes).toEqual([]);
  });
});

describe("expiryConcentration", () => {
  const EXPS: MscExpiryRow[] = [
    { exp: "2026-08-21", gamma_net: 10, delta_net: 40 },
    { exp: "2026-08-07", gamma_net: 60, delta_net: 200 },
    { exp: "2026-08-14", gamma_net: -30, delta_net: -60 },
  ];

  it("sorts by date rather than trusting payload order", () => {
    expect(expiryConcentration(EXPS).nextExp).toBe("2026-08-07");
  });

  it("computes the front-expiry share of gross gamma", () => {
    const e = expiryConcentration(EXPS);
    // gross = 60 + 30 + 10 = 100
    expect(e.gammaSharePct).toBeCloseTo(60, 10);
    expect(e.concentrated).toBe(true);
  });

  it("previews the book with the front expiration removed", () => {
    const e = expiryConcentration(EXPS);
    expect(e.currentNetMn).toBe(40);
    expect(e.postExpiryNetMn).toBe(-20);
    expect(e.signFlipsOnExpiry).toBe(true);
  });

  it("does not flag a sign flip when the regime survives expiry", () => {
    const calm: MscExpiryRow[] = [
      { exp: "2026-08-07", gamma_net: 10 },
      { exp: "2026-08-14", gamma_net: 90 },
    ];
    const e = expiryConcentration(calm);
    expect(e.signFlipsOnExpiry).toBe(false);
    expect(e.concentrated).toBe(false);
    expect(e.postExpiryNetMn).toBe(90);
  });

  it("has no post-expiry preview with a single expiration", () => {
    const e = expiryConcentration([{ exp: "2026-08-07", gamma_net: 5 }]);
    expect(e.postExpiryNetMn).toBeNull();
    expect(e.signFlipsOnExpiry).toBe(false);
    expect(e.gammaSharePct).toBeCloseTo(100, 10);
  });

  it("returns an honest empty for no expirations", () => {
    const e = expiryConcentration(null);
    expect(e.nExp).toBe(0);
    expect(e.nextExp).toBeNull();
    expect(e.gammaSharePct).toBeNull();
  });

  it("reports a delta share only when the lens is present", () => {
    expect(expiryConcentration([{ exp: "2026-08-07", gamma_net: 5 }]).deltaSharePct).toBeNull();
    expect(expiryConcentration(EXPS).deltaSharePct).not.toBeNull();
  });
});

// The ±20% flip plausibility guard was REMOVED once the upstream estimator was repaired
// (macro #4189). Keeping it would have suppressed legitimate far flips: on the corrected
// data AAPL sits 21.4% from spot, which the guard would have hidden as implausible.
//
// The repaired estimator re-prices the book on a ±25% spot grid, so it is structurally
// incapable of returning a level outside that band — the guard's job is now done by the
// estimator's own domain, and a second clip in the client would only ever remove real
// readings. The measured before/after, for the record:
//
//   SPY  275.00 -> 747.95   (62.9% from spot -> 0.84%)
//   QQQ  249.80 -> 691.45   (63.5% -> 1.16%)
//   SPX 8676.93 -> 7481.82  (above both walls -> 0.59%)
//   IWM     null -> 298.45  (-> 2.00%)
//
// History: docs/audits/2026-08-01-market-structure-core/gamma-flip-defect-rca.md

describe("buildMarketStructure", () => {
  it("assembles every block from one pass over the payload", () => {
    const ms = buildMarketStructure({
      byStrike: ROWS,
      byExpiry: [{ exp: "2026-08-07", gamma_net: 30 }],
      byStrikeFullN: 40,
      spot: 100,
      levels: [{ key: "call_wall", price: 110 }],
      moves: { expected_move: { band_mult: 2, pct: 4, horizon_days: 1 } },
    });
    expect(ms.agg.windowed).toBe(true);
    expect(ms.sign.naiveNetMn).toBe(30);
    expect(ms.topology.absGammaStrike).toBe(100);
    expect(ms.expiry.nextExp).toBe("2026-08-07");
    expect(ms.em.levels[0].distEm).toBeCloseTo(5, 10);
    expect(ms.scenario.cells.length).toBeGreaterThan(0);
  });

  it("survives a completely empty payload", () => {
    const ms = buildMarketStructure({
      byStrike: null,
      byExpiry: null,
      spot: null,
      levels: [],
      moves: null,
    });
    expect(ms.sign.verdict).toBe("unknown");
    expect(ms.topology.absGammaStrike).toBeNull();
    expect(ms.expiry.nExp).toBe(0);
    expect(ms.em.levels).toEqual([]);
  });
});

// ─── Volland-parity wave 1 ────────────────────────────────────────────────────────────

describe("hedgeProfile", () => {
  it("negates the position change — a hedge is the mirror of the exposure", () => {
    const p = hedgeProfile(ROWS, "gamma", 100);
    // strike 100 carries gamma_net +40 ⇒ dealers must SELL 40
    expect(p.rows.find((r) => r.strike === 100)!.hedgeMn).toBe(-40);
    // strike 90 carries −30 ⇒ dealers must BUY 30
    expect(p.rows.find((r) => r.strike === 90)!.hedgeMn).toBe(30);
  });

  it("anchors the cumulative curve at spot for second-order greeks", () => {
    const p = hedgeProfile(ROWS, "gamma", 100);
    expect(p.anchored).toBe(true);
    // Walking UP from spot: the first strike at/above spot carries its own value only.
    const at100 = p.cumulative.find((c) => c.strike === 100)!;
    expect(at100.cumMn).toBe(-40);
    // 110 accumulates 100 and 110 together: −40 + −20
    expect(p.cumulative.find((c) => c.strike === 110)!.cumMn).toBe(-60);
    // Walking DOWN from spot, 90 is the only strike below: +30
    expect(p.cumulative.find((c) => c.strike === 90)!.cumMn).toBe(30);
  });

  it("uses a plain running total for first-order greeks", () => {
    const p = hedgeProfile(ROWS, "delta", 100);
    expect(p.anchored).toBe(false);
    // plain cumsum of the negated deltas, low strike upward: 100, 100-200, ...
    expect(p.cumulative[0].cumMn).toBe(100);
    expect(p.cumulative[1].cumMn).toBe(-100);
    expect(p.cumulative[2].cumMn).toBe(-150);
  });

  it("falls back to a plain total when spot is unknown", () => {
    expect(hedgeProfile(ROWS, "gamma", null).anchored).toBe(false);
    expect(hedgeProfile(ROWS, "gamma", 0).anchored).toBe(false);
  });

  it("labels the per-unit move each greek is quoted against", () => {
    expect(hedgeProfile(ROWS, "gamma", 100).perUnit).toBe("1% spot");
    expect(hedgeProfile(ROWS, "vanna", 100).perUnit).toBe("1 vol point");
    expect(hedgeProfile(ROWS, "charm", 100).perUnit).toBe("1 day");
    expect(hedgeProfile(ROWS, "delta", 100).perUnit).toBe("position");
  });

  it("skips strikes with no value for the selected lens instead of zero-filling", () => {
    const sparse: MscStrikeRow[] = [
      { strike: 1, gamma_net: 5, gamma_call: 5, gamma_put: 0 },
      { strike: 2, gamma_net: 5, gamma_call: 5, gamma_put: 0, vanna_net: 3 },
    ];
    expect(hedgeProfile(sparse, "vanna", 1.5).rows).toHaveLength(1);
  });

  it("survives an empty ladder", () => {
    const p = hedgeProfile([], "gamma", 100);
    expect(p.rows).toEqual([]);
    expect(p.cumulative).toEqual([]);
    expect(p.maxAbsMn).toBe(0);
  });
});

describe("tenorBand", () => {
  it("buckets by the gap between expirations, per the documented thresholds", () => {
    expect(tenorBand(1)).toBe("daily");
    expect(tenorBand(5)).toBe("daily");
    expect(tenorBand(6)).toBe("weekly");
    expect(tenorBand(10)).toBe("weekly");
    expect(tenorBand(11)).toBe("monthly");
    expect(tenorBand(35)).toBe("monthly");
    expect(tenorBand(36)).toBe("quarterly");
    expect(tenorBand(360)).toBe("quarterly");
    expect(tenorBand(361)).toBe("annual");
  });
});

describe("termStructure", () => {
  const EXPS: MscExpiryRow[] = [
    { exp: "2026-08-21", gamma_net: 10, delta_net: 40 },
    { exp: "2026-08-03", gamma_net: 60, delta_net: 200 },
    { exp: "2026-08-06", gamma_net: -30, delta_net: -60 },
  ];

  it("sorts by date, negates to a requirement, and accumulates from the nearest expiry", () => {
    const t = termStructure(EXPS, "gamma", "2026-08-01");
    expect(t.nodes.map((n) => n.exp)).toEqual(["2026-08-03", "2026-08-06", "2026-08-21"]);
    expect(t.nodes[0].hedgeMn).toBe(-60);
    expect(t.nodes[1].hedgeMn).toBe(30);
    expect(t.nodes[0].cumMn).toBe(-60);
    expect(t.nodes[1].cumMn).toBe(-30);
    expect(t.nodes[2].cumMn).toBe(-40);
  });

  it("computes DTE from the payload asof, never the wall clock", () => {
    const t = termStructure(EXPS, "gamma", "2026-08-01");
    expect(t.nodes[0].dte).toBe(2);
    expect(t.nodes[2].dte).toBe(20);
    // a different asof moves every DTE, proving it isn't reading "now"
    const t2 = termStructure(EXPS, "gamma", "2026-07-01");
    expect(t2.nodes[0].dte).toBe(33);
  });

  it("bands each node by the gap to the NEXT expiration", () => {
    const t = termStructure(EXPS, "gamma", "2026-08-01");
    expect(t.nodes[0].gapDays).toBe(3);
    expect(t.nodes[0].band).toBe("daily");
    expect(t.nodes[1].gapDays).toBe(15);
    expect(t.nodes[1].band).toBe("monthly");
    // the last expiration has no next, so no band rather than a guessed one
    expect(t.nodes[2].gapDays).toBeNull();
    expect(t.nodes[2].band).toBeNull();
  });

  it("degrades without an asof rather than inventing DTEs", () => {
    const t = termStructure(EXPS, "gamma", null);
    expect(t.nodes.every((n) => n.dte === null)).toBe(true);
    // gaps are expiry-to-expiry, so they survive a missing asof
    expect(t.nodes[0].gapDays).toBe(3);
  });

  it("returns an honest empty for no expirations", () => {
    expect(termStructure(null, "gamma", "2026-08-01").nodes).toEqual([]);
  });
});

describe("dailyHedging", () => {
  it("scales the spot leg by the ticker's own expected move, not a nominal 1%", () => {
    const d = dailyHedging(aggregate(ROWS), 2.0);
    // gamma 30 $mn per +1% ⇒ over a 2σ%... 2% move: dealers sell 60
    expect(d.fromSpotMn).toBeCloseTo(-60, 10);
    expect(d.emPct).toBe(2.0);
  });

  it("takes the time leg straight from charm and the vol leg from vanna", () => {
    const d = dailyHedging(aggregate(ROWS), 1.0, 1);
    expect(d.fromTimeMn).toBeCloseTo(-2, 10);
    expect(d.fromVolMn).toBeCloseTo(-30, 10);
    expect(d.totalMn).toBeCloseTo(-2 - 30 - 30, 10);
  });

  it("nulls a component whose lens is absent rather than counting it as zero", () => {
    const bare = aggregate([{ strike: 1, gamma_net: 10, gamma_call: 10, gamma_put: 0 }]);
    const d = dailyHedging(bare, 1.0);
    expect(d.fromTimeMn).toBeNull();
    expect(d.fromVolMn).toBeNull();
    expect(d.volPts).toBeNull();
    expect(d.totalMn).toBeCloseTo(-10, 10);
  });

  it("nulls the spot leg without an expected move", () => {
    const d = dailyHedging(aggregate(ROWS), null);
    expect(d.fromSpotMn).toBeNull();
    expect(d.emPct).toBeNull();
    // the other legs still stand
    expect(d.totalMn).toBeCloseTo(-32, 10);
  });
});
