/**
 * alertsLifecycleRoute.test.ts — PATCH /api/alerts pause / resume against an owner-scoped store (E18).
 *
 * The bulk manager (components/alerts/AlertBulkManager.tsx) adds no endpoint: it sends one
 * `PATCH {id, action}` per captured row to the existing owner. These tests drive that owner against
 * an in-memory, two-account `alerts` table that applies every `.eq()` filter the route passes, so
 * the assertions are about what actually lands in the store:
 *
 *   - pause writes `active:false` ONLY — the condition (and any trigger record) is untouched;
 *   - resume, and a PATCH with no action (the existing re-arm), arm the row and strip `triggered`;
 *   - an action the owner does not know is a 400 before the store is read or written;
 *   - another account's id is a 404 and the other account's row is unchanged (AC-E18-04);
 *   - a read the store did not answer is a 503, never a 404 "not found" for a row that may exist;
 *   - each reply, fed through the manager's own classifier, reads as the owner meant it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyReply } from "@/lib/alertBulk";

type Row = { id: string; user_id: string; symbol: string; active: boolean; condition: Record<string, unknown>; created_at: string };

const H = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  table: [] as Row[],
  reads: 0,
  writes: [] as Array<Record<string, unknown>>,
  failUpdate: false,
  failRead: false,
}));

vi.mock("@/lib/entitlement", () => ({
  isPaidTier: vi.fn(async () => true),
  isProTier: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from: vi.fn(() => {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const match = () => H.table.filter((r) => filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v));
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.update = vi.fn((p: Record<string, unknown>) => { patch = p; return q; });
      q.eq = vi.fn((col: string, val: unknown) => { filters.push([col, val]); return q; });
      q.or = vi.fn((expression: string) => {
        expect(expression).toBe("condition->>type.is.null,condition->>type.neq.forex_price_close");
        return q; // Every row in this legacy fixture has a non-Forex condition.
      });
      q.single = vi.fn(async () => {
        if (!patch) {
          H.reads++;
          if (H.failRead) return { data: null, error: { code: "08006", message: "connection failure" } };
          const [row] = match();
          return row ? { data: structuredClone(row), error: null } : { data: null, error: { code: "PGRST116" } };
        }
        H.writes.push(patch);
        if (H.failUpdate) return { data: null, error: { message: "connection reset" } };
        const hits = match();
        if (hits.length !== 1) return { data: null, error: { code: "PGRST116" } };
        Object.assign(hits[0], structuredClone(patch));
        return { data: structuredClone(hits[0]), error: null };
      });
      return q;
    }),
  })),
}));

import { PATCH } from "@/app/api/alerts/route";

const patch = (body: unknown) =>
  PATCH(new Request("https://x.test/api/alerts", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

const row = (id: string, user_id: string, over: Partial<Row> = {}): Row => ({
  id, user_id, symbol: "NVDA", active: true, condition: { type: "signal", target: "BUY" }, created_at: "2026-10-01T00:00:00Z", ...over,
});
const stored = (id: string) => H.table.find((r) => r.id === id)!;

beforeEach(() => {
  H.user = { id: "user-1" };
  H.table = [
    row("mine-armed", "user-1"),
    row("mine-paused", "user-1", { symbol: "TSLA", active: false, condition: { type: "rsi", value: 30 } }),
    row("mine-fired", "user-1", { symbol: "MSFT", active: false, condition: { type: "regime", triggered: { at: "2026-10-09T14:00:00Z", value: 1 } } }),
    row("theirs", "user-2", { symbol: "AAPL" }),
  ];
  H.reads = 0;
  H.writes = [];
  H.failUpdate = false;
  H.failRead = false;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH action:pause", () => {
  it("disarms an owned row and leaves its condition exactly as it was", async () => {
    const res = await patch({ id: "mine-armed", action: "pause" });
    expect(res.status).toBe(200);
    expect(H.writes).toEqual([{ active: false }]);
    expect(stored("mine-armed")).toMatchObject({ active: false, condition: { type: "signal", target: "BUY" } });
    const body = await res.json();
    expect(classifyReply({ status: res.status, body }, "mine-armed", "pause").kind).toBe("acknowledged");
  });

  it("keeps a trigger record on a fired row — pausing is not re-arming", async () => {
    const res = await patch({ id: "mine-fired", action: "pause" });
    expect(res.status).toBe(200);
    expect(stored("mine-fired").condition.triggered).toEqual({ at: "2026-10-09T14:00:00Z", value: 1 });
    expect(stored("mine-fired").active).toBe(false);
  });
});

describe("PATCH action:resume and the existing re-arm", () => {
  it("arms a paused row", async () => {
    const res = await patch({ id: "mine-paused", action: "resume" });
    expect(res.status).toBe(200);
    expect(stored("mine-paused")).toMatchObject({ active: true, condition: { type: "rsi", value: 30 } });
    expect(classifyReply({ status: 200, body: await res.json() }, "mine-paused", "resume").kind).toBe("acknowledged");
  });

  it("re-arms a fired row and clears its trigger record", async () => {
    const res = await patch({ id: "mine-fired", action: "resume" });
    expect(res.status).toBe(200);
    expect(stored("mine-fired").active).toBe(true);
    expect("triggered" in stored("mine-fired").condition).toBe(false);
    expect(classifyReply({ status: 200, body: await res.json() }, "mine-fired", "resume").kind).toBe("acknowledged");
  });

  it("a PATCH with no action is unchanged: the same re-arm as before E18", async () => {
    const res = await patch({ id: "mine-fired" });
    expect(res.status).toBe(200);
    expect(stored("mine-fired")).toMatchObject({ active: true, condition: { type: "regime" } });
    expect("triggered" in stored("mine-fired").condition).toBe(false);
  });
});

describe("PATCH refusals and failures", () => {
  it("401s a signed-out caller before any read — the manager stops the rest of the batch", async () => {
    H.user = null;
    const res = await patch({ id: "mine-armed", action: "pause" });
    expect(res.status).toBe(401);
    expect(H.reads).toBe(0);
    expect(H.writes).toEqual([]);
    expect(classifyReply({ status: 401, body: await res.json() }, "mine-armed", "pause")).toEqual({ kind: "refused", reason: "signed-out" });
  });

  it("rejects an action it does not know before reading or writing anything", async () => {
    for (const action of ["delete", "expire", "PAUSE", 1, null]) {
      const res = await patch({ id: "mine-armed", action });
      expect(res.status).toBe(400);
    }
    expect(H.reads).toBe(0);
    expect(H.writes).toEqual([]);
    expect(stored("mine-armed").active).toBe(true);
  });

  it("an id another account owns is not found and that account's row is untouched (AC-E18-04)", async () => {
    for (const action of ["pause", "resume", undefined]) {
      const res = await patch({ id: "theirs", action });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(classifyReply({ status: 404, body }, "theirs", "pause")).toEqual({ kind: "refused", reason: "not-found" });
    }
    expect(H.writes).toEqual([]);
    expect(stored("theirs")).toMatchObject({ user_id: "user-2", active: true });
  });

  it("a failed update is a 400 the manager reads as NOT confirmed, never as refused or paused", async () => {
    H.failUpdate = true;
    const res = await patch({ id: "mine-armed", action: "pause" });
    expect(res.status).toBe(400);
    expect(classifyReply({ status: 400, body: await res.json() }, "mine-armed", "pause")).toEqual({ kind: "unknown" });
  });

  it("a read the store did not answer is a 503 with nothing written — not a 404 for a row that exists", async () => {
    H.failRead = true;
    const res = await patch({ id: "mine-armed", action: "pause" });
    expect(res.status).toBe(503);
    expect(H.writes).toEqual([]);
    expect(stored("mine-armed").active).toBe(true);
    // The manager does not report it as refused ("not found") or as paused: it is not confirmed.
    expect(classifyReply({ status: 503, body: await res.json() }, "mine-armed", "pause")).toEqual({ kind: "unknown" });
  });
});


describe("frozen-node public lifecycle remains unavailable", () => {
  it.each([true, false])("refuses explicit and default resume without writes (active=%s)", async active => {
    H.table.push(row("forged-frozen", "user-1", {
      active, condition: { type: "opt_frozen_node_proximity", root: "SPY", _fnp: { inside: false }, rights: { allowed: true } },
    }));
    const before = structuredClone(stored("forged-frozen"));
    for (const action of ["resume", undefined]) {
      const res = await patch({ id: "forged-frozen", action });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("Frozen options alerts are not available yet.");
      expect(stored("forged-frozen")).toEqual(before);
    }
    expect(H.writes).toEqual([]);
  });

  it("still permits an owner to pause the unavailable type", async () => {
    H.table.push(row("forged-frozen", "user-1", { condition: { type: "opt_frozen_node_proximity" } }));
    expect((await patch({ id: "forged-frozen", action: "pause" })).status).toBe(200);
    expect(stored("forged-frozen").active).toBe(false);
    expect(H.writes).toEqual([{ active: false }]);
  });
});
