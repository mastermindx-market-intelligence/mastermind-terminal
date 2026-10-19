import { describe, it, expect } from "vitest";
import { planHeldMaterialEvents, heldPublicSourceAsof } from "../../../ingest/heldMaterialEvents";
import type { EventWorkspace } from "../eventWorkspace";
const now = Date.parse("2026-10-18T12:00:00Z");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const position = (userId = owner) => ({ userId, ticker: "TOL", status: "open" as const, rowCount: 2, firstHeldAt: "2026-10-01T00:00:00Z" });
const event = (over: Partial<EventWorkspace> = {}): EventWorkspace => ({
  event_id: "evt_cik0000794170_2026q3_results", authority: "context_only", generation_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  lifecycle: { state: "complete", observed_at: "2026-10-18T10:00:00Z", source_available_at: "2026-10-18T09:00:00Z" },
  issuer: { company_id: "cik:0000794170", listings: [{ ticker: "TOL", is_primary: true, valid_from: "1970-01-01", valid_to: null }] },
  completeness: { filing: { status: "present" }, release: { status: "present" } }, ...over,
} as EventWorkspace);
describe("private held-position event planning", () => {
  it("isolates two owners with stable replay identity and no position details", () => {
    const a = planHeldMaterialEvents([position(), position(other)], [event()], now);
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0].alert_id).toBeNull();
    expect(a.rows[0].fire_event_id).not.toBe(a.rows[1].fire_event_id);
    expect(a.rows[0].payload.authority).toBe("notification_only");
    expect(JSON.stringify(a)).not.toMatch(/shares|price|notes|rowCount/);
    expect(planHeldMaterialEvents([position()], [event({ generation_id: "bbbbbbbbbbbbbbbbbbbbbbbb" })], now).rows[0].fire_event_id).toBe(a.rows[0].fire_event_id);
  });
  it("global source clocks do not depend on private membership", () => {
    const rows = [event(), event({ lifecycle: { state: "complete", observed_at: "2026-10-17T10:00:00Z", source_available_at: "2026-10-17T09:00:00Z" } })];
    expect(heldPublicSourceAsof(rows)).toBe("2026-10-17T09:00:00.000Z");
    planHeldMaterialEvents([], rows, now);
    expect(heldPublicSourceAsof(rows)).toBe("2026-10-17T09:00:00.000Z");
  });
  it("append-identifies a corrected native revision", () => {
    const original = planHeldMaterialEvents([position()], [event()], now).rows[0];
    const correction = event({ lifecycle: { state: "corrected", observed_at: "2026-10-18T11:00:00Z", source_available_at: "2026-10-18T10:30:00Z" } });
    expect(planHeldMaterialEvents([position()], [correction], now).rows[0].fire_event_id).not.toBe(original.fire_event_id);
  });
  it("old native clocks stay stale despite republication; closed and pre-holding reports never fire", () => {
    expect(planHeldMaterialEvents([position()], [event({ lifecycle: { state: "complete", observed_at: "2026-08-18T10:00:00Z", source_available_at: "2026-08-18T09:00:00Z" } })], now)).toMatchObject({ rows: [], unevaluable: 1 });
    expect(planHeldMaterialEvents([{ ...position(), status: "closed" }], [event()], now).rows).toEqual([]);
    expect(planHeldMaterialEvents([{ ...position(), firstHeldAt: "2026-10-18T11:00:00Z" }], [event()], now).rows).toEqual([]);
  });
  it("unknown/future clocks, absent filings and uncovered tickers are unevaluable", () => {
    for (const e of [event({ lifecycle: { state: "complete", observed_at: null, source_available_at: null } }), event({ lifecycle: { state: "complete", observed_at: "2026-10-19T12:00:00Z", source_available_at: "2026-10-19T11:00:00Z" } }), event({ completeness: { filing: { status: "absent" } } as EventWorkspace["completeness"] })]) {
      expect(planHeldMaterialEvents([position()], [e], now)).toMatchObject({ rows: [], unevaluable: 1 });
    }
    expect(planHeldMaterialEvents([{ ...position(), ticker: "UNKNOWN" }], [event()], now)).toMatchObject({ rows: [], unevaluable: 1 });
  });
});
