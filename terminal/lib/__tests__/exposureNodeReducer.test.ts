import { describe, it, expect } from "vitest";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, selectedProjectionCells } from "../exposureMapProjection";
import { exposureNodes } from "../marketStructure";
import { CONTESTED_THRESHOLD, CONTESTED_VERSION, NODE_REDUCER_VERSION, SCANNER_VERSION,
  distanceFit, reduceExposureNodes, resolveNodeScope, scannerScore,
  type ScannerInput } from "../exposureNodeReducer";

// F1 §4 DESIGN reconstruction: SPY, the producer v1 fixture clocks, spot 600.24.
// Strike nets ($mn) 595→605; strike 600 carries the exact E1–E6 cells; every
// other strike is split on the integer weights [24,26,19,15,10,6]% truncated
// toward zero with the remainder in E6. Every cell has gross = |net| + 50,
// so Σnet = −1,383, Σ|net| = 2,703 and gross = 6,003 (≠ both).
const now = Date.parse("2026-10-19T20:00:00Z");
const MN = 1e6;
const SPOT = 600.24;
const E = ["2026-10-16", "2026-10-21", "2026-10-23", "2026-10-30", "2026-11-20", "2026-12-18"];
const W = [24, 26, 19, 15, 10, 6];
const NETS: Array<[number, number]> = [[595, -60], [596, -100], [597, -150], [598, -471], [599, -170],
  [600, -621], [601, 90], [602, -471], [603, 120], [604, 300], [605, 150]];
const ALL_LENS = { kind: "all" as const };
const parse = (raw: unknown) => qualifiedExposureProjection(raw, "SPY", "2026-10-15", now);
const reduce = (p: ReturnType<typeof parse>, o: Partial<Parameters<typeof reduceExposureNodes>[1]> = {}) =>
  reduceExposureNodes(p!, { metric: "gamma", lens: ALL_LENS, spot: SPOT, fresh: true, now, ...o });

const trunc = (v: number) => (v < 0 ? Math.ceil(v) : Math.floor(v));
const splitNet = (net: number): number[] => {
  const head = W.slice(0, 5).map((w) => trunc((net * w) / 100));
  return [...head, net - head.reduce((a, b) => a + b, 0)];
};
type WireCell = Record<string, unknown>;
const gammaCell = (netMn: number, grossMn: number, qpid: string): Record<string, unknown> =>
  ({ unit: "usd_delta_per_1pct_spot", expected: null, received: 2, qualified: 2, missing: 0,
    status: "complete_observed", net: netMn * MN, gross: grossMn * MN, known_net: netMn * MN,
    known_gross: grossMn * MN, qualified_population_id: qpid, exclusions: {} });
const unavailableMetric = (template: WireCell): Record<string, unknown> =>
  ({ ...template, expected: null, received: 2, qualified: 0, missing: 2, status: "unavailable",
    net: null, gross: null, known_net: null, known_gross: null });
const wireCell = (spec: { e: number; k: number; n: number; g: number }, template: WireCell): WireCell => {
  const expiry = E[spec.e % 6];
  return { expiry, economic_expiry_at: `${expiry}T20:00:00Z`, strike: spec.k,
    population_id: template.population_id, gamma: gammaCell(spec.n, spec.g, (template.gamma as WireCell).qualified_population_id as string),
    vanna: unavailableMetric(template.vanna as WireCell), charm: unavailableMetric(template.charm as WireCell),
    joint: { expected: null, received: 0, qualified: 0, missing: 0, population_id: template.population_id,
      model_ref: null, complete: false } };
};
export const designRaw = (): Record<string, unknown> => {
  const raw = structuredClone(producer) as unknown as Record<string, unknown>;
  const template = (raw.cells as WireCell[])[0];
  const cells: WireCell[] = [];
  for (const [strike, net] of NETS) {
    const per = strike === 600 ? [-160, -148, -120, -90, -63, -40] : splitNet(net);
    per.forEach((n, e) => cells.push(wireCell({ e, k: strike, n, g: Math.abs(n) + 50 }, template)));
  }
  return { ...raw, cell_count: cells.length, cells };
};
const specRaw = (specs: Array<{ e: number; k: number; n: number; g?: number }>): Record<string, unknown> => {
  const raw = structuredClone(producer) as unknown as Record<string, unknown>;
  const template = (raw.cells as WireCell[])[0];
  const cells = specs.map((s) => wireCell({ ...s, g: s.g ?? Math.abs(s.n) + 50 }, template));
  return { ...raw, cell_count: cells.length, cells };
};
const markUnavailable = (raw: Record<string, unknown>, expiry: string, strike: number) => {
  for (const cell of raw.cells as WireCell[]) {
    if (cell.expiry === expiry && cell.strike === strike) cell.gamma = unavailableMetric(cell.gamma as WireCell);
  }
};
const design = () => parse(designRaw())!;
const designDelta = (): NodeDeltaInput => {
  const cells = new Map<string, { net: number | null; gross: number | null }>();
  for (const cell of (designRaw().cells as WireCell[])) {
    const g = cell.gamma as Record<string, unknown>;
    cells.set(`${cell.expiry}|${cell.strike}`, { net: g.net as number | null, gross: g.gross as number | null });
  }
  return { unit: "usd_delta_notional", cells };
};

