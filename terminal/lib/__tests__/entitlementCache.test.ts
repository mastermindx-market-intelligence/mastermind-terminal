import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the short-TTL entitlement cache (lib/entitlement.ts).
//
// The cache exists ONLY to remove duplicate `/api/me` round trips from a single
// page load — a cold /options resolves entitlement seven times. It must not move
// a single authorization outcome. These tests pin both halves:
//
//   AUTHORIZATION (must be identical to the uncached implementation)
//     - unauthed → false, and we never even ask the billing gateway
//     - non-2xx / network error → false (fail-closed) and NOT remembered
//     - a "no" answer is NOT remembered, so an upgrade is visible immediately
//     - one user's cached "yes" can never satisfy another user's gate
//     - the write-path gate (isPaidTier) resolves fresh every call
//
//   LATENCY (the actual win)
//     - a positive answer collapses N sequential gates onto ONE upstream call
//     - concurrent gates collapse onto one in-flight promise
//     - the entry expires, so a revocation lags by at most the TTL
//
// LOCATION NOTE: this file lives in lib/__tests__/ — terminal/vitest.config.ts
// includes ONLY "lib/__tests__/**/*.test.ts" (same constraint documented in
// lib/__tests__/brainProxy.test.ts).
//
// We mock @/lib/supabase/server so the REAL billingAuth() runs (that is the code
// path production takes) and control only which session it sees. React's cache()
// has no dispatcher outside a render, so it degrades to a direct call here —
// which is exactly its behaviour inside a plain route handler, i.e. these tests
// measure the module-level TTL map, the load-bearing half.
// ─────────────────────────────────────────────────────────────────────────────

vi.hoisted(() => {
  process.env.BILLING_GATEWAY_BASE = "https://billing.test";
});

// Controllable session state for the mocked Supabase server client.
const H = vi.hoisted(() => ({
  session: null as null | { access_token: string },
  user: null as null | { id: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: H.session } }),
      getUser: async () => ({ data: { user: H.user } }),
    },
  }),
}));

type Ent = { tier: string; features: string[] };

let meCalls: string[]; // one entry per /api/me request, holding the bearer token
let realFetch: typeof globalThis.fetch;
/** What the fake gateway answers next. `null` = a non-2xx. */
let nextAnswer: (token: string) => Ent | null;

/** Sign in as a given user (token doubles as identity in these tests). */
function signIn(token: string) {
  H.session = { access_token: token };
  H.user = { id: `user-for-${token}` };
}
function signOut() {
  H.session = null;
  H.user = null;
}

/** Fresh module instance — the TTL map is module-level, so each test gets its own. */
async function loadEntitlement() {
  vi.resetModules();
  return import("@/lib/entitlement");
}

