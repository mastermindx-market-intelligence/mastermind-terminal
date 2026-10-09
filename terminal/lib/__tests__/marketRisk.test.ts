import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeMarketRisk, qualifyRiskEnvelope, riskEnvelopeCopy } from "../marketRisk";
import { curateMarketRisk, execTool } from "../copilotTools";
import { MARKET_RISK_NOW as NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "./marketRiskFixture";
import composedEnvelope from "./rotationRiskEnvelope.fixture.json";

function pythonBridge(source: unknown, envelope: unknown = riskEnvelopeFixture(), nowMs = NOW) {
  const code = [
    "import json,sys",
    "from datetime import datetime, timezone",
    "from ingest.pull_macro_risk import build_market_risk",
    "data=json.load(sys.stdin)",
    "print(json.dumps(build_market_risk(data['source'], now=datetime.fromisoformat(data['now'].replace('Z', '+00:00')), risk_envelope=data['envelope'])))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", code], {
    cwd: path.resolve(process.cwd(), ".."), input: JSON.stringify({ source, envelope, now: new Date(nowMs).toISOString() }), encoding: "utf8",
  })) as Record<string, unknown>;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("the actual Macro bridge to Terminal consumers", () => {
  it("preserves the real Macro composer's synthetic native envelope through Python and TypeScript", () => {
    const raw = pythonBridge({ ...marketRiskSourceFixture(), asof: composedEnvelope.source_session,
      built: composedEnvelope.produced_at }, composedEnvelope);
    const read = normalizeMarketRisk(raw, NOW)!;
    expect(read.risk_envelope_freshness.qualified).toBe(true);
    for (const key of ["measured_state", "hazard_summary", "policy_summary", "rotation_context", "confluence", "market_transition", "authority"] as const) {
      expect(read.risk_envelope?.[key]).toEqual(composedEnvelope[key]);
    }
    expect(curateMarketRisk(raw, NOW).risk_envelope).toMatchObject({
      rotation_context: { state: "DEFENSIVE_RELATIVE_STRENGTH", as_of: "2026-10-06" },
      confluence: { nonredundant_component_count: null, changes_hazard_stage: false },
    });
  });
  it("round-trips the Python flat contract, clocks, native score and envelope", () => {
    const source = marketRiskSourceFixture(), envelope = riskEnvelopeFixture();
    const raw = pythonBridge(source, envelope);
    const read = normalizeMarketRisk(raw, NOW)!;
    expect(read).toMatchObject({ verdict: "MIXED", score: 51, asof: source.asof, built: source.built, stale: false, source_basis: "settled" });
    expect(read.risk_envelope).toEqual(envelope);
    const ai = curateMarketRisk(raw, NOW);
    expect(ai).toMatchObject({ verdict: "MIXED", score: 51, stale: false, is_display_only: true });
    expect(ai.risk_envelope).toMatchObject({ confluence: { nonredundant_component_count: null, changes_hazard_stage: false },
      rotation_context: { state: "DEFENSIVE_RELATIVE_STRENGTH" } });
  });

  it.each([false, true])("the real get_market_state dispatcher retains context inside its payload budget (verbose caps: %s)", async verbose => {
    const source = marketRiskSourceFixture();
    const raw = pythonBridge(verbose ? { ...source, capped: true, score_caps: [
      { kind: "source cap ".repeat(50), reason: "source detail ".repeat(50), native_limit: 59 },
      { kind: "second cap ".repeat(50), reason: "native cause ".repeat(50), native_limit: 60 },
    ] } : source);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.stubEnv("NW_FIXTURE", "1");
    const plane = { asof: "2026-10-07", verdict: { verdict: "MIXED", score: 0.51, label_en: "Mixed" },
      regime: { quad: "Q2", quad_name: "Reflation", confidence: 0.7, cycle_tag: "mid", transition_state: "stable" },
      vol: { regime: "calm", risk_score: 22 }, liquidity_plumbing: { state: "ample", netliq_bn: 6210 }, contradiction_count: 1 };
    const reads: string[] = [];
    vi.spyOn(fs, "readFile").mockImplementation(async file => {
      reads.push(String(file));
      if (String(file).endsWith("market_risk.json")) return JSON.stringify(raw);
      if (String(file).endsWith("nw_plane_fixture.json")) return JSON.stringify(plane);
      throw new Error("unexpected test read");
    });
    const result = await execTool("get_market_state", {});
    expect(reads.some(file => file.endsWith("market_risk.json"))).toBe(true);
    expect(result.market_risk).toMatchObject({ verdict: "MIXED", score: 51,
      risk_envelope: { rotation_context: { state: "DEFENSIVE_RELATIVE_STRENGTH" },
        confluence: { nonredundant_component_count: null, statistical_independence_established: false },
        market_transition: { latest_recorded_change: { before: { asof: "2026-09-29" }, after: { asof: "2026-09-30" } } } } });
    expect(result.neural_web_plane).toBeTruthy();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  });

  it("inactive live fields cannot replace the settled explanation in either consumer", () => {
    const nightly = marketRiskSourceFixture();
    const source = { schema: "risk_state.v1", nightly_asof: nightly.asof, built: nightly.built, live_active: false,
      stale: true, stale_reason: "market closed", nightly, display: { verdict: "RISK_ON", score: 80 },
      live: { verdict: "RISK_OFF", headline_en: "Inactive live selloff", radar: { state: "BREAKDOWN" } } };
    for (const raw of [source, pythonBridge(source)]) {
      expect(normalizeMarketRisk(raw, NOW)).toMatchObject({ verdict: "MIXED", score: 51, headline_en: nightly.headline_en,
        radar: nightly.radar, stale: false, source_basis: "settled", realtime: false });
    }
  });
});

