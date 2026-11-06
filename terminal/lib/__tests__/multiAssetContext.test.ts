import { describe, expect, it } from "vitest";
import { qualifyMultiAssetContext, multiAssetContextCopy } from "../multiAssetContext";
import { qualifyRiskEnvelope, riskEnvelopeCopy } from "../marketRisk";
import { MARKET_RISK_NOW, riskEnvelopeFixture } from "./marketRiskFixture";

// Fully synthetic, not a claim about an actual market return or historical alpha.
const DAY0 = "2026-10-01", DAY1 = "2026-10-07";
const DIGEST = "a".repeat(64);
const LIMITS = [
  "not_intraday", "not_native_foreign_market_returns", "not_observed_fund_flows",
  "not_point_in_time_backtest_evidence", "funds_may_overlap",
  "cash_is_separate_from_short_duration_funds", "not_an_allocation_recommendation",
];

function row(id: string, absolute: number, benchmark = -0.05) {
  const rel = (1 + absolute) / (1 + benchmark) - 1;
  const benchmarkRow = id === "SPY";
  return {
    instrument_id: id, label_en: id === "EEM" ? "Emerging-market equities" : id === "EFA" ? "Developed ex-US equities" : "US large-cap index",
    label_zh: id === "EEM" ? "新兴市场股票" : id === "EFA" ? "美国以外发达市场股票" : "美国大型股票",
    asset_class: "equity", exposure_region: id === "SPY" ? "US" : id === "EEM" ? "EM" : "DM_EX_US",
    listing_market: "US", currency: "USD", return_basis: "total_return",
    start_session: DAY0, end_session: DAY1, last_source_session: DAY1,
    status: "OBSERVED", reasons: [] as string[], absolute_return: absolute,
    relative_return: benchmarkRow ? null : rel,
    classification: benchmarkRow ? null : rel > 0 ? absolute > 0
      ? "POSITIVE_AND_OUTPERFORMING" : "RELATIVE_RESILIENCE_ONLY" : rel < 0 ? "UNDERPERFORMING" : "IN_LINE",
    source_ref: `data/yahoo/${id}.parquet`, source_digest: DIGEST,
    evidence_family_id: "yahoo_daily_adjusted_prices",
    ...(benchmarkRow ? {} : { comparison_status: "OBSERVED" }),
  };
}

