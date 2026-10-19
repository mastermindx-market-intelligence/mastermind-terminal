import { describe, it, expect } from "vitest";
import { futuresGexInView, futuresGexVisualScale, futuresGexScaleLabel } from "../futuresGexVisual";
import { browserFuturesFixture } from "../../e2e/fixtures/futuresPublished";
import { DEFAULT_FUTURES_REQUEST } from "../futuresRequest";
const frame = () => structuredClone(browserFuturesFixture(DEFAULT_FUTURES_REQUEST).frames[0]);
describe("visible-prefix gamma display", () => {
  it("retains relative size beyond the former hardcoded 400M cap", () => {
    const f = frame(); if (f.gex.status !== "ok") throw Error("fixture");
    f.gex.projection.mapped.forEach((r, i) => { r.gammaNetMn = [800, -1600, 3200][i]; });
    const before = structuredClone(f); const scale = futuresGexVisualScale([f], 7400, 7600);
    expect(scale).toEqual({ maximumMn: 3200, limitMn: 5000, knownPoints: 3 });
    expect(800 / scale.limitMn).toBeLessThan(1600 / scale.limitMn); expect(f).toEqual(before);
  });
  it("never uses a later replay frame or an offscreen strike to set the scale", () => {
    const f = frame(); if (f.gex.status !== "ok") throw Error("fixture");
    f.gex.projection.mapped[0].gammaNetMn = 1e9; f.gex.projection.mapped[0].futuresPrice = 1;
    const early = futuresGexVisualScale([f], 7400, 7600); const later = structuredClone(f);
    if (later.gex.status !== "ok") throw Error("fixture"); later.gex.projection.mapped[1].gammaNetMn = 1e6;
    expect(early.limitMn).toBeLessThan(1000);
    expect(futuresGexVisualScale([f, later], 7400, 7600).limitMn).toBe(1e6);
    expect(futuresGexVisualScale([f], 7400, 7600)).toEqual(early);
  });
  it("keeps missing distinct from observed zero and handles finite extreme values", () => {
    const f = frame(); if (f.gex.status !== "ok") throw Error("fixture");
    f.gex.projection.mapped.forEach(r => { r.gammaNetMn = null; });
    expect(futuresGexVisualScale([f], 7400, 7600)).toEqual({ maximumMn: 0, limitMn: 1, knownPoints: 0 });
    f.gex.projection.mapped[0].gammaNetMn = 0;
    expect(futuresGexVisualScale([f], 7400, 7600).knownPoints).toBe(1);
    f.gex.projection.mapped[0].gammaNetMn = Number.MAX_VALUE;
    expect(Number.isFinite(futuresGexVisualScale([f], 7400, 7600).limitMn)).toBe(true);
  });
  it("has inclusive viewport edges and explicitly labeled source-dollar units", () => {
    expect(futuresGexInView(7500, 7500, 7501)).toBe(true); expect(futuresGexInView(7499.99, 7500, 7501)).toBe(false);
    expect(futuresGexInView(NaN, 7500, 7501)).toBe(false);
    expect(futuresGexScaleLabel(5000)).toBe("5B"); expect(futuresGexScaleLabel(-1600)).toBe("-1.6B"); expect(futuresGexScaleLabel(1e100)).toBe("1.00e+100M"); expect(futuresGexScaleLabel(500)).toBe("500M");
  });
});