describe("source-clock qualification", () => {
  it.each([
    ["missing session", { asof: null }, "missing_or_invalid_asof"],
    ["future session", { asof: "2026-10-09" }, "future_asof"],
    ["impossible day", { asof: "2026-02-30" }, "missing_or_invalid_asof"],
    ["old evidence with a new build", { asof: "2026-10-01", built: "2026-10-08T11:59:00Z" }, "expired_asof"],
    ["future build", { built: "2026-10-09T00:00:00Z" }, "future_built"],
    ["naive build", { built: "2026-10-08T06:00:00" }, "invalid_built"],
    ["nonscalar build", { built: { value: "2026-10-08" } }, "invalid_built"],
    ["nonscalar expiry", { stale_after: false }, "invalid_stale_after"],
    ["impossible build day", { built: "2026-02-30T06:00:00Z" }, "invalid_built"],
    ["owner stale", { freshness: { stale: true } }, "owner_stale"],
    ["nonfinite score", { score: NaN }, "invalid_score"],
    ["boolean score", { score: false }, "invalid_score"],
  ])("rejects %s", (_name, patch, reason) => {
    const read = normalizeMarketRisk({ ...marketRiskSourceFixture(), ...patch }, NOW)!;
    expect(read.stale).toBe(true); expect(read.stale_reasons).toContain(reason);
  });

  it("requires active live event time and expiry, and selects the event session", () => {
    const nightly = marketRiskSourceFixture();
    const source = { schema: "risk_state.v1", nightly_asof: nightly.asof, nightly, live_active: true, realtime: true,
      built: "2026-10-08T11:00:00Z", stale_after: "2026-10-08T12:05:00Z",
      live: { verdict: "MIXED", source_event_time: "2026-10-08T11:00:00Z" },
      display: { verdict: "MIXED", score: 50 } };
    expect(normalizeMarketRisk(source, NOW)).toMatchObject({ asof: "2026-10-08", source_basis: "live_display", stale: false, realtime: true });
    expect(normalizeMarketRisk({ ...source, stale_after: null }, NOW)?.stale_reasons).toContain("missing_live_expiry");
    expect(normalizeMarketRisk({ ...source, stale_after: "2026-10-08T11:59:00Z" }, NOW)?.stale).toBe(true);
  });

  it("legacy display compatibility is explicitly labeled and expires", () => {
    const source = { built: "2026-10-08T06:00:00Z", display: { verdict: "MIXED", score: 51 } };
    expect(normalizeMarketRisk(source, NOW)).toMatchObject({ source_basis: "legacy_display", stale: true, asof: null, age_hours: null });
    expect(normalizeMarketRisk({ ...source, nightly_asof: "2026-10-07" }, NOW)).toMatchObject({ stale: false, asof: "2026-10-07" });
    expect(normalizeMarketRisk({ ...source, built: "2026-10-01T06:00:00Z" }, NOW)?.stale).toBe(true);
    expect(normalizeMarketRisk({ display: {} }, NOW)).toBeNull();
  });
});

