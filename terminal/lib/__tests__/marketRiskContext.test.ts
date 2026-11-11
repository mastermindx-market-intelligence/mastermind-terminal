import { describe, expect, it } from "vitest";
import { curateMarketRisk } from "../copilotTools";

const NOW = Date.parse("2026-10-08T16:00:00Z");
const flat = () => ({
  schema: "market_risk/v1", asof: "2026-10-08", verdict: "MIXED", score: 51,
  label_en: "Mixed", stale: false, realtime: true, is_display_only: true,
  radar: { state: "caution", top_score: 84.8, label_en: "Rates pressure" },
});
const legacy = () => ({
  built: "2026-10-08T12:00:00Z", display: { verdict: "RISK_ON", score: 71.4, label_en: "Risk on" },
});

describe("actual market-risk bridge consumer", () => {
  it("reads the real flat v1 producer without manufacturing build/expiry clocks", () => {
    const out = curateMarketRisk(flat(), NOW);
    expect(out.no_data).not.toBe(true);
    expect(out).toMatchObject({ source_schema: "market_risk/v1", verdict: "MIXED", score: 51,
      asof: "2026-10-08", built: null, age_hours: null, stale: null,
      source_reported_stale: false, source_reported_realtime: true,
      freshness_basis: "producer_report_only", is_display_only: true });
    expect(out.radar).toMatchObject({ state: "caution", top_score: 84.8 });
  });
  it.each([true, null, "false", 0])("does not discard a protective/invalid source stale marker: %s", (stale) => {
    expect(curateMarketRisk({ ...flat(), stale }, NOW).stale).toBe(true);
    expect(curateMarketRisk({ ...legacy(), stale }, NOW).stale).toBe(true);
  });
  it.each(["2026-10-09", "2026-10-08junk", "2026-02-30", "2026-10-08T00:00:00Z", null])(
    "rejects an invalid or future source session: %s", (asof) => {
      expect(curateMarketRisk({ ...flat(), asof }, NOW).stale).toBe(true);
    });
  it("keeps a historical source report available without calling it currently fresh", () => {
    const out = curateMarketRisk({ ...flat(), asof: "2020-01-02" }, NOW);
    expect(out.verdict).toBe("MIXED");
    expect(out.stale).toBeNull();
    expect(out.freshness_basis).toBe("producer_report_only");
  });
  it.each([null, "junk", "2026-10-08", "2026-10-08T12:00:00", "2026-10-09T12:00:00Z",
    "2026-02-30T12:00:00Z", "2026-10-08T25:00:00Z"])("does not call an invalid legacy clock fresh: %s", (built) => {
      const out = curateMarketRisk({ ...legacy(), built }, NOW);
      expect(out.stale).toBe(true);
      expect(out.age_hours).toBeNull();
    });
  it("preserves valid legacy freshness and checks the unrounded 48-hour boundary", () => {
    expect(curateMarketRisk(legacy(), NOW)).toMatchObject({ verdict: "RISK_ON", score: 71, stale: false });
    expect(curateMarketRisk({ ...legacy(), built: "2026-10-06T16:00:00Z" }, NOW).stale).toBe(false);
    expect(curateMarketRisk({ ...legacy(), built: "2026-10-06T15:59:59.999Z" }, NOW).stale).toBe(true);
  });
  it.each([true, false, NaN, Infinity, -Infinity, "51"])("refuses invalid scalar scores: %s", (score) => {
    const out = curateMarketRisk({ ...flat(), score, radar: { state: "caution", top_score: score } }, NOW);
    expect(out.score).toBeNull();
    expect((out.radar as Record<string, unknown>).top_score).toBeNull();
  });
  it("preserves legitimate zero, input immutability and display-only authority", () => {
    const source = { ...flat(), score: 0, may_execute: true, may_size: true, may_exit_modulate: true };
    const before = structuredClone(source);
    const out = curateMarketRisk(source, NOW);
    expect(out.score).toBe(0);
    expect(source).toEqual(before);
    expect(out.is_display_only).toBe(true);
    expect(out).not.toHaveProperty("may_execute");
    expect(out).not.toHaveProperty("may_size");
    expect(out).not.toHaveProperty("may_exit_modulate");
  });
  it.each([null, [], {}, { schema: "foreign.v1", display: { verdict: "RISK_ON" } },
    { ...flat(), verdict: "BUY_EVERYTHING" }])("refuses unsupported or missing risk evidence", (input) => {
      expect(curateMarketRisk(input, NOW).no_data).toBe(true);
    });
});