describe("F1 §4 DESIGN book", () => {
  it("reproduces the DESIGN book aggregates", () => {
    const p = design();
    const r = reduce(p);
    expect(r.status).toBe("ok");
    expect(r.partial).toBe(false);
    expect(r.basis).toBe("whole_population");
    expect(r.net).toBe(-1383);
    expect(r.gross).toBe(6003);
    expect(r.absoluteStrikeNet).toBe(2703);
    expect(r.dominantNode).toEqual({ strike: 600, net: -621, sign: -1, tieSet: [600] });
    expect(r.largestPositive).toEqual({ strike: 604, net: 300, sign: 1, tieSet: [604] });
    expect(r.largestNegative).toEqual(r.dominantNode);
    expect(r.concentration).toEqual({ numerator: 621, denominator: 2703, share: expect.closeTo(0.22974, 4),
      denominatorKind: "absolute_strike_net", wholePopulationKnown: true });
    expect(r.center?.strike).toBeCloseTo(600.39956, 5);
    expect(r.center).toMatchObject({ weights: "absolute_strike_net", totalWeight: 2703 });
    const e2 = selectedProjectionCells(p, { kind: "one", exp: "2026-10-21" }, now);
    expect(e2.find((c) => c.strike === 600)!.gamma.net).toBe(-148 * MN);
    expect(e2).toHaveLength(11);
    expect(r.coverage).toEqual({ expected: null, received: 132, qualified: 132, missing: 0 });
    expect(r.identity).toMatchObject({ reducer: NODE_REDUCER_VERSION, root: "SPY", kind: "modeled_exposure",
      metric: "gamma", unit: "usd_delta_per_1pct_spot", scopeKey: "all", cellCount: 66, strikeCount: 11 });
    // Composition, not forking: the same rows through the incumbent owners
    // reproduce the dominant strike and its exact tie set.
    const rows = [...new Set(p.cells.map((c) => c.strike))].sort((a, b) => a - b)
      .map((strike) => ({ strike, netMn: p.cells.filter((c) => c.strike === strike)
        .reduce((t, c) => t + c.gamma.net!, 0) / MN }));
    const summary = exposureNodes(rows, SPOT);
    expect(summary.netLeader?.strike).toBe(r.dominantNode!.strike);
    expect(summary.netTies).toEqual(r.dominantNode!.tieSet);
  });

  it("DESIGN runner-up tie at 0.76 is not contested", () => {
    const r = reduce(design());
    expect(r.contested).toEqual({ version: CONTESTED_VERSION, threshold: CONTESTED_THRESHOLD,
      ratio: expect.closeTo(0.75845, 4), contested: false,
      // 602 is the nearer of the two 471 ties (1.76 vs 2.24 from 600.24), so the
      // composed describeExposure order puts it first in the runner-up slot.
      runnerUp: { strike: 602, net: -471, sign: -1, tieSet: [598, 602] }, basis: "whole_population" });
  });

  it("0.90 is contested and just below is not", () => {
    const at = (a2: number) => reduce(parse(specRaw([{ e: 0, k: 600, n: 100 }, { e: 1, k: 605, n: a2 }])));
    expect(at(90).contested).toMatchObject({ ratio: 0.9, contested: true, runnerUp: { strike: 605, net: 90 } });
    expect(at(89.99).contested).toMatchObject({ contested: false });
    const ties = (specs: Array<{ e: number; k: number; n: number }>) =>
      reduce(parse(specRaw(specs)), { spot: 99 }).dominantNode;
    const pair = [{ e: 0, k: 95, n: 40 }, { e: 1, k: 105, n: -40 }];
    expect(ties(pair)).toEqual({ strike: 95, net: 40, sign: 1, tieSet: [95, 105] });
    expect(ties([...pair].reverse())).toEqual(ties(pair));
  });
});

