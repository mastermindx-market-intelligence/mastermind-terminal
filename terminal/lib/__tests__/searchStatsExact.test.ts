/**
 * searchStatsExact.test.ts — exact aggregates, a bounded email cache, and both deploy orders (F-2).
 *
 * Two latent bugs, one theme: a value that was allowed to go stale or wrong without saying so.
 *
 *   STATS_FETCH_CAP  the 14-day window was fetched `order by id desc` under a 20,000-row cap, so
 *                    past that size the newest 20k survived and the OLDEST days of perDay14d decayed
 *                    toward zero. The chart drew a clean ramp that never happened, and the payload
 *                    carried no hint. Raising the cap only moves where it starts lying.
 *   emailCache       a process-lifetime `Map` with no TTL and no ceiling, justified by "emails are
 *                    effectively immutable". They are not — the Terminal supports changing one — and
 *                    `next start` is a single process that lives for weeks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { created_at: string; symbol: string; user_id: string | null; anon_id: string | null; ip: string | null };

const H = vi.hoisted(() => ({
  rpcResult: { data: null as unknown, error: null as { code?: string; message?: string } | null },
  countResult: { count: 0 as number | null, error: null as unknown },
  windowRows: [] as Row[],
  windowError: null as unknown,
  getUserById: (_id: string): Promise<{ data: { user: { email?: string | null } | null } | null; error?: unknown }> =>
    Promise.resolve({ data: { user: { email: "unset@example.com" } } }),
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    rpc: vi.fn(async (name: string) => { H.calls.push(`rpc:${name}`); return H.rpcResult; }),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      let isWindow = false;
      chain.select = vi.fn((_c?: string, opts?: { head?: boolean }) =>
        opts?.head
          ? { then: (r: (v: unknown) => unknown) => Promise.resolve(H.countResult).then(r) }
          : chain);
      chain.gte = vi.fn(() => { isWindow = true; return chain; });
      for (const m of ["order", "limit", "lt", "eq", "or"]) chain[m] = vi.fn(() => chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(isWindow ? { data: H.windowRows, error: H.windowError } : { data: [], error: null }).then(res, rej);
      return chain;
    }),
    auth: { admin: { getUserById: vi.fn((id: string) => { H.calls.push(`gotrue:${id}`); return H.getUserById(id); }) } },
  })),
}));

import { __emailCacheSize, __resetEmailCache, resolveUserEmails, searchStats } from "@/lib/searchEvents";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const row = (over: Partial<Row> = {}): Row =>
  ({ created_at: iso(1000), symbol: "NVDA", user_id: null, anon_id: "a1", ip: null, ...over });

const unwrap = (r: Awaited<ReturnType<typeof searchStats>>) => {
  if (!r.ok) throw new Error(`expected ok stats, got ${r.error}`);
  return r.stats;
};

beforeEach(() => {
  H.rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  H.countResult = { count: 0, error: null };
  H.windowRows = [];
  H.windowError = null;
  H.getUserById = async () => ({ data: { user: { email: "old@example.com" } } });
  H.calls = [];
  __resetEmailCache();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("exact aggregates come from the database when the function exists", () => {
  it("uses the RPC result verbatim and marks it exact", async () => {
    H.rpcResult = {
      data: {
        total: 1_000_000, today: 42, visitors7d: 9,
        topSymbols7d: [{ symbol: "NVDA", count: 5 }],
        perDay14d: Array.from({ length: 14 }, (_, i) => ({ day: `2026-08-${String(i + 8).padStart(2, "0")}`, count: i })),
      },
      error: null,
    };
    const s = unwrap(await searchStats());
    expect(s.total).toBe(1_000_000);      // far past the old cap, and exact
    expect(s.partial).toBe(false);
    expect(s.perDay14d).toHaveLength(14);
    expect(H.calls).toContain("rpc:search_event_stats");
    // No capped window fetch at all when the RPC answers.
    expect(H.calls.filter((c) => c.startsWith("rpc:"))).toHaveLength(1);
  });

  it("a REAL rpc failure is a store failure, not a silent downgrade to the capped path", async () => {
    H.rpcResult = { data: null, error: { code: "57014", message: "statement timeout" } };
    const r = await searchStats();
    expect(r.ok).toBe(false);
  });
});

describe("deploy order: the app works before the migration is applied", () => {
  it("falls back when the function is missing (PGRST202) instead of erroring", async () => {
    H.countResult = { count: 5, error: null };
    H.windowRows = [row(), row({ symbol: "AAPL" })];
    const s = unwrap(await searchStats());
    expect(s.total).toBe(5);
    expect(s.topSymbols7d.map((x) => x.symbol).sort()).toEqual(["AAPL", "NVDA"]);
  });

  it("a fallback BELOW the cap is exact — it must not cry approximate when it is right", async () => {
    H.countResult = { count: 3, error: null };
    H.windowRows = [row(), row(), row()];
    expect(unwrap(await searchStats()).partial).toBe(false);
  });

  it("MANDATORY >20k acceptance: at the cap the payload admits it is understated", async () => {
    // 20,000 rows is exactly what the fetch returns when the real window is larger — the DB gave us
    // the newest 20k and silently dropped the rest. This is the case that used to draw a fake ramp.
    const day = 86_400_000;
    H.countResult = { count: 250_000, error: null };
    H.windowRows = Array.from({ length: 20_000 }, (_, i) =>
      row({ created_at: iso(Math.floor((i / 20_000) * 2 * day)), symbol: `S${i % 7}`, anon_id: `v${i % 500}` }),
    );
    const s = unwrap(await searchStats());
    expect(s.partial).toBe(true);
    // The truncation is real and visible: 20k newest rows all landed in the last ~2 days, so the
    // older buckets read zero even though the true window holds 250k rows.
    const oldest = s.perDay14d.slice(0, 10).reduce((a, b) => a + b.count, 0);
    expect(oldest).toBe(0);
    expect(s.total).toBe(250_000);   // total is a real COUNT and stays right
  });

  it("does not claim exactness anywhere in the fallback payload", async () => {
    H.countResult = { count: 999_999, error: null };
    H.windowRows = Array.from({ length: 20_000 }, () => row());
    const s = unwrap(await searchStats());
    expect(s.partial).toBe(true);
  });
});

describe("email cache is bounded and expires", () => {
  const ID = "11111111-1111-1111-1111-111111111111";

  it("caches within the TTL, then re-reads the authority after it — an email CAN change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    H.getUserById = async () => ({ data: { user: { email: "old@example.com" } } });
    expect(await resolveUserEmails([ID])).toEqual({ [ID]: "old@example.com" });

    // Authority changes underneath. Within the TTL the cached answer is still served.
    H.getUserById = async () => ({ data: { user: { email: "new@example.com" } } });
    vi.setSystemTime(1_000_000_000_000 + 60_000);
    expect(await resolveUserEmails([ID])).toEqual({ [ID]: "old@example.com" });

    // Past the TTL the new address surfaces without a restart. The old cache never did this.
    vi.setSystemTime(1_000_000_000_000 + 11 * 60_000);
    expect(await resolveUserEmails([ID])).toEqual({ [ID]: "new@example.com" });
  });

  it("expires a definitive null too, so a later-added email appears", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000_000);
    H.getUserById = async () => ({ data: { user: { email: null } } });
    expect(await resolveUserEmails([ID])).toEqual({});

    H.getUserById = async () => ({ data: { user: { email: "later@example.com" } } });
    vi.setSystemTime(2_000_000_000_000 + 11 * 60_000);
    expect(await resolveUserEmails([ID])).toEqual({ [ID]: "later@example.com" });
  });

  it("never caches a transient failure as 'no email'", async () => {
    let calls = 0;
    H.getUserById = async () => { calls++; throw new Error("ECONNRESET"); };
    expect(await resolveUserEmails([ID])).toEqual({});
    expect(await resolveUserEmails([ID])).toEqual({});
    expect(calls).toBe(2);            // retried — not memoised as a null
    expect(__emailCacheSize()).toBe(0);

    H.getUserById = async () => ({ data: { user: { email: "back@example.com" } } });
    expect(await resolveUserEmails([ID])).toEqual({ [ID]: "back@example.com" });
  });

  it("treats an error RESULT (not a throw) as transient too", async () => {
    H.getUserById = async () => ({ data: null, error: { message: "gotrue 503" } });
    expect(await resolveUserEmails([ID])).toEqual({});
    expect(__emailCacheSize()).toBe(0);
  });

  it("HIGH CARDINALITY: stays bounded across 50,000 distinct user ids", async () => {
    H.getUserById = async (id: string) => ({ data: { user: { email: `${id}@example.com` } } });
    const ids = Array.from({ length: 50_000 }, (_, i) => `user-${i}`);
    // Batched so the mock's Promise.all fan-out stays reasonable, but every id is resolved.
    for (let i = 0; i < ids.length; i += 2_000) await resolveUserEmails(ids.slice(i, i + 2_000));
    expect(__emailCacheSize()).toBeLessThanOrEqual(5_000);
    expect(__emailCacheSize()).toBeGreaterThan(0);
  });

  it("coalesces concurrent lookups for the same id into ONE GoTrue call", async () => {
    let inflight = 0;
    let peak = 0;
    H.getUserById = async () => {
      inflight++; peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return { data: { user: { email: "one@example.com" } } };
    };
    // Three concurrent requests, each carrying a page full of the same user's rows.
    const [a, b, c] = await Promise.all([
      resolveUserEmails([ID, ID, ID]),
      resolveUserEmails([ID]),
      resolveUserEmails([ID]),
    ]);
    expect(a).toEqual({ [ID]: "one@example.com" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(peak).toBe(1);
    expect(H.calls.filter((x) => x === `gotrue:${ID}`)).toHaveLength(1);
  });
});