beforeEach(() => {
  meCalls = [];
  nextAnswer = () => ({ tier: "pro", features: ["terminal_live_options"] });
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const token = String(headers.Authorization ?? "").replace(/^Bearer /, "");
    meCalls.push(token);
    const body = nextAnswer(token);
    if (!body) return new Response("unauthorized", { status: 401 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  signOut();
});

describe("entitlement — authorization outcomes are unchanged by caching", () => {
  it("unauthed callers are refused without ever asking the billing gateway", async () => {
    const { hasLiveOptions, isPaidTier } = await loadEntitlement();
    signOut();

    expect(await hasLiveOptions()).toBe(false);
    expect(await isPaidTier()).toBe(false);
    expect(meCalls).toEqual([]);
  });

  it("a session without a verified user is refused (getUser is still authoritative)", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    H.session = { access_token: "tok-revoked" };
    H.user = null; // getUser() rejected the JWT

    expect(await hasLiveOptions()).toBe(false);
    expect(meCalls).toEqual([]);
  });

  it("a non-2xx from the authority fails closed and is NOT remembered", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    signIn("tok-a");
    nextAnswer = () => null; // 401

    expect(await hasLiveOptions()).toBe(false);
    expect(await hasLiveOptions()).toBe(false);
    expect(meCalls).toHaveLength(2); // re-asked, never pinned
  });

  it("a network failure fails closed and is NOT remembered", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    signIn("tok-a");
    globalThis.fetch = vi.fn(async () => {
      meCalls.push("boom");
      throw new Error("upstream down");
    }) as unknown as typeof globalThis.fetch;

    expect(await hasLiveOptions()).toBe(false);
    expect(await hasLiveOptions()).toBe(false);
    expect(meCalls).toHaveLength(2);
  });

  it("a NEGATIVE answer is never cached — an upgrade is visible on the very next call", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    signIn("tok-a");
    nextAnswer = () => ({ tier: "free", features: [] });

    expect(await hasLiveOptions()).toBe(false);
    expect(await hasLiveOptions()).toBe(false);
    expect(meCalls).toHaveLength(2);

    // User upgrades mid-session — no TTL to wait out.
    nextAnswer = () => ({ tier: "essential", features: ["terminal_live_options"] });
    expect(await hasLiveOptions()).toBe(true);
  });

  it("one user's cached YES can never satisfy another user's gate", async () => {
    const { hasLiveOptions } = await loadEntitlement();

    signIn("tok-paid");
    nextAnswer = (t) =>
      t === "tok-paid" ? { tier: "pro", features: ["terminal_live_options"] } : { tier: "free", features: [] };
    expect(await hasLiveOptions()).toBe(true);
    expect(meCalls).toHaveLength(1);

    // Different session on the same server process.
    signIn("tok-free");
    expect(await hasLiveOptions()).toBe(false);
    expect(meCalls).toEqual(["tok-paid", "tok-free"]); // own key, own round trip
  });

  it("the private unlimited operator tier carries live-options read access without synthetic feature keys", async () => {
    const { hasLiveOptions } = await loadEntitlement();

    // Macro /api/me can overlay tier=unlimited from the verified operator
    // allowlist while leaving the underlying billing row's features sparse.
    signIn("tok-operator");
    nextAnswer = () => ({ tier: "unlimited", features: [] });
    expect(await hasLiveOptions()).toBe(true);

    // This is intentionally NOT a generic tier bypass: a customer Pro row with
    // the feature removed remains denied by the feature authority.
    signIn("tok-pro-without-feature");
    nextAnswer = () => ({ tier: "pro", features: [] });
    expect(await hasLiveOptions()).toBe(false);

    expect(meCalls).toEqual(["tok-operator", "tok-pro-without-feature"]);
  });

  it("the tier gate still reads tier, not the live-options feature", async () => {
    const { isPaidTier } = await loadEntitlement();
    signIn("tok-a");

    nextAnswer = () => ({ tier: "free", features: ["terminal_live_options"] });
    expect(await isPaidTier()).toBe(false);

    nextAnswer = () => ({ tier: "essential", features: [] });
    expect(await isPaidTier()).toBe(true);

    // The pre-rename name is accepted inbound forever — a gateway or cached payload
    // that still says `insider` must entitle exactly as `essential` does, not fail
    // closed to Free. Alias parity at the server gate.
    nextAnswer = () => ({ tier: "insider", features: [] });
    expect(await isPaidTier()).toBe(true);

    nextAnswer = () => ({ tier: "pro", features: [] });
    expect(await isPaidTier()).toBe(true);
  });

  it("the write-path gate (isPaidTier) resolves fresh on every call", async () => {
    const { isPaidTier } = await loadEntitlement();
    signIn("tok-a");

    expect(await isPaidTier()).toBe(true);
    expect(await isPaidTier()).toBe(true);
    expect(await isPaidTier()).toBe(true);
    expect(meCalls).toHaveLength(3); // never served from the read cache
  });

  it("a positive live-options answer does not leak into the write-path gate", async () => {
    const { hasLiveOptions, isPaidTier } = await loadEntitlement();
    signIn("tok-a");

    nextAnswer = () => ({ tier: "pro", features: ["terminal_live_options"] });
    expect(await hasLiveOptions()).toBe(true);

    // Subscription lapses; the write gate must see it immediately.
    nextAnswer = () => ({ tier: "free", features: [] });
    expect(await isPaidTier()).toBe(false);
  });
});

describe("entitlement — the latency win", () => {
  it("collapses a cold page load's seven gates onto ONE upstream call", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    signIn("tok-a");

    for (let i = 0; i < 7; i += 1) {
      expect(await hasLiveOptions()).toBe(true);
    }
    expect(meCalls).toEqual(["tok-a"]);
  });

  it("deduplicates concurrent gates onto one in-flight request", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    signIn("tok-a");

    const results = await Promise.all([
      hasLiveOptions(),
      hasLiveOptions(),
      hasLiveOptions(),
      hasLiveOptions(),
      hasLiveOptions(),
      hasLiveOptions(),
    ]);
    expect(results).toEqual([true, true, true, true, true, true]);
    expect(meCalls).toHaveLength(1);
  });

  it("expires, so a revocation lags by at most the TTL", async () => {
    const { hasLiveOptions } = await loadEntitlement();
    signIn("tok-a");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));

    expect(await hasLiveOptions()).toBe(true);
    expect(meCalls).toHaveLength(1);

    // Still inside the window — served from cache.
    vi.setSystemTime(new Date("2026-07-28T12:00:30Z"));
    expect(await hasLiveOptions()).toBe(true);
    expect(meCalls).toHaveLength(1);

    // Past the TTL — back to the authority, which has since revoked.
    vi.setSystemTime(new Date("2026-07-28T12:01:00Z"));
    nextAnswer = () => ({ tier: "free", features: [] });
    expect(await hasLiveOptions()).toBe(false);
    expect(meCalls).toHaveLength(2);
  });
});
