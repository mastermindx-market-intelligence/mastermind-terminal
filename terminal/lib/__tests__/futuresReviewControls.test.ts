import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
vi.mock("server-only", () => ({}));
import { joinFuturesSource } from "../futuresSourceJoin";
import { DEFAULT_FUTURES_REQUEST as request } from "../futuresRequest";
import { sourceFixture, fixtureNow } from "./fixtures/futuresSourceFixture";
const load = createRequire(import.meta.url);
const { fixture } = load("../../../hub/tests/fixtures/futuresCapture.js");
const { buildFuturesWorkspacePublication } = load("../../../hub/lib/futuresWorkspaceProjection.js");

describe("independent source-review counterexample adjudication", () => {
  it("F1: historical publication after source freshness is explicit history, not live data", () => {
    const s = sourceFixture(); s.freshUntilMs = s.sourceAsOfMs + 1000;
    s.publishedAtMs = s.sourceAsOfMs + 86400000;
    const history = joinFuturesSource(s, request, s.publishedAtMs);
    expect(history.status).toBe("data"); if (history.status !== "data") return;
    expect(history.data.basis).toBe("historical");
    s.basis = "realtime";
    expect(joinFuturesSource(s, request, s.publishedAtMs)).toEqual({ status: "unavailable", reason: "stale_source" });
  });
  it("F2: a start beyond expiration cannot admit any required later cutoff", () => {
    const { capture, selection } = fixture();
    capture.binding.validUntilNs = String(BigInt(capture.windowStartMs + 1000) * BigInt(1000000));
    capture.windowStartMs += 2000;
    const result = buildFuturesWorkspacePublication(capture, selection);
    expect(result).toEqual({ status: "unavailable", reason: "invalid_cutoffs" });
    expect(result).not.toHaveProperty("envelope");
  });
  it("F3: partial executions retain machine-readable coverage and withhold full CVD", () => {
    const { capture, selection } = fixture();
    capture.distribution = { audience: "subscriber_display", evidenceRef: "fixture:review-only-not-a-license" };
    const result = buildFuturesWorkspacePublication(capture, selection);
    expect(result.status).toBe("ok"); expect(result.source.views.at(-1).tradeCoverage).toBe("partial");
    const joined = joinFuturesSource(result.source, request, capture.publication.publishedAtMs);
    expect(joined.status).toBe("data"); if (joined.status !== "data") return;
    expect(joined.data.tradeCoverage).toBe("partial");
    expect(joined.data.frames.reduce((n, f) => n + f.bar.total, 0)).toBe(20);
    expect(joined.data.frames.every(f => f.bar.cvd === null)).toBe(true);
  });
  it("F4: one malformed clock refuses the whole frame set instead of dropping observations", () => {
    for (const invalid of ["not-a-number", NaN, null, {}, 1.5]) {
      const s = sourceFixture(); s.views.at(-1)!.frames[0].endMs = invalid as unknown as number;
      // Mutate all variants so the selected view is necessarily the malformed one.
      for (const v of s.views) for (const f of v.frames) f.endMs = invalid as unknown as number;
      expect(joinFuturesSource(s, request, fixtureNow)).toEqual({ status: "unavailable", reason: "source_invalid" });
    }
  });
});