describe("F1 §4 unknown, partial and scanner", () => {
  const knownNetMn = (raw: Record<string, unknown>, strike?: number) => (raw.cells as WireCell[])
    .filter((c) => strike === undefined || c.strike === strike)
    .reduce((t, c) => t + ((c.gamma as Record<string, unknown>).net as number | null ?? 0), 0) / MN;
  const knownGrossMn = (raw: Record<string, unknown>) => (raw.cells as WireCell[])
    .reduce((t, c) => t + ((c.gamma as Record<string, unknown>).gross as number | null ?? 0), 0) / MN;
  const absNodeMn = (raw: Record<string, unknown>) => {
    const per = new Map<number, number>();
    for (const c of raw.cells as WireCell[]) {
      const net = (c.gamma as Record<string, unknown>).net as number | null;
      if (net != null) per.set(c.strike as number, (per.get(c.strike as number) ?? 0) + net);
    }
    return [...per.values()].reduce((t, v) => t + Math.abs(v), 0) / MN;
  };

  it("unknown cell is never zero", () => {
    const raw = designRaw();
    markUnavailable(raw, "2026-10-16", 599);
    for (const expiry of E) markUnavailable(raw, expiry, 597);
    const r = reduce(parse(raw));
    expect(r.status).toBe("partial");
    expect(r.basis).toBe("known_subset");
    expect(r.unknownStrikes).toEqual([597]);
    expect(r.net).not.toBe(-1383);
    expect(r.net).toBe(knownNetMn(raw));
    expect(r.gross).toBe(knownGrossMn(raw));
    // The wiped strike is unknown, never a measured zero: it is absent from the
    // dominant tie set and adds nothing to the absolute strike net.
    expect(r.dominantNode!.tieSet).not.toContain(597);
    expect(r.absoluteStrikeNet).toBe(absNodeMn(raw));
  });

  it("partial implies null scanner score", () => {
    const raw = designRaw();
    markUnavailable(raw, "2026-10-16", 599);
    const r = reduce(parse(raw), { expectedMove: { points: 1.2, horizon: "1d", sourceRef: "moves" } });
    expect(r.status).toBe("partial");
    expect(r.scannerScore).toBeNull();
    expect(r.scanner).toEqual({ status: "unavailable", reasons: ["insufficient_coverage"] });
    expect(r.concentration!.wholePopulationKnown).toBe(false);
  });

  it("display clipping cannot change totals or the dominant node", () => {
    const raw = designRaw();
    const template = (raw.cells as WireCell[])[0];
    splitNet(-900).forEach((n, e) => (raw.cells as WireCell[]).push(wireCell({ e, k: 470, n, g: Math.abs(n) + 50 }, template)));
    raw.cell_count = (raw.cells as WireCell[]).length;
    const r = reduce(parse(raw));
    expect(r.dominantNode).toMatchObject({ strike: 470, net: -900, sign: -1 });
    expect(r.dominantNode!.tieSet).toEqual([470]);
    expect(r.net).toBe(-2283);
    const window = Array.from({ length: 160 }, (_, i) => 481 + 1.5 * i);
    expect(window).not.toContain(470);
    // The reduction takes no window: re-reducing after display clipping is the
    // identical object, still carrying the out-of-window dominant node.
    expect(reduce(parse(raw))).toEqual(r);
  });

  it("all-expiry and filtered leaders are separate identities", () => {
    const p = design();
    const filtered = reduce(p, { lens: { kind: "one", exp: "2026-10-21" } });
    expect(filtered.identity.scopeKey).toBe("exp:2026-10-21");
    expect(filtered.identity.scopeKey).not.toBe("all");
    expect(filtered.identity.scope).toEqual({ kind: "filtered_expiries", lens: "one", expiries: ["2026-10-21"] });
    expect(filtered.identity.cellCount).toBe(11);
    const e2 = selectedProjectionCells(p, { kind: "one", exp: "2026-10-21" }, now);
    expect(e2).toHaveLength(11);
    expect(filtered.dominantNode!.strike).toBe(600);
    expect(filtered.dominantNode!.net).toBe(e2.find((c) => c.strike === 600)!.gamma.net! / MN);
    expect(filtered.dominantNode!.sign).toBe(-1);
    expect(filtered.dominantNode!.tieSet).toEqual([600]);
    expect(filtered.net).toBe(selectedProjectionCells(p, { kind: "one", exp: "2026-10-21" }, now)
      .reduce((t, c) => t + c.gamma.net!, 0) / MN);
    const all = reduce(p);
    expect(all.identity.scopeKey).toBe("all");
    expect(all).toEqual(reduce(design()));
  });

  it("uses only the explicit eligible population of the resolved scope", () => {
    const p = design();
    const empty = reduce(p, { lens: { kind: "one", exp: "2026-12-25" } });
    expect(empty.status).toBe("empty");
    expect(empty.identity.scopeKey).toBe("exp:");
    expect(empty.net).toBeNull();
    expect(empty.dominantNode).toBeNull();
    expect(empty.concentration).toBeNull();
    expect(empty.contested).toBeNull();
    expect(empty.center).toBeNull();
    expect(empty.scanner).toEqual({ status: "unavailable", reasons: ["empty_scope"] });
    expect(resolveNodeScope(p, { kind: "one", exp: "2026-10-21" }, now))
      .toEqual({ kind: "filtered_expiries", lens: "one", expiries: ["2026-10-21"] });
  });
});

