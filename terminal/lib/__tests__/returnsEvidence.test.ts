import { describe, expect, it } from "vitest";
import { flowEvidence, gexEvidence, qualifyReturnsForecast, type ReturnsForecast } from "../returnsEvidence";

const context = { symbol: "NVDA", asOf: "2026-10-16", basis: "adjusted_view" as const, quality: "qualified" as const, horizon: 21 as const, now: Date.parse("2026-10-18T00:00:00Z") };
const candidate = (): ReturnsForecast => ({ schema: "returns.forecast.v1", status: "ready", symbol: "NVDA", asOf: "2026-10-16", basis: "adjusted_view", horizon: 21,
  decisionCutoff: "2026-10-16T20:00:00Z", publishedAt: "2026-10-16T20:05:00Z", sourceMaxAvailableAt: "2026-10-16T20:00:00Z", event: { kind: "forward_close_return", neutralBandPct: 1 },
  probabilities: { down: 0.3, flat: 0.2, up: 0.5 }, quantilesPct: { p10: -8, p50: 2, p90: 12 }, model: { id: "synthetic-contract-fixture", version: "1", trainedThrough: "2026-10-15T20:00:00Z", features: "price" },
  validation: { method: "purged_walk_forward", observations: 500, effectiveObservations: 150, folds: 4, brier: 0.35, baselineBrier: 0.45, logLoss: 0.8, baselineLogLoss: 1.0, brierSkillCiLow: 0.03, calibrationError: 0.04, optionsAblationSkillCiLow: null, evaluatedThrough: "2026-10-15T20:00:00Z", prospectiveArchive: "synthetic-fixture", receiptSha256: "a".repeat(64) } });