function sample() {
  return {
    schema: "mastermind.multi_asset_daily_context/v1", method_version: "same_us_cash_session_snapshot.v1",
    captured_at: "2026-10-07T21:00:00Z", alignment_basis: "US_CASH_SESSION_LABEL_NOT_QUOTE_TIMESTAMP",
    window: { start_session: DAY0, end_session: DAY1, expected_session: DAY1,
      horizon_sessions: 4, calendar_owner: "lib.nyse_calendar", listing_timezone: "America/New_York" },
    status: "AVAILABLE", reasons: [] as string[], benchmark_instrument_id: "SPY", benchmark_return: -0.05,
    base_currency: "USD", rows: [row("EEM", -0.02), row("EFA", 0.01), row("SPY", -0.05)],
    coverage: { requested: 3, observed: 3, comparable: 2, invalid_sources: 0 },
    source_kind: "captured_mutable_daily_cache", provider_available_at: null,
    historical_original_availability_proven: false,
    capture_coherence: "individually_hashed_not_atomic_bundle",
    display_only: true, no_predictive_claim: true,
    authority: { can_rank: false, can_gate: false, can_size: false, can_trade: false },
    limitations: LIMITS.slice(), context_digest: DIGEST,
  };
}
describe("MA-5 qualified optional cross-asset context", () => {
  it("accepts same-USD cash-session rows without granting capital authority", () => {
    const result = qualifyMultiAssetContext(sample(), MARKET_RISK_NOW);
    expect(result.qualified).toBe(true);
    expect(result.context?.authority).toEqual({ can_rank: false, can_gate: false, can_size: false, can_trade: false });
    expect(result.context?.rows.map(r => r.instrument_id)).toEqual(["EEM", "EFA", "SPY"]);
    expect(result.context?.no_predictive_claim).toBe(true);
  });
  it("preserves all source clocks and dates under a normalized read", () => {
    const ctx = qualifyMultiAssetContext(sample(), MARKET_RISK_NOW).context!;
    expect(ctx.captured_at).toBe("2026-10-07T21:00:00Z");
    expect(ctx.window).toEqual(sample().window);
    expect(ctx.rows[0].last_source_session).toBe(DAY1);
    expect(qualifyMultiAssetContext(ctx, MARKET_RISK_NOW).qualified).toBe(true);
  });
  it("shows both negative absolute legs and relative resilience, not inflows", () => {
    const ctx = qualifyMultiAssetContext(sample(), MARKET_RISK_NOW).context!;
    const en = multiAssetContextCopy(ctx, false).join(" ");
    expect(en).toContain("SPY benchmark adjusted return -5.00%");
    expect(en).toContain("Emerging-market equities (EEM): USD adjusted return -2.00%");
    expect(en).toContain("relative wealth vs SPY +3.16%");
    expect(en).toContain("relative resilience only; not an absolute gain");
    expect(en).toContain("Not live fund flow, a trade instruction or a forecast");
    expect(en).not.toMatch(/we recommend|should buy|incoming money|probability\s*\d+/i);
  });
  it("renders source-owned Chinese rather than English labels", () => {
    const zh = multiAssetContextCopy(qualifyMultiAssetContext(sample(), MARKET_RISK_NOW).context!, true).join(" ");
    expect(zh).toContain("新兴市场股票（EEM）");
    expect(zh).toContain("仅相对抗跌，绝对收益未上涨");
    expect(zh).not.toContain("Emerging-market equities");
  });
  it("preserves optional source context through the existing BFF allowlist", () => {
    const env = { ...riskEnvelopeFixture(), multi_asset_context: sample() };
    const read = qualifyRiskEnvelope(env, "2026-10-07", MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    expect(read.envelope?.multi_asset_context).toBeTruthy();
    expect(riskEnvelopeCopy(read.envelope, false, MARKET_RISK_NOW).details.join(" ")).toContain("Emerging-market equities");
    expect(riskEnvelopeCopy(read.envelope, true, MARKET_RISK_NOW).details.join(" ")).toContain("新兴市场股票");
    expect(read.envelope?.hazard_summary).toEqual(env.hazard_summary);
    expect(read.envelope?.measured_state).toEqual(env.measured_state);
    expect(read.envelope?.policy_summary).toEqual(env.policy_summary);
  });
  it("keeps existing risk-envelope normalization and copy identical without the optional source", () => {
    const env = riskEnvelopeFixture(), before = JSON.stringify(env);
    const normalized = qualifyRiskEnvelope(env, "2026-10-07", MARKET_RISK_NOW);
    expect(normalized.qualified).toBe(true);
    expect(normalized.envelope).not.toHaveProperty("multi_asset_context");
    expect(riskEnvelopeCopy(normalized.envelope, false, MARKET_RISK_NOW).details.join(" ")).not.toContain("Historical cross-asset context");
    expect(JSON.stringify(env)).toEqual(before);
  });
  it("does not poison real risk/hazard when an optional source carries unauthorized trading authority", () => {
    const bad = sample(); bad.authority.can_trade = true;
    const env = { ...riskEnvelopeFixture(), multi_asset_context: bad };
    const read = qualifyRiskEnvelope(env, "2026-10-07", MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    expect(read.envelope).not.toHaveProperty("multi_asset_context");
    expect(read.envelope?.measured_state).toEqual(env.measured_state);
    expect(riskEnvelopeCopy(read.envelope, false, MARKET_RISK_NOW).details.join(" ")).not.toContain("Historical cross-asset context");
  });
  it("does not poison real risk when an optional untrusted row contains a non-finite number", () => {
    const bad = sample(); bad.rows[0].absolute_return = Number.NaN;
    const read = qualifyRiskEnvelope({ ...riskEnvelopeFixture(), multi_asset_context: bad }, "2026-10-07", MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    expect(read.envelope).not.toHaveProperty("multi_asset_context");
  });
  it("rejects unknown version, missing digest and guessed quote availability", () => {
    const changes: ((v: ReturnType<typeof sample>) => void)[] = [
      v => { v.schema = "fake.multi_asset/v1"; },
      v => { v.context_digest = ""; },
      v => { v.provider_available_at = "2026-10-07T20:00:00Z" as never; },
      v => { v.historical_original_availability_proven = true; },
      v => { v.capture_coherence = "settled_atomic"; },
      v => { v.alignment_basis = "matching_instant_trades"; },
    ];
    for (const change of changes) {
      const x = sample();change(x);
      expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    }
  });
  it("rejects a future capture, invalid calendar or future session", () => {
    const changes: ((v: ReturnType<typeof sample>) => void)[] = [
      v => { v.captured_at = "2026-10-10T20:00:00Z"; },
      v => { v.captured_at = "2026-10-07T20:00:00"; },
      v => { v.window.expected_session = "2026-10-09"; },
      v => { v.window.listing_timezone = "UTC"; },
      v => { v.window.end_session = "2026-10-08"; },
      v => { v.window.start_session = "2026-10-07"; },
    ];
    for (const change of changes) {
      const x = sample(); change(x);
      expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    }
  });
  it("rejects duplicate rows and missing benchmark", () => {
    const x = sample(); x.rows[1].instrument_id = "EEM";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    const y = sample(); y.rows[2].instrument_id = "QQQ";
    expect(qualifyMultiAssetContext(y, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects foreign listing/currency masquerading as same-USD cash session", () => {
    const x = sample(); x.rows[0].currency = "HKD";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    const y = sample(); y.rows[0].listing_market = "HK";
    expect(qualifyMultiAssetContext(y, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects derivative signals mislabeled as measured returns", () => {
    const x = sample(); x.rows[0].return_basis = "estimated_pressure";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    const y = sample(); y.rows[0].evidence_family_id = "gex_sign";
    expect(qualifyMultiAssetContext(y, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects NaN, Infinity, out-of-range returns and incorrect ratio arithmetic", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1.01]) {
      const x = sample(); x.rows[0].absolute_return = invalid;
      expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    }
    const y = sample(); y.rows[0].relative_return = .45;
    expect(qualifyMultiAssetContext(y, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects a false positive label on an actually declining asset", () => {
    const x = sample(); x.rows[0].classification = "POSITIVE_AND_OUTPERFORMING";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects coverage counts, changed horizon, misleading status and reason", () => {
    const changes: ((v: ReturnType<typeof sample>) => void)[] = [
      v => { v.coverage.comparable = 3; },
      v => { v.coverage.observed = 2; },
      v => { v.window.horizon_sessions = 0; },
      v => { v.status = "STALE"; },
      v => { v.reasons = ["older_than_expected_session"]; },
    ];
    for (const change of changes) {
      const x = sample(); change(x);
      expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    }
  });
  it("qualifies stale but does not claim today's leadership or fund movement", () => {
    const x = sample();x.window.end_session = "2026-10-06";x.status = "STALE";
    x.reasons = ["older_than_expected_session"];
    for (const r of x.rows) { r.end_session = "2026-10-06"; r.last_source_session = "2026-10-06"; }
    const read = qualifyMultiAssetContext(x, MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    const copy = multiAssetContextCopy(read.context!, false).join(" ");
    expect(copy).toContain("(stale)");
    expect(copy).toContain("2026-10-06");
    expect(copy).not.toContain("live flow");
  });
  it("preserves canonical payload and never mutates the supplied observations", () => {
    const x = sample(), original = JSON.stringify(x);
    const r = qualifyMultiAssetContext(x, MARKET_RISK_NOW);
    expect(r.qualified).toBe(true);
    expect(JSON.stringify(x)).toEqual(original);
    expect(r.context?.context_digest).toEqual(DIGEST);
  });
  it("sorts the display by stable identity rather than relative performance", () => {
    const x = sample(); x.rows.reverse();
    const r = qualifyMultiAssetContext(x, MARKET_RISK_NOW);
    expect(r.context?.rows.map(row => row.instrument_id)).toEqual(["EEM", "EFA", "SPY"]);
    expect(r.context?.rows.map(row => row.absolute_return)).toEqual([-.02,.01,-.05]);
  });
  it("rejects source schema prefixes and malformed source provenance", () => {
    const x = sample();x.rows[0].source_ref = "../../private/account";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
    const y = sample();y.rows[0].source_digest = "spoofed";
    expect(qualifyMultiAssetContext(y, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("retains the all-false authority and cannot add ranking or sizing through hidden fields", () => {
    const x = sample();const noisy = { ...x, best_buy: "EEM", action: { can_trade: true } };
    const r = qualifyMultiAssetContext(noisy, MARKET_RISK_NOW);
    expect(r.qualified).toBe(true);
    expect(r.context).not.toHaveProperty("best_buy");
    expect(r.context).not.toHaveProperty("action");
    expect(r.context).toHaveProperty("authority.can_trade", false);
  });
});
