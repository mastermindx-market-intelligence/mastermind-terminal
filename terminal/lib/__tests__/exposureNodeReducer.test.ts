import { describe, it, expect } from "vitest";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, selectedProjectionCells } from "../exposureMapProjection";
import { exposureNodes } from "../marketStructure";
import { CONTESTED_THRESHOLD, CONTESTED_VERSION, NODE_REDUCER_VERSION, SCANNER_VERSION,
  distanceFit, reduceExposureNodes, resolveNodeScope, scannerScore,
  type NodeDeltaInput } from "../exposureNodeReducer";

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