describe("options evidence keeps source and intent distinctions", () => {
  it("preserves measured zero and leaves missing exposure unavailable", () => {
    const base = { schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-10-16" };
    expect(gexEvidence({ ...base, net_gex_bn: 0 }, "NVDA", "2026-10-16").netBn).toBe(0);
    expect(gexEvidence(base, "NVDA", "2026-10-16").netBn).toBeNull();
  });
  it("rejects a different root or session instead of falling back to today's book", () => {
    const data = { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-16", net_gex_bn: 4 };
    expect(gexEvidence(data, "NVDA", "2026-10-16").state).toBe("mismatch");
    expect(gexEvidence({ ...data, root: "NVDA" }, "NVDA", "2026-10-15").netBn).toBeNull();
  });
  it("does not turn soft net premium into an observed directional probability", () => {
    const r = flowEvidence({ schema: "live_flow.ticker/v1", root: "NVDA", asof: "2026-10-16", day: { gross: 0, n_events: 0, call_share: 0.7, net_soft: 100000000 } }, "NVDA", "2026-10-16");
    expect(r.gross).toBe(0); expect(r.events).toBe(0); expect(r).not.toHaveProperty("direction"); expect(r).not.toHaveProperty("probability");
  });
  it("matches timestamps by the existing New York source-day convention", () => {
    expect(gexEvidence({ schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-10-17T00:05:00Z", net_gex_bn: 4 }, "NVDA", "2026-10-16").state).toBe("ready");
    expect(gexEvidence({ schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-10-17T03:00:00Z", net_gex_bn: 4 }, "NVDA", "2026-10-17").state).toBe("mismatch");
    expect(flowEvidence({ schema: "live_flow.ticker/v1", root: "NVDA", asof: "2026-10-16T20:00:00.123456Z", day: { gross: 5, n_events: 1 } }, "NVDA", "2026-10-16").state).toBe("ready");
  });
  it.each([
    ["2026-01-17T04:30:00Z", "2026-01-16"],
    ["2026-07-17T03:30:00Z", "2026-07-16"],
    ["2026-10-16T20:00:00-04:00", "2026-10-16"],
  ])("uses the correct New York day across offsets and DST for %s", (asof, session) => {
    expect(flowEvidence({ schema: "live_flow.ticker/v1", root: "NVDA", asof, day: { gross: 5, n_events: 1 } }, "NVDA", session).state).toBe("ready");
  });
});

describe("forecast admission", () => {
  it("cannot self-admit a model from producer-authored metrics and hashes", () => { expect(qualifyReturnsForecast(candidate(), context)).toMatchObject({ status: "abstain", reasons: ["CANONICAL_MODEL_ADMISSION_NOT_PUBLISHED"] }); });
  it("abstains without a published model instead of fabricating odds", () => { expect(qualifyReturnsForecast(null, context)).toMatchObject({ status: "abstain", reasons: ["NO_QUALIFIED_ARTIFACT"] }); });
  it("rejects future-available inputs even with a matching event date", () => { const c = candidate(); c.sourceMaxAvailableAt = "2026-10-16T20:01:00Z"; expect(qualifyReturnsForecast(c, context)).toMatchObject({ status: "abstain", reasons: expect.arrayContaining(["DECISION_CLOCK_INVALID"]) }); });
  it("rejects training or evaluation after the decision cutoff", () => { const c = candidate(); c.model.trainedThrough = "2026-10-17T20:00:00Z"; expect(qualifyReturnsForecast(c, context).status).toBe("abstain"); c.model.trainedThrough = "2026-10-15T20:00:00Z"; c.validation.evaluatedThrough = "2026-10-17T20:00:00Z"; expect(qualifyReturnsForecast(c, context).status).toBe("abstain"); });
  it("requires both baseline improvement and acceptable held-out calibration", () => { const c = candidate(); c.validation.brier = 0.5; expect(qualifyReturnsForecast(c, context).status).toBe("abstain"); c.validation.brier = 0.35; c.validation.calibrationError = 0.3; expect(qualifyReturnsForecast(c, context).status).toBe("abstain"); });
  it("does not count overlapping observations as independent support", () => { const c = candidate(); c.validation.effectiveObservations = 12; expect(qualifyReturnsForecast(c, context)).toMatchObject({ status: "abstain", reasons: expect.arrayContaining(["VALIDATION_COVERAGE_INSUFFICIENT"]) }); });
  it("rejects invalid probability totals and crossed quantiles", () => { const c = candidate(); c.probabilities.up = 0.9; expect(qualifyReturnsForecast(c, context).status).toBe("abstain"); c.probabilities.up = 0.5; c.quantilesPct.p10 = 15; expect(qualifyReturnsForecast(c, context).status).toBe("abstain"); });
  it("requires options/flow to earn incremental inclusion", () => { const c = candidate(); c.model.features = "price_options_flow"; expect(qualifyReturnsForecast(c, context)).toMatchObject({ status: "abstain", reasons: expect.arrayContaining(["OPTIONS_INCREMENT_NOT_QUALIFIED"]) }); });
  it("refuses a mismatched subject, horizon or unverified price basis", () => { const c = candidate(); expect(qualifyReturnsForecast(c, { ...context, symbol: "AMD" }).status).toBe("abstain"); expect(qualifyReturnsForecast(c, { ...context, horizon: 5 }).status).toBe("abstain"); expect(qualifyReturnsForecast(c, { ...context, quality: "unverified" }).status).toBe("abstain"); });
});


it("rejects calendar-invalid timestamps that JavaScript otherwise normalizes", () => {
  const c = candidate(); c.publishedAt = "2026-02-30T20:05:00Z";
  expect(qualifyReturnsForecast(c, context)).toMatchObject({ status: "abstain", reasons: expect.arrayContaining(["DECISION_CLOCK_INVALID"]) });
  expect(gexEvidence({ schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-10-16garbage", net_gex_bn: 3 }, "NVDA", "2026-10-16").state).toBe("mismatch");
});
it("retains an explicit abstention reason when a producer returns an empty list", () => {
  expect(qualifyReturnsForecast({ status: "abstain", reasons: [] }, context)).toEqual({ status: "abstain", reasons: ["MODEL_ABSTAINED"] });
});
