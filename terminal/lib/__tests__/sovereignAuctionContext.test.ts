import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auctionDisplayRows, validateSovereignAuctionContext } from "../sovereignAuctionContext";
const WRAPPER = JSON.parse(readFileSync(join(__dirname, "fixtures/sovereign_auction_context_w1.json"), "utf8"));
const fixture = () => structuredClone(WRAPPER.sovereign_auction_context);
const NOW = Date.parse("2026-10-08T22:16:00Z");
const valid = (c = fixture(), now = NOW) => validateSovereignAuctionContext(c, now);
function changed(fn: (c: ReturnType<typeof fixture>) => void) { const c = fixture(); fn(c); return c; }
describe("sovereign auction W1 display model", () => {
  it("binds three genuine future Bills without changing producer clocks, IDs, decimal strings or nulls", () => {
    const c = fixture(), result = valid(c); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.context.events.map(e => e.episode_id)).toEqual(c.events.map((e: { episode_id: string }) => e.episode_id));
    expect(result.context.decision_cutoff_utc).toBe("2026-10-08T22:15:00+00:00");
    expect(result.context.source_observed_at).toBe("2026-10-08T22:12:22.414829+00:00");
    expect(result.context.events[2].offering_amount_usd).toBe("95000000000");
    expect(result.context.events.every(e => e.result === null && e.probabilities === null)).toBe(true);
    expect(valid(result.context)).toEqual(result); // Actual proxy projection can be checked again by the component.
    expect(JSON.stringify(c)).toBe(JSON.stringify(fixture()));
  });
  it("strictly distinguishes absent, invalid, empty and failing sources", () => {
    expect(valid(null)).toEqual({ ok: false, reason: "absent" });
    for (const c of [{}, [], changed(c => c.events = {}), changed(c => c.schema_version = "v2")]) expect(valid(c).ok).toBe(false);
    const empty = changed(c => { c.events = []; c.episodes = []; });
    expect(valid(empty).ok).toBe(true);
    const failed = changed(c => {
      c.status = "degraded"; const h = c.source_health[0];
      h.latest_attempt_at = "2026-10-08T22:14:00+00:00"; h.latest_attempt_status = "unavailable"; h.latest_attempt_states = ["unavailable"];
      h.latest_failure_at = h.latest_attempt_at; h.latest_failure_reasons = ["official_source_unavailable"];
    });
    const result = valid(failed); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.context.source_health[0]).toEqual(failed.source_health[0]);
    expect(valid(failed, Date.parse("2026-11-08T00:00:00Z"))).toEqual(result); // No invented TTL/live certification.
  });
  it("rejects widened authority, invalid clocks, future evidence and stale source substitution", () => {
    for (const fn of [
      (c: ReturnType<typeof fixture>) => c.forecast_authority = "TRADE",
      (c: ReturnType<typeof fixture>) => c.is_context_only = false,
      (c: ReturnType<typeof fixture>) => c.probabilities = .5,
      (c: ReturnType<typeof fixture>) => c.importance = "HIGH",
      (c: ReturnType<typeof fixture>) => c.events[0].importance = "SCORED",
      (c: ReturnType<typeof fixture>) => c.events[0].known_at = "2026-10-08T22:16:01Z",
      (c: ReturnType<typeof fixture>) => c.source_health[0].latest_attempt_at = "2026-10-08T22:15:01Z",
      (c: ReturnType<typeof fixture>) => c.events[0].observation_versions[0].known_at = "2026-10-09T00:00:00Z",
      (c: ReturnType<typeof fixture>) => c.events[0].known_at = "2026-10-08T22:12:22",
      (c: ReturnType<typeof fixture>) => c.events[0].known_at = "2026-02-30T12:00:00Z",
      (c: ReturnType<typeof fixture>) => c.events[0].known_at = "2026-10-08T24:00:00Z",
      (c: ReturnType<typeof fixture>) => c.events[0].known_at = "2026-10-08T12:00:00+99:00",
      (c: ReturnType<typeof fixture>) => c.source_health[0].last_valid_observation_age_seconds = 0,
      (c: ReturnType<typeof fixture>) => c.source_health[0].stale_after_seconds = 86400,
      (c: ReturnType<typeof fixture>) => c.events[0].source_url = "https://home.treasury.gov/other"
    ]) expect(valid(changed(fn)).ok).toBe(false);
    expect(valid(fixture(), Date.parse("2026-10-08T22:14:00Z")).ok).toBe(false);
  });
  it("rejects numeric booleans, non-finite amounts, dangerous links and mixed identity", () => {
    for (const value of [true, false, NaN, Infinity, "Infinity", "NaN", "1e309", "", " 0 "])
      expect(valid(changed(c => c.events[0].offering_amount_usd = value)).ok).toBe(false);
    for (const value of [null, 0, "0", "95000000000", "1.25"]) expect(valid(changed(c => c.events[0].offering_amount_usd = value)).ok).toBe(true);
    for (const value of ["javascript:alert(1)", "http://home.treasury.gov/", "https://evil.example/", "https://home.treasury.gov.evil.example/", "https://user@home.treasury.gov/"])
      expect(valid(changed(c => { c.events[0].source = value; c.events[0].source_url = value; })).ok).toBe(false);
    expect(valid(changed(c => c.events[0].raw_class_flags.tips = "Yes")).ok).toBe(false);
    expect(valid(changed(c => c.events[0].episode_id = "auction:OTHER:2026-10-13")).ok).toBe(false);
    expect(valid(changed(c => c.events.push(c.events[0]))).ok).toBe(false);
  });
  it("a passed deadline does not supply results; future result-bearing contradictions reject", () => {
    expect(valid(changed(c => c.events[0].physical_state = "AWAITING_RESULT")).ok).toBe(false);
    const c = changed(c => {
      const elapsed = (Date.parse("2026-10-14T00:00:00Z") - Date.parse(c.decision_cutoff_utc)) / 1000;
      c.as_of = c.decision_cutoff_utc = "2026-10-14T00:00:00Z";
      c.events.forEach((e: { physical_state: string }) => e.physical_state = "AWAITING_RESULT");
      c.source_health.forEach((h: { last_valid_observation_age_seconds: number | null }) => {
        if (h.last_valid_observation_age_seconds !== null) h.last_valid_observation_age_seconds += elapsed;
      });
    });
    const result = valid(c, Date.parse("2026-10-14T00:01:00Z")); expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.events.every(e => e.result === null)).toBe(true);
    expect(valid(changed(c => { c.events[0].source_state = "RESULT_OBSERVED"; c.events[0].result_evidence_fields = ["highYield"]; })).ok).toBe(false);
  });
  it("enforces microsecond evidence order and reconciles lifecycle labels at the producer cutoff", () => {
    expect(valid(changed(c => c.events[0].first_observed_at = "2026-10-08T22:12:22.414830+00:00")).ok).toBe(false);
    expect(valid(changed(c => c.events[0].issue_calendar_state = "ISSUE_DATE_PASSED")).ok).toBe(false);
    expect(valid(changed(c => {
      c.source_observed_at = c.source_health[0].last_valid_observation_at = c.source_health[0].latest_attempt_at = "2026-10-08T22:15:00.000001Z";
      c.source_health[0].last_valid_observation_age_seconds = 0;
      c.events[0].known_at = c.source_observed_at;
    })).ok).toBe(false);
    expect(valid(changed(c => c.source_health[0].last_valid_observation_age_seconds += .000001)).ok).toBe(false);
    // A future request clock cannot advance the producer's frozen October 8 lifecycle state.
    expect(valid(fixture(), Date.parse("2026-11-08T00:00:00Z")).ok).toBe(true);
  });
  it("matches W1 base/type/flag reconciliation while preserving blank raw source fields", () => {
    for (const [base, explicit] of [["Bill", "Note"], ["Note", "Bond"], ["Bond", "Bill"]]) {
      expect(valid(changed(c => {
        c.events[0].raw_security_type = base; c.events[0].raw_type = explicit; c.events[0].normalized_class = explicit;
      })).ok).toBe(false);
    }
    const rawMissing = changed(c => {
      c.events[0].raw_security_type = " Bill "; c.events[0].raw_type = "";
      c.events[0].raw_class_flags = { tips: "", floatingRate: " ", cashManagementBillCMB: null };
    });
    const result = valid(rawMissing); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.context.events[0].raw_class_flags).toEqual(rawMissing.events[0].raw_class_flags);
    expect(result.context.events[0].raw_type).toBe("");
    expect(valid(result.context)).toEqual(result);
  });
  it("strips hostile extra risk aliases and orders groups chronologically without scoring", () => {
    const c = changed(c => { c.band = "critical"; c.stressed = true; c.events[0].risk_score = 1; });
    const result = valid(c); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(JSON.stringify(result.context)).not.toMatch(/risk_score|critical|stressed/);
    const rows = [...result.context.events];
    const mockRecent = { ...rows[0], episode_id: "recent", auction_date: "2026-10-01", result: { bid_to_cover_ratio: null } };
    const display = auctionDisplayRows({ ...result.context, events: [mockRecent, rows[2], rows[0], rows[1]] }, 3);
    expect(display.total).toBe(4); expect(display.rows.map(e => e.episode_id)).toEqual([rows[0].episode_id, rows[1].episode_id, rows[2].episode_id]);
    expect(auctionDisplayRows({ ...result.context, events: Array(100).fill(rows[0]) }, 999).rows).toHaveLength(24);
  });
});
