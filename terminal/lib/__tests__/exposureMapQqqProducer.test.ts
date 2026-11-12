import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import nativeEnvelope from "./fixtures/exposure-native-qqq-observed-v2.json";
import { readExposureMap } from "../exposureMap";
import { exposureChartFingerprint, exposureChartHref, parseExposureChartRequest } from "../exposureChartLink";
import { projectedExposureScenario, qualifiedExposureProjection, selectedProjectionCells } from "../exposureMapProjection";

// Exported without alteration from Macro's native QQQ producer and envelope.
// Market/reference/acquisition inputs are synthetic. This tests the cross-language
// contract, not a provider capture, redistribution rights or live qualification.
const now = Date.parse("2026-10-21T00:00:00Z");
const lens = { kind: "all" } as const;
const shock = { spotPercent: 1, ivPoints: 1, calendarDays: 1 };
const read = () => readExposureMap(nativeEnvelope, "QQQ", null, lens, "gamma", "2026-10-21", now);

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

describe("native QQQ producer → Exposure Map → main chart contract", () => {
  it("keeps the missing member, dated source price and measured denominator", () => {
    const result = read();
    expect(result).toMatchObject({
      state: "data", qualification: "dated", sourceAsOf: "2026-10-20", spot: 100,
      coverage: { expected: null, received: 120, qualified: 119, missing: 1 },
    });
    expect(result.expiries).toHaveLength(3);
    expect(result.summary.fullCount).toBeNull();
    expect(result.summary.netTotalMn).toBeCloseTo(.01, 12);
    expect(result.summary.grossTotalMn).toBeCloseTo(1.19, 12);
    expect(result.clocks?.available_at).toBe("2026-10-20T12:04:48.959845+00:00");
    expect(result.clocks?.option_observed_at).toBeNull();
    expect(result.clocks?.published_at).toBeNull();
  });

  it("withholds unsupported metrics, economic expiry and pre-availability reads", () => {
    const p = qualifiedExposureProjection(nativeEnvelope.exposure_projection, "QQQ", "2026-10-20", now)!;
    expect(p).not.toBeNull();
    expect(p.cells).toHaveLength(60);
    expect(selectedProjectionCells(p, { kind: "next-live" }, now)).toEqual([]);
    expect(selectedProjectionCells(p, { kind: "week" }, now)).toEqual([]);
    expect(projectedExposureScenario(p, p.cells[0], shock)).toBeNull();
    for (const metric of ["vanna", "charm", "combined"] as const) {
      expect(readExposureMap(nativeEnvelope, "QQQ", null, lens, metric, "2026-10-21", now).state).toBe("unavailable");
    }
    expect(qualifiedExposureProjection(nativeEnvelope.exposure_projection, "QQQ", "2026-10-20",
      Date.parse("2026-10-20T12:04:48Z"))).toBeNull();
  });

  it("binds the same QQQ source and coverage into the main-chart selection", async () => {
    const result = read();
    expect(result.state).toBe("data");
    const fingerprint = await exposureChartFingerprint("QQQ", result, lens, "gamma", shock);
    const request = { v: 1 as const, root: "QQQ", session: "2026-10-20", strike: 100,
      archived: true, metric: "gamma" as const, lens, shock, fingerprint };
    const url = new URL(exposureChartHref(request)!, "https://app.mastermind-x.com");
    expect(url.pathname).toBe("/terminal");
    expect(url.searchParams.get("symbol")).toBe("QQQ");
    expect(parseExposureChartRequest(url.hash)).toEqual(request);
    expect(await exposureChartFingerprint("SPY", result, lens, "gamma", shock)).not.toBe(fingerprint);
    const alteredCoverage = { ...result, coverage: { ...result.coverage!, qualified: 120, missing: 0 } };
    expect(await exposureChartFingerprint("QQQ", alteredCoverage, lens, "gamma", shock)).not.toBe(fingerprint);
  });
});