describe("optional canonical envelope qualification", () => {
  it("preserves native partial coverage without dropping fresh measured state", () => {
    const envelope = riskEnvelopeFixture(), before = JSON.stringify(envelope);
    const result = qualifyRiskEnvelope(envelope, "2026-10-07", NOW);
    expect(result.qualified).toBe(true);
    expect(result.envelope?.freshness).toMatchObject({ all_on_session: false });
    expect(JSON.stringify(envelope)).toBe(before);
  });
  it.each([
    ["session mismatch", { source_session: "2026-10-06" }, "source_session_mismatch"],
    ["freshly built old source", { source_session: "2026-10-01", as_of: "2026-10-01" }, "invalid_future_or_expired_session"],
    ["future production", { produced_at: "2026-10-08T13:00:00Z" }, "future_produced_at"],
    ["missing observation", { observed_at: null }, "missing_or_invalid_observed_at"],
    ["UTC conversion past year 9999", { observed_at: "9999-12-31T23:00:00-02:00" }, "missing_or_invalid_observed_at"],
    ["UTC conversion before year 1", { produced_at: "0001-01-01T00:00:00+02:00" }, "missing_or_invalid_produced_at"],
    ["incoherent clocks", { observed_at: "2026-10-08T07:00:00Z" }, "incoherent_publication_clocks"],
    ["expired", { stale_after: "2026-10-08T11:59:00Z" }, "invalid_or_expired_envelope"],
    ["live without expiry", { revision: "live_provisional" }, "missing_live_expiry"],
    ["authority escalation", { authority: { envelope_may_execute: true } }, "unqualified_authority"],
    ["mismatched measured state", { measured_state: { usable: true, as_of: "2026-10-06" } }, "measured_session_mismatch"],
    ["confluence escalation", { confluence: { changes_hazard_stage: true } }, "invalid_confluence_authority"],
  ])("rejects %s without rewriting the market verdict", (_name, patch, reason) => {
    const env = { ...riskEnvelopeFixture(), ...patch };
    const read = normalizeMarketRisk({ ...marketRiskSourceFixture(), risk_envelope: env }, NOW)!;
    expect(read).toMatchObject({ score: 51, verdict: "MIXED", stale: false, risk_envelope: null });
    expect(read.risk_envelope_freshness.reasons).toContain(reason);
  });
  it("keeps missing coverage distinct from a measured zero", () => {
    const env = riskEnvelopeFixture();
    expect(riskEnvelopeCopy(env, false).details.join(" ")).toContain("total after removing overlap is unavailable");
    expect(riskEnvelopeCopy(env, true).caption).toContain("防御板块相对走强");
    expect(riskEnvelopeCopy(env, false).details.join(" ")).toContain("2026-09-29 → 2026-09-30");
  });
});

  it("does not infer participation or risk-off from broader-market proxies that fall less", () => {
    const env = riskEnvelopeFixture();
    const broadening = { ...env, measured_state: { ...env.measured_state, verdict: "RISK_ON", score: 76 },
      rotation_context: { ...env.rotation_context, state: "BROADENING", early_context: {
        ...env.rotation_context.early_context, state: "BROADENING", pairs: [{
          pair_id: "iwm_qqq", context_group: "broadening_proxy",
          horizons: { "2s": { shape: "BOTH_DOWN", numerator_return_pct: -1, denominator_return_pct: -3, ratio_return_pct: 2.0619 } },
        }],
      } } };
    const read = qualifyRiskEnvelope(broadening, "2026-10-07", NOW);
    expect(read.qualified).toBe(true);
    const copy = riskEnvelopeCopy(read.envelope, false);
    expect(copy.caption).toContain("Market backdrop: Risk on");
    expect(copy.caption).toContain("Broader-market proxies gaining relative strength");
    expect(copy.caption).not.toMatch(/participation|accumulation|Risk off/);
    expect(copy.details.join(" ")).toContain("does not establish inflows");
    expect(riskEnvelopeCopy(read.envelope, true).caption).toContain("更广市场代理相对转强");
  });

