/**
 * adminSearchesAuthority.test.ts — /admin tells the truth about AUTHORITY, EVENTS and STATS (F-1).
 *
 * Three independent facts used to collapse into one boolean and one 404:
 *
 *   adminGate   `const { data } = await select("is_admin")`  → a failed profiles read became
 *               `admin: false`, so a Supabase blip told the owner their console did not exist.
 *   list        `if (error) return []`                        → an outage rendered as
 *               "No searches logged yet." over an unread table.
 *   stats       error logged, zeros returned                  → a confident `0` in "Total
 *               searches", and the count query's error was never even destructured.
 *
 * Nothing here mocks the gate or the reader: both run for real, and the fault is injected at the
 * store exactly as supabase-js reports it (`{data:null, error:{...}}`, a thrown transport, a 5xx
 * from GoTrue). What is asserted is the wire contract the client depends on to tell the three
 * states apart.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreResult = { data: unknown; error: unknown };

const H = vi.hoisted(() => ({
  // auth.getUser() — the cookie-authenticated session behind the gate
  user: { id: "user-1", email: "owner@example.com" } as { id: string; email?: string } | null,
  userError: null as { name?: string; status?: number; message?: string } | null,
  // profiles.is_admin
  profileResult: { data: { is_admin: true }, error: null } as StoreResult,
  // search_events reads, via the SERVICE client
  listResult: { data: [] as unknown[], error: null } as StoreResult,
  countResult: { count: 0, error: null } as { count: number | null; error: unknown },
  windowResult: { data: [] as unknown[], error: null } as StoreResult,
  serviceAvailable: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: H.user },
        error: H.userError,
      })),
    },
    from: vi.fn(() => {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.single = vi.fn(async () => H.profileResult);
      return q;
    }),
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => {
    if (!H.serviceAvailable) return null;
    return {
      // These cases exercise the CAPPED in-process aggregate path, so the stub answers the exact
      // aggregate RPC as "not applied yet" (PGRST202) — which is also the real production state
      // until an operator applies 0010. The RPC's own behaviour is covered in searchStatsExact.
      rpc: vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })),
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        let isWindow = false;
        chain.select = vi.fn((_cols?: string, opts?: { head?: boolean }) =>
          // `select("*", {count:"exact", head:true})` is the stats COUNT query and resolves on
          // its own; every other select continues the chain.
          opts?.head ? { then: (r: (v: unknown) => unknown) => Promise.resolve(H.countResult).then(r) } : chain,
        );
        // `.gte()` appears only in the 14-day stats window query — it is the discriminator.
        chain.gte = vi.fn(() => { isWindow = true; return chain; });
        for (const m of ["order", "limit", "lt", "eq", "or"]) chain[m] = vi.fn(() => chain);
        chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(isWindow ? H.windowResult : H.listResult).then(res, rej);
        return chain;
      }),
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } },
    };
  }),
}));

import { GET } from "@/app/api/admin/searches/route";
import { isAdminRequest } from "@/lib/adminGate";

const get = (query = "") => GET(new Request(`https://x.test/api/admin/searches${query}`));

const row = (id: number) => ({
  id, created_at: new Date().toISOString(), symbol: "NVDA", query: null,
  source: "test", user_id: null, anon_id: null, ip: null, ua: null,
});

beforeEach(() => {
  H.user = { id: "user-1", email: "owner@example.com" };
  H.userError = null;
  H.profileResult = { data: { is_admin: true }, error: null };
  H.listResult = { data: [], error: null };
  H.countResult = { count: 0, error: null };
  H.windowResult = { data: [], error: null };
  H.serviceAvailable = true;
  delete process.env.ADMIN_EMAILS;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("adminGate — 'not an admin' and 'could not check' are different answers", () => {
  it("admin when profiles.is_admin is true", async () => {
    expect(await isAdminRequest()).toMatchObject({ status: "admin" });
  });

  it("denied when the row says false — the authority spoke", async () => {
    H.profileResult = { data: { is_admin: false }, error: null };
    expect(await isAdminRequest()).toMatchObject({ status: "denied" });
  });

  it("denied when there is no profile row at all (PGRST116 is a real answer)", async () => {
    H.profileResult = { data: null, error: { code: "PGRST116", message: "no rows" } };
    expect(await isAdminRequest()).toMatchObject({ status: "denied" });
  });

  it("UNAVAILABLE — not denied — when the profiles read fails", async () => {
    H.profileResult = { data: null, error: { code: "57P01", message: "connection terminated" } };
    expect(await isAdminRequest()).toMatchObject({ status: "unavailable" });
  });

  it("anonymous when there is genuinely no session", async () => {
    H.user = null;
    H.userError = { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" };
    expect(await isAdminRequest()).toMatchObject({ status: "anonymous" });
  });

  it("UNAVAILABLE when GoTrue itself is down — a 5xx is not a logged-out user", async () => {
    // The old code read `data:{user}` only, so this looked exactly like signing out, and the page
    // redirected a signed-in admin to /login to re-authenticate against a broken auth server.
    H.user = null;
    H.userError = { name: "AuthRetryableFetchError", status: 503, message: "service unavailable" };
    expect(await isAdminRequest()).toMatchObject({ status: "unavailable" });
  });

  it("an ADMIN_EMAILS owner is admitted without touching profiles at all", async () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    H.profileResult = { data: null, error: { code: "57P01", message: "connection terminated" } };
    expect(await isAdminRequest()).toMatchObject({ status: "admin" });
  });
});

describe("GET /api/admin/searches — the status code carries the state", () => {
  it("404s for a definitively-not-admin caller (existence stays unadvertised)", async () => {
    H.profileResult = { data: { is_admin: false }, error: null };
    const res = await get();
    expect(res.status).toBe(404);
  });

  it("404s for a logged-out caller, identically", async () => {
    H.user = null;
    H.userError = { name: "AuthSessionMissingError", status: 400 };
    expect((await get()).status).toBe(404);
  });

  it("503s — NOT 404 — when the authority could not be checked", async () => {
    H.profileResult = { data: null, error: { code: "57P01", message: "connection terminated" } };
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("authority_unavailable");
  });

  it("200s with rows when the read succeeds", async () => {
    H.listResult = { data: [row(2), row(1)], error: null };
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).events).toHaveLength(2);
  });

  it("200s with an empty array when the store genuinely holds nothing", async () => {
    H.listResult = { data: [], error: null };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ events: [] });
  });

  it("503s — NOT 200 {events:[]} — when the events read fails", async () => {
    H.listResult = { data: null, error: { code: "57014", message: "statement timeout" } };
    const res = await get();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("events_unavailable");
    expect(body.events).toBeUndefined();   // nothing a client could mistake for an inventory
  });

  it("still 503s when the driver reports an error ALONGSIDE an empty data array", async () => {
    // supabase-js can hand back `data: []` with `error` set; trusting `data` alone is the bug.
    H.listResult = { data: [], error: { code: "42501", message: "permission denied" } };
    expect((await get()).status).toBe(503);
  });
});

describe("events and stats are separate facts", () => {
  it("keeps the log usable and marks ONLY the KPIs when the aggregate fails", async () => {
    H.listResult = { data: [row(1)], error: null };
    H.windowResult = { data: null, error: { code: "57014", message: "statement timeout" } };
    const res = await get("?stats=1");
    expect(res.status).toBe(200);                 // the log still renders
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.stats).toBeUndefined();           // no fabricated zeros
    expect(body.statsUnavailable).toBe(true);     // and the client is told why
  });

  it("treats a failed COUNT as unavailable too — it used to render as a confident 0", async () => {
    // The count error was never destructured: `const [{ count }, ...]` dropped it on the floor,
    // and `count ?? 0` turned an unread table into "Total searches: 0".
    H.listResult = { data: [row(1)], error: null };
    H.countResult = { count: null, error: { code: "57014", message: "statement timeout" } };
    const body = await (await get("?stats=1")).json();
    expect(body.stats).toBeUndefined();
    expect(body.statsUnavailable).toBe(true);
  });

  it("returns real aggregates when both stats queries succeed", async () => {
    H.listResult = { data: [row(1)], error: null };
    H.countResult = { count: 42, error: null };
    H.windowResult = { data: [{ created_at: new Date().toISOString(), symbol: "NVDA", user_id: null, anon_id: "a1", ip: null }], error: null };
    const body = await (await get("?stats=1")).json();
    expect(body.statsUnavailable).toBeUndefined();
    expect(body.stats.total).toBe(42);
    expect(body.stats.visitors7d).toBe(1);
    expect(body.stats.perDay14d).toHaveLength(14);
  });

  it("omits stats entirely when the caller did not ask for them (cursor pages)", async () => {
    H.listResult = { data: [row(1)], error: null };
    const body = await (await get("?before=5")).json();
    expect(body.stats).toBeUndefined();
    expect(body.statsUnavailable).toBeUndefined();  // not asked ≠ unavailable
  });
});