describe("F1 §4 E7 scanner and refusal books", () => {
  const em = (points: number) => ({ points, horizon: "1d", sourceRef: "moves" });

  it("scanner matches the oracle on the DESIGN dominant", () => {
    const r6 = reduce(design(), { expectedMove: em(6.0) });
    expect(r6.scanner).toMatchObject({ status: "ok", version: SCANNER_VERSION,
      dominance: expect.closeTo(0.241546, 5), cappedConcentration: expect.closeTo(0.918979, 5),
      strength: expect.closeTo(58.0262, 3), distanceEm: expect.closeTo(0.04, 6), distanceFit: 0,
      regimeMultiplier: 1, score: expect.closeTo(31.914, 3), candidateEligible: false,
      candidateScore: null, direction: "below" });
    expect(r6.scannerScore).toBeCloseTo(31.914, 3);
    const r12 = reduce(design(), { expectedMove: em(1.2) });
    expect(r12.scanner).toMatchObject({ distanceFit: expect.closeTo(0.25, 10),
      score: expect.closeTo(43.164, 3), candidateEligible: true, candidateScore: r12.scannerScore });
    expect(reduce(design(), { expectedMove: em(0.48) }).scannerScore).toBeCloseTo(76.914, 3);
    // The exact port, checked directly on the freeze's distance/fit points.
    expect(distanceFit(0.04)).toBe(0);
    expect(distanceFit(0.2)).toBe(0.25);
    expect(distanceFit(0.5)).toBe(1);
    expect(distanceFit(2)).toBe(1);
    expect(scannerScore({ spot: SPOT, strike: 600, expectedMove: 1.2, a1: 621, a2: 471,
      absoluteStrikeNet: 2703, regime: "negative", identityComplete: true, fresh: true,
      coverageComplete: true })).toMatchObject({ dominance: expect.closeTo(0.241546, 5),
      cappedConcentration: expect.closeTo(0.918979, 5), strength: expect.closeTo(58.0262, 3),
      score: expect.closeTo(43.164, 3), candidateEligible: true });
  });

  const ORACLE_BASE = { spot: 100, strike: 102, expectedMove: 2, a1: 100, a2: 80,
    absoluteStrikeNet: 400, regime: "negative" as const, identityComplete: true, fresh: true,
    coverageComplete: true };

  it("ports the oracle scanner_score base, regime penalties and zero-regime rule", () => {
    expect(scannerScore(ORACLE_BASE)).toMatchObject({ dominance: expect.closeTo(0.2, 12),
      cappedConcentration: 1, strength: expect.closeTo(60, 10), distanceEm: 1, distanceFit: 1,
      regimeMultiplier: 1, score: expect.closeTo(78, 10), direction: "above" });
    expect(scannerScore({ ...ORACLE_BASE, regime: "positive" }))
      .toMatchObject({ regimeMultiplier: 0.85, score: expect.closeTo(66.3, 10) });
    expect(scannerScore({ ...ORACLE_BASE, regime: "zero" }))
      .toMatchObject({ regimeMultiplier: 1, score: expect.closeTo(78, 10) });
  });

  const SWEEPS: Array<[number, boolean]> = [[0, false], [0.1, false], [0.5, true], [2, true],
    [2.0001, false], [3, false], [4, false], [8.9, false], [160.7, false]];
  it.each(SWEEPS)("ports the oracle distance sweep at %f EM", (d, eligible) => {
    for (const sign of [-1, 1] as const) {
      const s = scannerScore({ ...ORACLE_BASE, spot: 2000, strike: 2000 + sign * d * 10, expectedMove: 10 });
      if (s.status !== "ok") throw new Error(`unavailable: ${s.reasons.join(",")}`);
      expect(s.score).toBeCloseTo(33 + 45 * distanceFit(d)!, 10);
      expect(s.candidateEligible).toBe(eligible);
      if (d >= 4) {
        expect(s.score).toBeCloseTo(33, 10);
        expect(s.candidateScore).toBeNull();
      } else if (eligible) expect(s.candidateScore).toBe(s.score);
    }
  });

  const INVALID: Array<[string, Partial<ScannerInput> & Record<string, unknown>, string]> = [
    ["missing_em", { expectedMove: null }, "missing_expected_move"],
    ["zero_em", { expectedMove: 0 }, "invalid_expected_move"],
    ["negative_em", { expectedMove: -1 }, "invalid_expected_move"],
    ["nan_em", { expectedMove: NaN }, "invalid_expected_move"],
    ["infinite_em", { expectedMove: Infinity }, "invalid_expected_move"],
    ["bool_em", { expectedMove: true as unknown as number }, "invalid_expected_move"],
    ["missing_em_at_node", { expectedMove: null, strike: 100 }, "missing_expected_move"],
    ["zero_em_at_node", { expectedMove: 0, strike: 100 }, "invalid_expected_move"],
    ["zero_book", { a1: 0, a2: 0, absoluteStrikeNet: 0 }, "invalid_concentration"],
    ["inconsistent_top_two", { a1: 50, a2: 80 }, "invalid_concentration"],
    ["wrong_denominator", { absoluteStrikeNet: 100 }, "invalid_concentration"],
    ["partial_book", { coverageComplete: false }, "insufficient_coverage"],
    ["stale", { fresh: false }, "insufficient_freshness"],
    ["missing_identity", { identityComplete: false }, "insufficient_identity"],
    ["unknown_regime", { regime: null }, "unknown_regime"],
  ];
  it.each(INVALID)("refuses the oracle %s case with %s", (_id, overrides, reason) => {
    const s = scannerScore({ ...ORACLE_BASE, ...overrides } as ScannerInput);
    expect(s.status).toBe("unavailable");
    if (s.status === "unavailable") expect(s.reasons).toContain(reason);
  });

  it("collects every applicable scanner refusal without short-circuiting", () => {
    const s = scannerScore({ ...ORACLE_BASE, fresh: false, identityComplete: false, regime: null });
    expect(s).toEqual({ status: "unavailable",
      reasons: ["insufficient_identity", "insufficient_freshness", "unknown_regime"] });
  });

  it("ports the oracle uncapped, tied and singleton concentration edges", () => {
    expect(scannerScore({ ...ORACLE_BASE, a1: 100, a2: 90, absoluteStrikeNet: 1000 }))
      .toMatchObject({ strength: expect.closeTo(25, 10) });
    expect(scannerScore({ ...ORACLE_BASE, a1: 100, a2: 100, absoluteStrikeNet: 200 }))
      .toMatchObject({ dominance: expect.closeTo(0, 12), strength: expect.closeTo(50, 10) });
    expect(scannerScore({ ...ORACLE_BASE, a1: 100, a2: 0, absoluteStrikeNet: 100 }))
      .toMatchObject({ strength: expect.closeTo(100, 10), score: expect.closeTo(100, 10) });
  });

  it("gates the candidate on distance in expected moves, never on EM itself", () => {
    const input = { a1: 621, a2: 471, absoluteStrikeNet: 2703, regime: "negative" as const,
      identityComplete: true, fresh: true, coverageComplete: true };
    // 4.76/5.0 = 0.952 EM from spot: inside (0.1, 2.0] even though EM is 5.0.
    const near = scannerScore({ ...input, spot: 600.24, strike: 605, expectedMove: 5.0 });
    expect(near.status).toBe("ok");
    expect(near).toMatchObject({ distanceEm: expect.closeTo(0.952, 9), candidateEligible: true });
    expect(near.status === "ok" && near.candidateScore).toBe(near.status === "ok" ? near.score : null);
    // 10.24/1.5 = 6.8267 EM: outside the gate although EM is a small 1.5.
    const far = scannerScore({ ...input, spot: 600.24, strike: 590, expectedMove: 1.5 });
    expect(far.status).toBe("ok");
    expect(far).toMatchObject({ distanceEm: expect.closeTo(6.826666666666667, 9),
      candidateEligible: false, candidateScore: null });
    expect(far.status === "ok" && Number.isFinite(far.score)).toBe(true);
  });

  const FITS: Array<[number, number]> = [[0, 0], [0.05, 0], [0.1, 0], [0.3, 0.5], [0.5, 1], [1, 1], [2, 1],
    [3, 0.5], [4, 0], [8.9, 0], [160.7, 0]];
  it.each(FITS)("matches the oracle distance_fit table at %f", (d, fit) => {
      expect(distanceFit(d)).toBeCloseTo(fit, 12);
    });

  it.each([0.1, 0.5, 2.0, 4.0])("keeps distance_fit continuous at the %f edge", (edge) => {
    const at = distanceFit(edge)!;
    expect(Math.abs(distanceFit(edge - 1e-8)! - at)).toBeLessThan(3e-8);
    expect(Math.abs(distanceFit(edge + 1e-8)! - at)).toBeLessThan(3e-8);
  });

  it("refuses a negative or non-finite distance instead of returning a fit", () => {
    expect(distanceFit(-0.1)).toBeNull();
    expect(distanceFit(Infinity)).toBeNull();
  });

  it("refuses missing and invalid expected move instead of zero distance", () => {
    expect(reduce(design()).scanner).toEqual({ status: "unavailable", reasons: ["missing_expected_move"] });
    expect(reduce(design(), { expectedMove: em(0) }).scanner)
      .toEqual({ status: "unavailable", reasons: ["invalid_expected_move"] });
    expect(reduce(design(), { expectedMove: em(-1) }).scanner)
      .toEqual({ status: "unavailable", reasons: ["invalid_expected_move"] });
    expect(reduce(design(), { fresh: false, expectedMove: em(1.2) }).scanner)
      .toEqual({ status: "unavailable", reasons: ["insufficient_freshness"] });
  });

  it("cancellation-heavy book keeps gross and nulls the center", () => {
    const cancelled = reduce(parse(specRaw([{ e: 0, k: 600, n: 50, g: 50 }, { e: 1, k: 600, n: -50, g: 50 }])));
    expect(cancelled.status).toBe("net_cancelled");
    expect(cancelled.net).toBe(0);
    expect(cancelled.gross).toBe(100);
    expect(cancelled.dominantNode).toBeNull();
    expect(cancelled.concentration).toBeNull();
    expect(cancelled.contested).toBeNull();
    expect(cancelled.center).toBeNull();
    const zero = reduce(parse(specRaw([{ e: 0, k: 600, n: 0, g: 0 }])));
    expect(zero.status).toBe("zero");
    expect(zero.gross).toBe(0);
    expect(zero.dominantNode).toBeNull();
    expect(zero.center).toBeNull();
  });

  it("delta reduction is not scanned", () => {
    const r = reduce(design(), { metric: "delta", delta: designDelta() });
    expect(r.status).toBe("ok");
    expect(r.net).toBe(-1383);
    expect(r.scannerScore).toBeNull();
    expect(r.scanner).toEqual({ status: "unavailable", reasons: ["metric_not_scanned"] });
    expect(r.identity).toMatchObject({ metric: "delta", unit: "usd_delta_notional" });
  });

  it("gross is the sum of contract absolutes before cancellation", () => {
    const r = reduce(design());
    expect(r.gross).toBe(6003);
    expect(r.gross).not.toBe(Math.abs(r.net!));
    expect(r.gross).not.toBe(r.absoluteStrikeNet);
    const tampered = designRaw();
    ((tampered.cells as WireCell[])[0].gamma as Record<string, unknown>).gross = 1;
    expect(parse(tampered)).toBeNull();
  });

  it("a single nonzero strike is never contested and a1=0 has no contest", () => {
    const single = reduce(parse(specRaw([{ e: 0, k: 600, n: 100 }, { e: 1, k: 605, n: 0 }])));
    expect(single.contested).toEqual({ version: CONTESTED_VERSION, threshold: CONTESTED_THRESHOLD,
      ratio: 0, contested: false, runnerUp: null, basis: "whole_population" });
    expect(single.dominantNode).toMatchObject({ strike: 600, net: 100 });
  });
});