it("keeps the current live score/caps under a held display word in both real adapters", () => {
  const nightly = { ...marketRiskSourceFixture(), verdict: "RISK_ON", score: 66, raw_score: 66, capped: false, headline_en: "Old settled prose" };
  const source = { schema: "risk_state.v1", nightly_asof: nightly.asof, nightly, live_active: true, realtime: true,
    built: "2026-10-08T11:59:00Z", stale_after: "2026-10-08T12:05:00Z",
    live: { verdict: "MIXED", score: 50, raw_score: 78, capped: true, score_source: "verdict_cap",
      score_caps: [{ kind: "live_cap", limit: 50 }], source_event_time: "2026-10-08T11:58:00Z", headline_en: "Instantaneous Mixed" },
    display: { verdict: "RISK_ON", score: 50, raw_score: 78, headline_en: "Owner display projection",
      pending: { verdict: "MIXED", ticks: 1, needs: 2 } } };
  for (const raw of [source, pythonBridge(source, null)]) {
    expect(normalizeMarketRisk(raw, NOW)).toMatchObject({ verdict: "RISK_ON", score: 50, raw_score: 78,
      capped: true, score_caps: source.live.score_caps, headline_en: "Owner display projection", source_verdict: "MIXED",
      display_pending: source.display.pending, cause_basis: "live_score_pending_band", stale: false, age_hours: 0 });
    expect(curateMarketRisk(raw, NOW)).toMatchObject({ verdict: "RISK_ON", score: 50, raw_score: 78,
      capped: true, source_verdict: "MIXED", display_pending: source.display.pending });
  }
  source.display.raw_score = 79;
  expect(normalizeMarketRisk(source, NOW)?.raw_score).toBe(79);
});

it.each(["2026-10-09T01:00:00Z", "2026-12-09T04:30:00Z"])(
  "uses the same New York session in both adapters across UTC midnight (%s)", instant => {
    const nowMs = Date.parse(instant), utcDay = instant.slice(0, 10);
    const session = utcDay.slice(0, 8) + "08";
    const source = { ...marketRiskSourceFixture(), asof: session, built: session + "T20:00:00Z" };
    const base = riskEnvelopeFixture();
    const envelope = { ...base, source_session: session, as_of: session,
      observed_at: source.built, produced_at: source.built,
      measured_state: { ...base.measured_state, as_of: session },
      freshness: { ...base.freshness, source_session: session } };
    for (const raw of [{ ...source, risk_envelope: envelope }, pythonBridge(source, envelope, nowMs)]) {
      expect(normalizeMarketRisk(raw, nowMs)).toMatchObject({ stale: false, asof: session,
        risk_envelope_freshness: { qualified: true } });
    }
    const futureEnvelope = { ...envelope, source_session: utcDay, as_of: utcDay,
      measured_state: { ...envelope.measured_state, as_of: utcDay },
      freshness: { ...envelope.freshness, source_session: utcDay } };
    for (const raw of [
      { ...source, asof: utcDay, risk_envelope: futureEnvelope },
      pythonBridge({ ...source, asof: utcDay }, futureEnvelope, nowMs),
    ]) {
      const read = normalizeMarketRisk(raw, nowMs)!;
      expect(read.stale_reasons).toContain("future_asof");
      expect(read.risk_envelope).toBeNull();
      expect(read.risk_envelope_freshness.reasons).toContain("invalid_future_or_expired_session");
    }
    const live = { schema: "risk_state.v1", nightly_asof: session, nightly: source,
      live_active: true, realtime: true, built: instant,
      stale_after: new Date(nowMs + 300000).toISOString(),
      live: { verdict: "MIXED", score: 51, source_event_time: instant },
      display: { verdict: "MIXED", score: 51 } };
    for (const raw of [live, pythonBridge(live, envelope, nowMs)]) {
      expect(normalizeMarketRisk(raw, nowMs)).toMatchObject({ stale: false, asof: session, realtime: true });
    }
  },
);
