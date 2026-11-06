import { describe, expect, it } from "vitest";
import { qualifyMultiAssetContext, multiAssetContextCopy } from "../multiAssetContext";
import { qualifyRiskEnvelope, riskEnvelopeCopy } from "../marketRisk";
import { MARKET_RISK_NOW, riskEnvelopeFixture } from "./marketRiskFixture";

// Generated from Macro's v1 producer with synthetic prices only; no historical evidence.
import syntheticContext from "./fixtures/multiAssetDaily.synthetic.json";
const DAY1 = "2026-10-07";
const DIGEST = syntheticContext.context_digest;
function sample() {
  const x = structuredClone(syntheticContext);
  return { ...x, reasons: x.reasons as string[],
    rows: x.rows.map(row => ({ ...row, reasons: row.reasons as string[] })) };
}

describe("MA-5 qualified optional cross-asset context", () => {
  it("accepts same-USD cash-session rows without granting capital authority", () => {
    const result = qualifyMultiAssetContext(sample(), MARKET_RISK_NOW);
    expect(result.qualified).toBe(true);
    expect(result.context?.authority).toEqual({ can_rank: false, can_gate: false, can_size: false, can_trade: false });
    expect(result.context?.rows.map(r => r.instrument_id)).toEqual(syntheticContext.rows.map(r => r.instrument_id));
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
    const y = sample(); y.rows.find(row => row.instrument_id === "SPY")!.instrument_id = "QQQ";
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
    expect(r.context?.rows.map(row => row.instrument_id)).toEqual(syntheticContext.rows.map(r => r.instrument_id));
    expect(r.context?.rows.map(row => row.absolute_return)).toEqual(syntheticContext.rows.map(row => row.absolute_return));
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


describe("producer-contract parity at the Terminal boundary", () => {
  it("rejects a well-shaped ticker outside the producer's fixed universe", () => {
    const x = sample();
    const r = x.rows.find(row => row.instrument_id === "EEM")!;
    r.instrument_id = "FAKE"; r.source_ref = "data/yahoo/FAKE.parquet";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects asset identities relabelled as risk-free cash", () => {
    const x = sample();
    const r = x.rows.find(row => row.instrument_id === "EEM")!;
    r.label_en = "Cash - risk free"; r.asset_class = "cash";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("drops a capture newer than its carrying envelope without dropping core risk", () => {
    const x = sample(); x.captured_at = "2026-10-08T07:00:00Z";
    const read = qualifyRiskEnvelope({ ...riskEnvelopeFixture(), multi_asset_context: x }, "2026-10-07", MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    expect(read.envelope).not.toHaveProperty("multi_asset_context");
    expect(read.envelope?.measured_state).toEqual(riskEnvelopeFixture().measured_state);
  });
  it("rejects an impossible calendar capture rather than normalizing it into a new day", () => {
    const x = sample(); x.captured_at = "2026-09-31T21:00:00Z";
    Object.assign(x.window, { start_session: "2026-09-24", end_session: "2026-09-30", expected_session: "2026-09-30" });
    for (const r of x.rows) Object.assign(r, { start_session: "2026-09-24", end_session: "2026-09-30", last_source_session: "2026-09-30" });
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("rejects unexplained unavailable returns instead of treating them as proper abstention", () => {
    const x = sample();
    const r = x.rows.find(row => row.instrument_id === "EEM")!;
    Object.assign(r, { status: "UNAVAILABLE", absolute_return: null, relative_return: null,
      classification: null, reasons: [], comparison_status: undefined });
    x.coverage.observed--; x.coverage.comparable--; x.status = "PARTIAL";
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
});


describe("source-bound capture precision and complete proxy coverage", () => {
  it.each([
    ["2026-10-08T06:00:00.000001Z", "2026-10-08T06:00:00.000000Z", false],
    ["2026-10-08T06:00:00.000001Z", "2026-10-08T06:00:00.000002Z", true],
    ["2026-10-07T22:00:00.000001-08:00", "2026-10-08T06:00:00.000000Z", false],
    ["2026-10-07T22:00:00.000000-08:00", "2026-10-08T06:00:00.000000Z", true],
  ])("compares capture %s against carrying publication %s", (captured, parent, expected) => {
    const x = sample(); x.captured_at = captured;
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW, parent).qualified).toBe(expected);
  });
  it("requires unavailable proxies to remain present rather than shrinking the denominator", () => {
    const x = sample(); x.rows.pop();
    x.coverage.requested--; x.coverage.observed--; x.coverage.comparable--;
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
  it("retains a properly explained missing source and marks coverage partial", () => {
    const x = sample(); const r = x.rows.find(row => row.instrument_id === "EEM")!;
    Object.assign(r, { status: "UNAVAILABLE", absolute_return: null, relative_return: null,
      classification: null, reasons: ["source_missing"], comparison_status: undefined, source_digest: null });
    x.coverage.observed--; x.coverage.comparable--; x.status = "PARTIAL";
    const read = qualifyMultiAssetContext(x, MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    expect(read.context?.coverage).toMatchObject({ requested: 11, observed: 10, comparable: 9 });
    expect(read.context?.rows.find(row => row.instrument_id === "EEM")?.reasons).toEqual(["source_missing"]);
  });
  it("retains the source owner's short-duration fund identity rather than calling it cash", () => {
    const read = qualifyMultiAssetContext(sample(), MARKET_RISK_NOW);
    expect(read.qualified).toBe(true);
    expect(read.context?.rows.find(row => row.instrument_id === "SHY")?.label_en).toContain("not cash");
  });
  it("rejects an array coerced into a source digest", () => {
    const x = sample(); Object.assign(x.rows[0], { source_digest: ["a".repeat(64)] });
    expect(qualifyMultiAssetContext(x, MARKET_RISK_NOW).qualified).toBe(false);
  });
});
