/**
 * alertsRouteAuthority.test.ts — /api/alerts tells the truth about the STORE (B2 + B3).
 *
 * Both bugs were the same mistake at the same boundary: the Supabase result was destructured
 * without its `error`, so a failed statement was reported to the client as a success.
 *
 *   GET     `const { data } = await select(...)`  → a failed read answered 200 {alerts: []},
 *           and the view rendered "No alerts yet" — an empty-inventory claim off a query that
 *           never ran.
 *   DELETE  `.delete()` with the result discarded  → `{ok:true}` unconditionally, so an RLS
 *           refusal or a dropped connection looked deleted until the row reappeared.
 *
 * These tests inject the failure at the store (the query resolves `{data:null, error:{...}}`,
 * which is exactly what supabase-js does) and assert the wire contract.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreResult = { data: unknown; error: unknown };

const H = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  selectResult: { data: [] as unknown[], error: null } as StoreResult,
  deleteResult: { data: [] as unknown[], error: null } as StoreResult,
  deleteFilters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/entitlement", () => ({
  isPaidTier: vi.fn(async () => true),
  isProTier: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from: vi.fn(() => {
      let mode: "select" | "delete" = "select";
      const q: Record<string, unknown> = {};
      // The read chain resolves at .order(); the delete chain resolves at .select("id").
      q.select = vi.fn(() => (mode === "delete" ? Promise.resolve(H.deleteResult) : q));
      q.delete = vi.fn(() => { mode = "delete"; return q; });
      q.eq = vi.fn((col: string, val: unknown) => {
        if (mode === "delete") H.deleteFilters.push([col, val]);
        return q;
      });
      q.order = vi.fn(async () => H.selectResult);
      return q;
    }),
  })),
}));

import { GET, DELETE } from "@/app/api/alerts/route";

const del = (query: string) =>
  DELETE(new Request(`https://x.test/api/alerts${query}`, { method: "DELETE" }));

beforeEach(() => {
  H.user = { id: "user-1" };
  H.selectResult = { data: [], error: null };
  H.deleteResult = { data: [], error: null };
  H.deleteFilters = [];
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/alerts — four distinct facts, never one wearing another's clothes", () => {
  it("401s when there is no session (signed out ≠ empty)", async () => {
    H.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("200s with an empty list when the read SUCCEEDS and the user has no alerts", async () => {
    H.selectResult = { data: [], error: null };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alerts: [] });
  });

  it("200s with the rows when the read succeeds", async () => {
    H.selectResult = { data: [{ id: "a1", symbol: "NVDA", condition: { type: "signal", target: "BUY" } }], error: null };
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).alerts).toHaveLength(1);
  });

  it("503s — NOT 200 {alerts:[]} — when the store fails to answer", async () => {
    H.selectResult = { data: null, error: { message: "connection terminated unexpectedly", code: "57P01" } };
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.alerts).toBeUndefined();      // nothing a client could mistake for an inventory
  });

  it("503s on an RLS refusal too — a policy error is not an empty book", async () => {
    H.selectResult = { data: null, error: { message: "permission denied for table alerts", code: "42501" } };
    expect((await GET()).status).toBe(503);
  });

  it("still 503s when the driver reports an error ALONGSIDE an empty data array", async () => {
    // supabase-js can hand back `data: []` with an error set; trusting `data` alone is the bug.
    H.selectResult = { data: [], error: { message: "statement timeout", code: "57014" } };
    expect((await GET()).status).toBe(503);
  });
});

describe("DELETE /api/alerts — success only when the store says so", () => {
  it("401s when there is no session", async () => {
    H.user = null;
    expect((await del("?id=a1")).status).toBe(401);
  });

  it("400s when no id is named — a caller bug, not a silent no-op success", async () => {
    expect((await del("")).status).toBe(400);
  });

  it("reports ok+deleted when the store deleted the row", async () => {
    H.deleteResult = { data: [{ id: "a1" }], error: null };
    const res = await del("?id=a1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
  });

  it("scopes the delete to the owner AND the id (RLS is doubled, not trusted alone)", async () => {
    H.deleteResult = { data: [{ id: "a1" }], error: null };
    await del("?id=a1");
    expect(H.deleteFilters).toEqual([["user_id", "user-1"], ["id", "a1"]]);
  });

  it("503s when the store errors — so the optimistic client restores the row", async () => {
    H.deleteResult = { data: null, error: { message: "could not serialize access", code: "40001" } };
    const res = await del("?id=a1");
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBeUndefined();
  });

  it("503s on an RLS refusal rather than reporting a delete that never happened", async () => {
    H.deleteResult = { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
    expect((await del("?id=a1")).status).toBe(503);
  });

  // ── IDEMPOTENCY RULING (documented in the route): matching no row is SUCCESS with
  // deleted:false, not 404. The post-condition the user asked for already holds, and a 404
  // would make the optimistic UI resurrect a row that does not exist.
  it("reports ok+deleted:false when the row was already gone", async () => {
    H.deleteResult = { data: [], error: null };
    const res = await del("?id=already-deleted");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: false });
  });

  it("answers an id belonging to another account exactly as a never-existed id (no existence oracle)", async () => {
    H.deleteResult = { data: [], error: null };     // owner-scoped filter matched nothing
    const foreign = await del("?id=someone-elses-alert");
    H.deleteResult = { data: [], error: null };
    const missing = await del("?id=no-such-alert");
    expect(await foreign.json()).toEqual(await missing.json());
    expect(foreign.status).toBe(missing.status);
  });
});
