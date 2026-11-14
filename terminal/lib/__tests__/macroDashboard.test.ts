import { describe, expect, it } from "vitest";
import { decodeMacroDashboard, macroDetailFromHash, macroOfficialResult, macroSafeLink, macroLocal } from "@/lib/shared-shell/macroDashboard";
import { normalizeMarketRisk } from "@/lib/marketRisk";

import { macroFixture } from "./fixtures/macroDashboard";

describe("native Macro source contract", () => {
  it("shows official actuals only with the watcher's verified, matching source binding", () => {
    const valid = { status: "published", data_ready: true, source_url: "https://www.bls.gov/news.release/ppi.htm", source_sha256: "b".repeat(64), content_sha256: "b".repeat(64), actual: { source_url: "https://www.bls.gov/news.release/ppi.htm", headline_en: "Official result" } };
    expect(macroOfficialResult(valid)).toBe(true);
    for (const delta of [{ data_ready: false }, { status: "published_unparsed" }, { content_sha256: "c".repeat(64) }, { source_url: "https://bls.gov.bad.example/result" }, { actual: { headline_en: "Unbound value" } }]) expect(macroOfficialResult({ ...valid, ...delta })).toBe(false);
  });
  it("preserves zeros, missing history and a historical score distinct from the measured blend", () => {
    const value = decodeMacroDashboard(macroFixture())!;
    expect(value.marketState.score).toBe(0); expect(value.marketState.raw_score).toBe(61);
    expect(value.sentiment.dial).toBe(0); expect(value.history[1].score).toBeNull();
    expect(value.currentRisk).toBeNull(); expect(value.brief.state_asof).toBe("2026-10-01");
  });
  it("refuses another market, missing publication binding, nonfinite values and unordered history", () => {
    for (const changes of [{ market: "HK" }, { display_only: false }, { publication_sha256: "" }, { published_at: "2026-11-13" }, { market_state: { score: Infinity } }, { history: [{ asof: "2026-11-13", score: 50 }, { asof: "2026-11-12", score: 55 }] }]) {
      expect(decodeMacroDashboard({ ...macroFixture(), ...changes })).toBeNull();
    }
  });
  it("never turns an expired live reading into current evidence", () => {
    const value = { schema: "risk_state.v1", live_active: true, nightly_asof: "2026-11-13", built: "2026-11-13T21:00:00Z", source_event_time: "2026-11-13T20:59:00Z", stale_after: "2026-11-13T21:05:00Z", live: { score: 60, verdict: "MIXED" }, display: { score: 60, verdict: "MIXED" } };
    expect(normalizeMarketRisk(value, Date.parse("2026-11-14T10:00:00Z"))?.stale).toBe(true);
  });
  it("retains supported deep links without admitting arbitrary URL schemes", () => {
    expect(macroDetailFromHash("#dlg-risk")).toBe("risk");
    expect(macroDetailFromHash("#dlg-fed")).toBe("rates");
    expect(macroDetailFromHash("#mx5PopFactors")).toBe("factors");
    for (const [anchor, target] of Object.entries({ "dlg-sentiment": "sentiment", "dlg-sector": "sectors", "dlg-aibrief": "brief", health: "sources", liquidity: "risk" })) expect(macroDetailFromHash(`#${anchor}`)).toBe(target);
    expect(macroLocal({ framing: "Published policy", framing_zh: "已发布政策" }, "en", "framing")).toBe("Published policy");
    expect(macroDetailFromHash("#anything")).toBeNull();
    expect(macroSafeLink("javascript:alert(1)")).toBeNull();
    expect(macroSafeLink("https://u:p@example.com")).toBeNull();
    expect(macroSafeLink("https://mastermind-x.com/macro_context.html#credit")).toBe("/macro_context.html#credit");
  });
});
