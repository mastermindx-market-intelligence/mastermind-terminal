import { describe, expect, it } from "vitest";
import producer from "./fixtures/exposure-projection-one-sided-v2.json";
import { expandExposureProjection, qualifiedExposureProjection, projectionNodes } from "../exposureMapProjection";
import { readExposureMap } from "../exposureMap";

// Actual Macro build_exposure_projection output from the synthetic test book,
// with only its call observed in both Greek and OI inputs. No put is invented.
const now = Date.parse("2026-10-19T20:00:00Z");
const lens = { kind: "all" } as const;
const shock = { spotPercent: 0, ivPoints: 0, calendarDays: 0 };

describe("observed-only one-sided producer book", () => {
  it("retains measured Gamma without asserting an empty unobserved side", () => {
    const p = qualifiedExposureProjection(producer, "SPY", "2026-10-15", now);
    expect(p).not.toBeNull();
    const { rows, coverage, coveredOnly } = projectionNodes(p!, lens, "gamma", shock, now);
    expect(rows).toEqual([{ strike: 100, netMn: .01, grossMn: .01 }]);
    expect(coverage).toEqual({ expected: null, received: 1, qualified: 1, missing: 0 });
    expect(coveredOnly).toBe(true);
    expect(p!.cells[0].gamma.net).toBeNull();
    expect(p!.cells[0].gamma.gross).toBeNull();
    expect(p!.cells[0].joint.complete).toBe(false);
    const read = readExposureMap({ root: "SPY", asof: "2026-10-15", spot_ref: 100,
      by_strike: [], exposure_projection: producer }, "SPY", null, lens, "gamma", "2026-10-19", now);
    expect(read.state).toBe("data");
    expect(read.summary.coveredOnly).toBe(true);
    expect(read.summary.netTotalMn).toBe(.01);
    expect(read.summary.population).toBe("unknown");
  });

  it("does not admit missing-free partials that claim a known expected population", () => {
    const p = expandExposureProjection(producer) as Record<string, unknown> & {
      cells: { gamma: { expected: number | null } }[];
    };
    p.cells[0].gamma.expected = 1;
    expect(qualifiedExposureProjection(p, "SPY", "2026-10-15", now)).toBeNull();
  });
});
