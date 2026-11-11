import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RELATIVE_TREND_SCHEMA,
  ROTATION_METHOD_RELATIVE_TREND,
  relativeTrendLatest,
  relativeTrendPlacement,
  relativeTrendTrail,
  sectorRotationRelativeTrend,
  type RelativeTrendStatus,
} from "../rotationRelativeTrend";
import fixture from "./fixtures/sector-rotation-relative-trend.v1.json";

type Mutable = Record<string, unknown>;
const clone = (): Mutable => JSON.parse(JSON.stringify(fixture)) as Mutable;
const meta = (root: Mutable): Mutable => root.meta as Mutable;
const method = (root: Mutable): Mutable => meta(root).method as Mutable;
const sectors = (root: Mutable): Mutable[] => root.sectors as Mutable[];
const observations = (root: Mutable, index: number): Mutable[] => sectors(root)[index].observations as Mutable[];
const parsed = sectorRotationRelativeTrend(fixture);
if (!parsed) throw new Error("fixture must parse");
const V = "7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6";

describe("sectorRotationRelativeTrend", () => {
  it("parses the frozen fixture and keeps every status with its values or nulls", () => {
    expect(parsed.schema).toBe(RELATIVE_TREND_SCHEMA);
    expect(ROTATION_METHOD_RELATIVE_TREND).toBe("relative_trend_ema/v1");
    expect(parsed.asOf).toBe("2026-10-16");
    expect(parsed.method).toEqual({
      id: "relative_trend_ema", version: "v1", center: 100, formula: "x=100*EMA10(q)/EMA40(q); y=100*EMA3(x/x[-3])",
      alphaRule: "2/(span+1)", seedRule: "sma_first_span", anchor: "2016-01-01", warmupWeeks: 120,
      endpointPolicy: "completed_week_last_session_no_backshift", basis: "tr", benchmark: "SPY", calendar: "NYSE",
      timezone: "America/New_York", trailWeeks: 12, boundaryTolerance: 0.05,
    });
    expect(Object.keys(parsed.series)).toEqual(["xlk", "xlf", "xle", "xlv", "xlu", "xlp", "xlre"]);
    const counts: Record<RelativeTrendStatus, number> = { observed: 0, boundary: 0, warming_up: 0, missing_endpoint: 0, invalid_input: 0 };
    for (const series of Object.values(parsed.series)) for (const observation of series.observations) counts[observation.status] += 1;
    expect(counts).toEqual({ observed: 74, boundary: 1, warming_up: 13, missing_endpoint: 1, invalid_input: 1 });
    expect(parsed.series.xlk.observations[14]).toEqual({ weekEnd: "2026-10-16", x: 104, y: 101.1, status: "observed", vintage: "0a9b8c7d6e5f40312233445566778899aabbccddeeff00112233445566778899" });
    expect(parsed.series.xlf.observations[7]).toEqual({ weekEnd: "2026-08-28", x: null, y: null, status: "missing_endpoint", vintage: V });
    expect(parsed.series.xlre).toEqual({ id: "xlre", ticker: "XLRE", observations: [], reason: "thin_history" });
    expect(parsed.series.xlk.reason).toBeNull();
  });

  it("rejects a coordinate on a non-coordinate status and a null on a coordinate status", () => {
    const numberOnGap = clone();
    observations(numberOnGap, 1)[7].x = 100.2;
    expect(sectorRotationRelativeTrend(numberOnGap)).toBeNull();
    const nullOnCoordinate = clone();
    observations(nullOnCoordinate, 0)[3].y = null;
    expect(sectorRotationRelativeTrend(nullOnCoordinate)).toBeNull();
    const nullOnBoundary = clone();
    observations(nullOnBoundary, 2)[14].x = null;
    expect(sectorRotationRelativeTrend(nullOnBoundary)).toBeNull();
  });

  it("rejects a non-monotonic week end, a week end after the as-of date and a duplicate sector id", () => {
    const backwards = clone();
    observations(backwards, 0)[5].week_end = "2026-07-10";
    expect(sectorRotationRelativeTrend(backwards)).toBeNull();
    const repeated = clone();
    observations(repeated, 0)[5].week_end = observations(repeated, 0)[4].week_end;
    expect(sectorRotationRelativeTrend(repeated)).toBeNull();
    const future = clone();
    observations(future, 0)[14].week_end = "2026-10-23";
    expect(sectorRotationRelativeTrend(future)).toBeNull();
    const duplicate = clone();
    sectors(duplicate)[1].id = "xlk";
    expect(sectorRotationRelativeTrend(duplicate)).toBeNull();
  });

  it.each([
    ["center 0", { center: 0 }], ["benchmark QQQ", { benchmark: "QQQ" }], ["trail 11", { trail_weeks: 11 }],
    ["tolerance 0.5", { boundary_tolerance: 0.5 }], ["warm-up 119", { warmup_weeks: 119 }],
    ["backshift endpoint", { endpoint_policy: "backshift" }], ["price basis", { basis: "price" }],
    ["version v2", { version: "v2" }], ["extra key", { smoothing: "double" }],
  ] as const)("rejects a method block that differs from the frozen policy (%s)", (_label, patch) => {
    const root = clone();
    Object.assign(method(root), patch);
    expect(sectorRotationRelativeTrend(root)).toBeNull();
  });

  it("rejects a method block with a missing key or an empty formula", () => {
    const missing = clone();
    delete method(missing).calendar;
    expect(sectorRotationRelativeTrend(missing)).toBeNull();
    const empty = clone();
    method(empty).formula = "";
    expect(sectorRotationRelativeTrend(empty)).toBeNull();
  });

  it("rejects an unknown status, a malformed vintage, an out-of-range value and extra observation keys", () => {
    const unknown = clone();
    observations(unknown, 0)[2].status = "estimated";
    expect(sectorRotationRelativeTrend(unknown)).toBeNull();
    const vintage = clone();
    observations(vintage, 0)[2].vintage = "sha256:" + V;
    expect(sectorRotationRelativeTrend(vintage)).toBeNull();
    const metaVintage = clone();
    meta(metaVintage).vintage = V.slice(0, 40);
    expect(sectorRotationRelativeTrend(metaVintage)).toBeNull();
    const tooLarge = clone();
    observations(tooLarge, 0)[2].x = 10000.5;
    expect(sectorRotationRelativeTrend(tooLarge)).toBeNull();
    const tooSmall = clone();
    observations(tooSmall, 0)[2].y = 0.5;
    expect(sectorRotationRelativeTrend(tooSmall)).toBeNull();
    const extra = clone();
    observations(extra, 0)[2].note = "hand edited";
    expect(sectorRotationRelativeTrend(extra)).toBeNull();
    const reasonWithData = clone();
    sectors(reasonWithData)[0].reason = "thin_history";
    expect(sectorRotationRelativeTrend(reasonWithData)).toBeNull();
    const wrongSchema = clone();
    meta(wrongSchema).schema = "sector_cycles.rs_history.v1";
    expect(sectorRotationRelativeTrend(wrongSchema)).toBeNull();
    expect(sectorRotationRelativeTrend(null)).toBeNull();
    expect(sectorRotationRelativeTrend([])).toBeNull();
  });

  it("the latest observation is the last one at or before the as-of date whatever its status", () => {
    expect(relativeTrendLatest(parsed.series.xle)?.status).toBe("boundary");
    expect(relativeTrendLatest(parsed.series.xle)?.weekEnd).toBe("2026-10-16");
    expect(relativeTrendLatest(parsed.series.xlf, "2026-08-28")).toMatchObject({ weekEnd: "2026-08-28", status: "missing_endpoint" });
    expect(relativeTrendLatest(parsed.series.xlf, "2026-08-30")?.weekEnd).toBe("2026-08-28");
    expect(relativeTrendLatest(parsed.series.xlu, "2026-09-18")?.status).toBe("warming_up");
    expect(relativeTrendLatest(parsed.series.xlk, "2026-07-01")).toBeNull();
    expect(relativeTrendLatest(parsed.series.xlre)).toBeNull();
  });

  it("the trail breaks across warming-up, missing-endpoint and invalid-input weeks and keeps boundary weeks", () => {
    const xlf = relativeTrendTrail(parsed.series.xlf);
    expect(xlf.map(run => run.length)).toEqual([4, 7]);
    expect(xlf[0][0].weekEnd).toBe("2026-07-31");
    expect(xlf[1][0].weekEnd).toBe("2026-09-04");
    expect(xlf.flat().every(observation => observation.status === "observed")).toBe(true);
    const xlu = relativeTrendTrail(parsed.series.xlu);
    expect(xlu.map(run => run.length)).toEqual([2]);
    const xlv = relativeTrendTrail(parsed.series.xlv);
    expect(xlv.map(run => run.length)).toEqual([7, 4]);
    expect(xlv[1][0].weekEnd).toBe("2026-09-25");
    const xle = relativeTrendTrail(parsed.series.xle);
    expect(xle.map(run => run.length)).toEqual([12]);
    expect(xle[0][11].status).toBe("boundary");
    expect(relativeTrendTrail(parsed.series.xlk, 3).map(run => run.length)).toEqual([3]);
    expect(relativeTrendTrail(parsed.series.xlre)).toEqual([]);
    expect(relativeTrendTrail(parsed.series.xlu, 15)).toHaveLength(1);
  });

  it("a constant relative ratio sector is placed on the boundary of both axes and never in a quadrant", () => {
    for (const observation of parsed.series.xlp.observations) {
      const placement = relativeTrendPlacement(observation);
      expect(placement).toEqual({ state: "boundary", axes: ["rs63", "rs21"], nearest: ["leading", "improving", "lagging", "weakening"], rs63: 100, rs21: 100 });
      expect("quadrant" in placement).toBe(false);
    }
    expect(relativeTrendPlacement(parsed.series.xle.observations[14])).toEqual({ state: "boundary", axes: ["rs63"], nearest: ["weakening", "lagging"], rs63: 100.03, rs21: 97.8 });
    expect(relativeTrendPlacement(parsed.series.xlk.observations[14])).toEqual({ state: "placed", quadrant: "leading", rs63: 104, rs21: 101.1 });
  });

  it("a non-coordinate observation is unavailable with its status as the reason code", () => {
    expect(relativeTrendPlacement(parsed.series.xlf.observations[7])).toEqual({ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: "missing_endpoint" });
    expect(relativeTrendPlacement(parsed.series.xlu.observations[0])).toEqual({ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: "warming_up" });
    expect(relativeTrendPlacement(parsed.series.xlv.observations[10])).toEqual({ state: "unavailable", reason: "unmeasured", axes: [], reasonCode: "invalid_input" });
  });

  it("nothing in the parser reads options, strikes or Gamma", () => {
    const source = readFileSync(new URL("../rotationRelativeTrend.ts", import.meta.url), "utf8");
    for (const banned of ["gex", "gamma", "strike", "options"]) expect(source.toLowerCase()).not.toContain(banned);
  });
});
