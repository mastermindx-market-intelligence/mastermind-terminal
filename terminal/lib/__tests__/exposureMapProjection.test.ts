import { describe, it, expect } from "vitest";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, projectionNodes, projectedExposureScenario, selectedProjectionCells } from "../exposureMapProjection";
import { readExposureMap } from "../exposureMap";
import { exposureNodes } from "../marketStructure";

// Synthetic fixture exported directly from Macro's build_exposure_projection
// using tests/test_options_exposure_projection.py::book, put OI changed to 50.
const now = Date.parse("2026-10-19T20:00:00Z");
const parse = (p: unknown) => qualifiedExposureProjection(p, "SPY", "2026-10-15", now);
const shock = { spotPercent: 1, ivPoints: 1, calendarDays: 1 };
describe("qualified producer → consumer contract", () => {
  it("keeps exact contract gross and scales dollars to millions once", () => {
    const p = parse(producer)!; expect(p).not.toBeNull();
    const result = projectionNodes(p, { kind: "all" }, "gamma", shock);
    expect(result.rows).toEqual([{ strike: 100, netMn: .005, grossMn: .015 }]);
    const summary = exposureNodes(result.rows, 100, 1);
    expect(summary.grossTotalMn).toBe(.015); expect(summary.nodes[0].grossShare).toBe(1);
    // -(5000 gamma - 1000 vanna + 500 charm) USD delta.
    expect(projectedExposureScenario(p, p.cells[0], shock)).toBeCloseTo(-.0045, 12);
  });
  it("selects exact joint expirations without distributing marginals", () => {
    const p = parse(producer)!;
    expect(projectionNodes(p, { kind: "zero" }, "gamma", shock).rows).toEqual([]);
    expect(projectionNodes(p, { kind: "one", exp: "2026-10-23" }, "charm", shock).rows[0].netMn).toBeCloseTo(.0005);
  });
  it("separates source 0DTE from the actual economic expiry boundary", () => {
    const p = parse(producer)!;
    expect(selectedProjectionCells(p, { kind: "next-live" }, now)).toHaveLength(1);
    expect(selectedProjectionCells(p, { kind: "week" }, now)).toHaveLength(1);
    expect(selectedProjectionCells(p, { kind: "next-live" }, Date.parse("2026-10-23T20:00:00Z"))).toEqual([]);
    expect(selectedProjectionCells(p, { kind: "week" }, Date.parse("2026-10-24T12:00:00Z"))).toEqual([]);
    p.cells[0].economic_expiry_at = null;
    expect(selectedProjectionCells(p, { kind: "next-live" }, now)).toEqual([]);
    expect(selectedProjectionCells(p, { kind: "all" }, now)).toHaveLength(1);
  });
  it("requires matching members and models only for active nonzero shock terms", () => {
    const p = parse(producer)!; const q = structuredClone(p);
    q.cells[0].vanna.qualified_population_id = "f".repeat(64);
    expect(projectedExposureScenario(q, q.cells[0], shock)).toBeNull();
    expect(projectedExposureScenario(q, q.cells[0], { ...shock, ivPoints: 0 })).toBeCloseTo(-.0055);
    q.greek_provenance!.charm!.model_ref = "different";
    expect(projectedExposureScenario(q, q.cells[0], { ...shock, ivPoints: 0 })).toBeNull();
    q.cells[0].charm.net = null;
    expect(projectedExposureScenario(q, q.cells[0], { ...shock, ivPoints: 0 })).toBeNull();
    expect(projectedExposureScenario(q, q.cells[0], { spotPercent: 1, ivPoints: 0, calendarDays: 0 })).toBeCloseTo(-.005);
  });
  it("preserves observed zero OI without certifying a nonzero cancellation", () => {
    const raw = { ...structuredClone(producer), greek_provenance: null };
    for (const m of ["gamma", "vanna", "charm"] as const) { raw.cells[0][m].net = 0; raw.cells[0][m].gross = 0; }
    const p = parse(raw)!; expect(p).not.toBeNull();
    expect(projectedExposureScenario(p, p.cells[0], shock)).toBe(0);
    raw.cells[0].gamma.net = 1e-14; expect(parse(raw)).toBeNull();
    raw.cells[0].gamma.net = 0;
    raw.cells[0].gamma.gross = 1; expect(parse(raw)).toBeNull();
  });
  it("refuses malformed identity, future clocks, duplicate cells and impossible coverage", () => {
    for (const change of [
      (p: typeof producer) => { p.root = "QQQ"; },
      (p: typeof producer) => { p.input_sha256 = "unbound"; },
      (p: typeof producer) => { p.clocks.available_at = "2026-10-20T00:00:00Z"; },
      (p: typeof producer) => { p.cells.push(p.cells[0]); },
      (p: typeof producer) => { p.cells[0].gamma.missing = 1; },
      (p: typeof producer) => { p.cells[0].gamma.gross = 1; },
    ]) { const p = structuredClone(producer); change(p); expect(parse(p)).toBeNull(); }
  });
  it("withdraws oversized/unqualified projections without falling back to legacy ranks", () => {
    const payload = { root: "SPY", asof: "2026-10-15", spot_ref: 100, by_strike: [{ strike: 100, gamma_net: 99 }], exposure_projection: { ...producer, cells: [], cells_status: "payload_limit" } };
    const read = readExposureMap(payload, "SPY", null, { kind: "all" }, "gamma", "2026-10-19", now);
    expect(read.state).toBe("unavailable"); expect(read.summary.nodes).toEqual([]);
  });
  it("bounds the local scenario and preserves an explicit all-zero shock", () => {
    const p = parse(producer)!;
    for (const s of [{ ...shock, spotPercent: 4 }, { ...shock, ivPoints: 6 }, { ...shock, calendarDays: -1 }, { ...shock, spotPercent: NaN }]) expect(projectedExposureScenario(p, p.cells[0], s)).toBeNull();
    expect(projectedExposureScenario(p, p.cells[0], { spotPercent: 0, ivPoints: 0, calendarDays: 0 })).toBe(0);
  });
});
