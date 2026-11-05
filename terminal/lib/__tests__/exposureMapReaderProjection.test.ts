import { describe, expect, it } from "vitest";
import { createExposureMapReader } from "../exposureMap";
import { qualifiedExposureProjection } from "../exposureMapProjection";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";

const now = Date.parse("2026-10-20T12:00:00Z");

describe("createExposureMapReader().projection", () => {
  it("hands out the same validated projection the read qualified, never a re-derived one", () => {
    const raw = reportedGammaBook("2026-10-19");
    const reader = createExposureMapReader(raw, "SPY", null, "2026-10-20", now);
    const read = reader({ kind: "all" }, "gamma");
    expect(read.state).toBe("data");
    expect(["qualified", "dated"]).toContain(read.qualification);
    const p = reader.projection({ kind: "all" });
    expect(p).not.toBeNull();
    expect(p).toEqual(qualifiedExposureProjection(raw.exposure_projection, "SPY", "2026-10-19", now));
    expect(reader.projection({ kind: "all" })).toBe(p);
  });

  it("is null for a legacy book and for a foreign root", () => {
    const legacy = { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-19", spot: 600, by_strike: [] };
    expect(createExposureMapReader(legacy, "SPY", null, "2026-10-20", now).projection({ kind: "all" })).toBeNull();
    expect(createExposureMapReader(reportedGammaBook("2026-10-19"), "QQQ", null, "2026-10-20", now).projection({ kind: "all" })).toBeNull();
  });
});
