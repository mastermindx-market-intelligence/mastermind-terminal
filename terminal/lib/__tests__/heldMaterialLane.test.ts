import { describe, it, expect } from "vitest";
import { runSuiteAlertsLane } from "../../../ingest/suite_alerts";
import type { EventWorkspace } from "../eventWorkspace";
const owners = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const now = Date.parse("2026-10-18T12:00:00Z");
const events = [{ event_id: "evt_cik0000794170_2026q3_results", authority: "context_only", generation_id: "aaaaaaaaaaaaaaaaaaaaaaaa", lifecycle: { state: "complete", observed_at: "2026-10-18T10:00:00Z", source_available_at: "2026-10-18T09:00:00Z" }, issuer: { company_id: "cik:0000794170", listings: [{ ticker: "TOL", is_primary: true, valid_from: "1970-01-01", valid_to: null }] }, completeness: { filing: { status: "bound", filing_key: { cik: "0000794170", accession: "0000794170-26-000001" } }, release: { status: "present" } } }] as EventWorkspace[];
const book = owners.flatMap((user_id) => [1, 2].map(() => ({ user_id, ticker: "TOL", status: "open", created_at: "2026-10-01T00:00:00Z", notes: "private note", shares: 99 })));
function harness(options: { status?: number; duplicate?: boolean; sourceError?: boolean; bookError?: boolean; receiptError?: boolean; rows?: unknown[]; sourceEvents?: EventWorkspace[]; history?: unknown[] } = {}) {
  const calls: { url: string; method: string; body: any }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    let status = 200, result: unknown = [];
    if (url.includes("/portfolio_positions?")) { status = options.bookError ? 503 : 200; result = options.rows ?? book; }
    else if (url.includes("/alert_runs") && method === "POST") { status = options.receiptError ? 503 : 201; result = {}; }
    else if (url.includes("/alert_runs") && method === "PATCH") result = {};
    else if (url.includes("/alert_outbox?") && method === "GET") result = options.history ?? [];
    else if (url.includes("/alert_outbox?")) { status = options.status ?? 201; result = options.duplicate ? [] : [body]; }
    return new Response(JSON.stringify(result), { status });
  };
  const run = (argv = ["--held-material-events"]) => runSuiteAlertsLane({ argv, envOverride: { url: "https://private.invalid", key: "test" }, hooks: { fetchImpl, now: () => now, loadHeldEvents: async () => { if (options.sourceError) throw Error("secret owner/URL"); return options.sourceEvents ?? events; } } });
  return { calls, run };
}
describe("held-company path in the incumbent Node evaluator", () => {
  it("is default off; performs no book or outbox IO", async () => {
    const h = harness(); await h.run([]);
    expect(h.calls.some(c => /portfolio_positions|alert_outbox/.test(c.url))).toBe(false);
  });
  it("folds duplicate lots, isolates owners and writes one existing outbox row per owner with no alert writes", async () => {
    const h = harness(); const result = await h.run();
    const out = h.calls.filter(c => c.url.includes("alert_outbox"));
    expect(out).toHaveLength(2); expect(new Set(out.map(c => c.body.fire_event_id)).size).toBe(2);
    expect(out.map(c => c.body.user_id).sort()).toEqual(owners);
    expect(out.every(c => c.body.payload.category === "holdings_material_change" && c.body.payload.requires_tier === "essential")).toBe(true);
    expect(out.every(c => c.body.alert_id === null && c.url.endsWith("on_conflict=fire_event_id"))).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/private note|shares|notes/);
    expect(h.calls.filter(c => c.method !== "GET" && /\/alerts\?/.test(c.url))).toEqual([]);
    expect(result).toMatchObject({ outcome: "success", fired: 2, evaluatedN: 2 });
    expect(h.calls.at(-1)?.body).toMatchObject({ source_asof: "2026-10-18T09:00:00.000Z", fired_n: null, evaluated_n: null, unevaluable_n: null });
  });
  it("shared receipts redact private counts and use a public clock unrelated to held membership", async () => {
    const unheld = { ...events[0], event_id: "evt_cik0000320193_2026q3_results", issuer: { ...events[0].issuer, listings: [{ ...events[0].issuer.listings[0], ticker: "AAPL" }] }, lifecycle: { ...events[0].lifecycle, source_available_at: "2026-10-17T09:00:00Z" } };
    const h = harness({ sourceEvents: [...events, unheld] }); await h.run();
    expect(h.calls.at(-1)?.body).toMatchObject({ evaluated_n: null, fired_n: null, unevaluable_n: null, source_asof: "2026-10-17T09:00:00.000Z" });
  });
  it("corrections link only the same owner's previous native event receipt, without mutating it", async () => {
    const correction = { ...events[0], lifecycle: { ...events[0].lifecycle, state: "corrected" as const } };
    const prior = { user_id: owners[0], fire_event_id: "held:" + "a".repeat(64), payload: { source: "terminal.held_material_event.v1", event_id: events[0].event_id, event_time: "2026-10-18T09:30:00.000Z" } };
    const h = harness({ sourceEvents: [correction], rows: [book[0]], history: [prior] }); await h.run();
    const read = h.calls.find(c => c.url.includes("alert_outbox") && c.method === "GET")!;
    expect(new URL(read.url).searchParams.get("user_id")).toBe(`eq.${owners[0]}`);
    const write = h.calls.find(c => c.url.includes("alert_outbox") && c.method === "POST")!;
    expect(write.body.payload.corrects).toEqual({ lane: "suite_alerts", id: prior.fire_event_id });
    expect(h.calls.some(c => c.url.includes("alert_outbox") && c.method === "PATCH")).toBe(false);
  });
  it("a conflicting correction-history owner is unevaluable and creates no row", async () => {
    const correction = { ...events[0], lifecycle: { ...events[0].lifecycle, state: "corrected" as const } };
    const h = harness({ sourceEvents: [correction], rows: [book[0]], history: [{ user_id: owners[1], fire_event_id: "held:" + "a".repeat(64), payload: { source: "terminal.held_material_event.v1", event_id: events[0].event_id, event_time: "2026-10-18T09:30:00.000Z" } }] });
    expect(await h.run()).toMatchObject({ outcome: "partial", fired: 0 });
    expect(h.calls.some(c => c.url.includes("alert_outbox") && c.method === "POST")).toBe(false);
  });
  it("replay is a no-op only on confirmed empty conflict representation", async () => {
    const h = harness({ duplicate: true }); expect(await h.run()).toMatchObject({ fired: 0, outcome: "success" });
  });
  it.each([400, 401, 409, 500, 503])("HTTP %i is unevaluable, never a false duplicate", async status => {
    const h = harness({ status }); expect(await h.run()).toMatchObject({ fired: 0, outcome: "partial", unevaluableN: 2 });
    expect(h.calls.at(-1)?.body.error_class).toBe("held_outbox_write_failed");
  });
  it.each([{ sourceError: true }, { bookError: true }, { receiptError: true }])("failures cannot produce calm zero or an unreceipted write: %j", async options => {
    const h = harness(options); expect(await h.run()).toMatchObject({ fired: 0, outcome: "partial" });
    expect(h.calls.filter(c => c.url.includes("alert_outbox"))).toEqual([]);
  });
  it("dry run reads but never writes any table", async () => {
    const h = harness(); expect(await h.run(["--held-material-events", "--dry-run"])).toMatchObject({ fired: 2 });
    expect(h.calls.every(c => c.method === "GET")).toBe(true);
  });
  it("known empty book is distinct from an uncovered held ticker", async () => {
    const empty = harness({ rows: [] }); expect(await empty.run()).toMatchObject({ outcome: "success", evaluatedN: 0 });
    const unknown = harness({ rows: [{ ...book[0], ticker: "UNKNOWN" }] }); expect(await unknown.run()).toMatchObject({ outcome: "partial", unevaluableN: 1 });
  });
});
