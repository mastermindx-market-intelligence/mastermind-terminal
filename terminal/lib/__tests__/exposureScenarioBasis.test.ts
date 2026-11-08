import { describe, expect, it } from "vitest";
import { scenarioBasisFromRead } from "@/components/exposure-map/exposureScenarioBasis";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { ExposureMapMetric, ExposureMapRead } from "@/lib/exposureMap";

const now = Date.parse("2026-10-20T12:00:00Z");
const moves = { root: "SPY", raw: { schema: "options_hub.moves/v1", root: "SPY", asof: "2026-10-19", spot_ref: 100,
  expected_move: { pct: 3.92, band_mult: 1.96, horizon_days: 1 } }, now };
const lens: ExposureLens = { kind: "all" };

const read = (netTotalMn: number | null, over: Partial<ExposureMapRead> = {}): ExposureMapRead => ({
  state: "data", session: "2026-10-19", sourceAsOf: "2026-10-19T20:00:00Z", spot: 100, convention: null,
  summary: { netTotalMn } as unknown as ExposureMapRead["summary"], expiries: [], narrow: false, missingCells: null,
  qualification: "qualified", coverage: null, sourceRef: "sha:abc", clocks: null, selectionKey: "", ...over,
});
const scope = (totals: Partial<Record<ExposureMapMetric, number | null>>, refused: ExposureMapMetric[] = []) =>
  (_lens: ExposureLens, metric: ExposureMapMetric) => read(totals[metric] ?? null, refused.includes(metric) ? { state: "unavailable" } : {});

describe("scenarioBasisFromRead", () => {
  it("composes the admitted totals per greek and the 1σ move for the exact reference", () => {
    const basis = scenarioBasisFromRead(read(-1383), scope({ gamma: -1383, vanna: 220, charm: -80 }), lens, "SPY", moves);
    expect(basis).toEqual({ root: "SPY", session: "2026-10-19", referenceSpot: 100, gexMn: -1383, vexMn: 220, cexMn: -80,
      emPct: 2, qualification: "qualified", sourceRef: "sha:abc" });
  });

  it("reports a greek whose read is not data as null, never 0", () => {
    const basis = scenarioBasisFromRead(read(-1383), scope({ gamma: -1383, vanna: 220, charm: -80 }, ["vanna"]), lens, "SPY", moves);
    expect(basis?.vexMn).toBeNull();
    expect(basis?.gexMn).toBe(-1383);
  });

  it("withholds the move for another root or an absent payload and passes the qualification through", () => {
    const dated = read(-1383, { qualification: "dated" });
    expect(scenarioBasisFromRead(dated, scope({ gamma: -1383 }), lens, "SPY", { ...moves, root: "QQQ" })?.emPct).toBeNull();
    expect(scenarioBasisFromRead(dated, scope({ gamma: -1383 }), lens, "SPY", null)).toMatchObject({ emPct: null, qualification: "dated" });
  });

  it("has no basis without a dated reference", () => {
    expect(scenarioBasisFromRead(read(-1383, { state: "unavailable" }), scope({}), lens, "SPY", moves)).toBeNull();
    expect(scenarioBasisFromRead(read(-1383, { session: null }), scope({}), lens, "SPY", moves)).toBeNull();
    expect(scenarioBasisFromRead(read(-1383, { spot: null }), scope({}), lens, "SPY", moves)).toBeNull();
  });
});
