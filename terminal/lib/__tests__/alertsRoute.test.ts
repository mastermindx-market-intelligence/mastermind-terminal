import { beforeEach, describe, expect, it, vi } from "vitest";

type MockQuery = {
  select: (fields: string, opts?: { head?: boolean }) => MockQuery;
  eq: () => MockQuery | Promise<{ count: number }>;
  order: () => Promise<{ data: Array<Record<string, unknown>> }>;
  insert: (row: Record<string, unknown>) => MockQuery;
  single: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
};

const H = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  inserted: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/entitlement", () => ({
  isPaidTier: vi.fn(async () => true),
  isProTier: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn(() => {
      let mode: "list" | "count" | "insert" = "list";
      const q = {} as MockQuery;
      q.select = vi.fn((_fields: string, opts?: { head?: boolean }) => {
        if (mode !== "insert") mode = opts?.head ? "count" : "list";
        return q;
      });
      q.eq = vi.fn(() => mode === "count" ? Promise.resolve({ count: 0 }) : q);
      q.order = vi.fn(async () => ({ data: H.rows }));
      q.insert = vi.fn((row: Record<string, unknown>) => {
        mode = "insert";
        H.inserted = row;
        return q;
      });
      q.single = vi.fn(async () => ({
        data: mode === "insert" ? { id: "new-alert", active: true, ...H.inserted } : null,
        error: null,
      }));
      return q;
    }),
  })),
}));

import { GET, POST } from "@/app/api/alerts/route";

const post = (body: Record<string, unknown>) => POST(new Request("https://x.test/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

beforeEach(() => {
  H.rows = [];
  H.inserted = null;
  vi.clearAllMocks();
});

describe("/api/alerts options identity", () => {
  it("keeps the preparatory frozen-node core outside enrollment despite client-authored grants", async () => {
    const res = await post({
      symbol: "SPY",
      condition: {
        type: "opt_frozen_node_proximity", root: "SPY",
        target: { price: 620 },
        admission: { rights: { allowed: true }, principal: "user-1" },
        rights: { allowed: true },
        armingEpoch: "2026-10-20T14:00:00Z",
        _fnp: { inside: false, lastQuoteAt: "2026-10-20T14:01:00Z" },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown alert condition: opt_frozen_node_proximity" });
    expect(H.inserted).toBeNull();
  });

  it("persists one validated root in both symbol and condition when client fields conflict", async () => {
    const res = await post({
      symbol: "SPY",
      condition: { type: "opt_gamma_flip", root: " qqq ", band_pct: 0.1 },
    });
    expect(res.status).toBe(200);
    expect(H.inserted).toEqual({
      user_id: "user-1",
      symbol: "QQQ",
      condition: { type: "opt_gamma_flip", root: "QQQ", band_pct: 0.1 },
    });
    expect((await res.json()).alert).toMatchObject({
      symbol: "QQQ",
      condition: { type: "opt_gamma_flip", root: "QQQ" },
    });
  });

  it("rejects an invalid evaluator root instead of storing a split identity", async () => {
    const res = await post({
      symbol: "SPY",
      condition: { type: "opt_wall_touch", root: "../../QQQ", wall: "call" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid options root" });
    expect(H.inserted).toBeNull();
  });

  it("normalizes legacy tracked-tape and split-root rows on GET without altering other alerts", async () => {
    H.rows = [
      { id: "legacy-tape", symbol: "SPY", condition: { type: "opt_premium_burst", root: "QQQ", leg: "ncp" } },
      { id: "split-root", symbol: "SPY", condition: { type: "opt_gamma_flip", root: "QQQ" } },
      { id: "price", symbol: "SPY", condition: { type: "price", op: "above", value: 800 } },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const { alerts } = await res.json();
    expect(alerts[0]).toMatchObject({ symbol: "MARKET", condition: { root: "MARKET" } });
    expect(alerts[1]).toMatchObject({ symbol: "QQQ", condition: { root: "QQQ" } });
    expect(alerts[2]).toEqual(H.rows[2]);
  });
});
