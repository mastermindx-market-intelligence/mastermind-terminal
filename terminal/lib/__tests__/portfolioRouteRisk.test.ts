// RED-first route tests (section 8) — written before the route edit, per packet procedure.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Force the fixture transport so GET/POST resolve without real Supabase.
process.env.TERMINAL_E2E_FIXTURE = "1";

vi.mock("@/lib/watchlistsFixtureDb", async () => {
  const actual = await vi.importActual<any>("@/lib/watchlistsFixtureDb");
  return actual;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "@/app/api/portfolio/route";
import {
  createFixtureDb,
  fixtureUserId,
  FIXTURE_STORE_COOKIE,
} from "@/lib/watchlistsFixtureDb";
import { resetArtifactCache } from "@/lib/artifactCache";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

function mockCookies(key: string, extra: Record<string, string> = {}) {
  const jar = new Map<string, { name: string; value: string }>();
  jar.set(FIXTURE_STORE_COOKIE, { name: FIXTURE_STORE_COOKIE, value: key });
  for (const [name, value] of Object.entries(extra)) jar.set(name, { name, value });
  return {
    get: (name: string) => jar.get(name),
    getAll: () => Array.from(jar.values()),
  };
}

async function seedOpenPosition(key: string, ticker: string, shares: number, entryPrice: number) {
  const db = createFixtureDb(key, undefined);
  const userId = fixtureUserId(key);
  await db.from("portfolio_positions").insert({
    user_id: userId, ticker, shares, entry_price: entryPrice, status: "open",
  } as any);
}

describe("GET /api/portfolio — risk field (additive)", () => {
  const key = `risk-route-${Math.random().toString(36).slice(2)}`;

  beforeEach(async () => {
    // MAJOR 3 (round-2 review): the route now caches artifact reads per (ticker, cookie). Every
    // `it` block below reuses the SAME ticker ("AAPL") with a DIFFERENT `global.fetch` mock, so
    // without this reset, a later test would silently read back an earlier test's cached result
    // instead of exercising its own mock.
    resetArtifactCache();
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key));
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("LOCKED")) {
        // Observed live transport (2026-09-06): the regwall answers an anonymous fan-out with a
        // REAL 401 + `x-regwall: deny`, never a 200 — this must NOT be mocked as a soft 200.
        return new Response(
          JSON.stringify({ locked: true, reason: "authentication_required" }),
          { status: 401, headers: { "x-regwall": "deny" } },
        );
      }
      if (String(url).includes("MISSING")) {
        return new Response("not found", { status: 404 });
      }
      if (String(url).includes("TIMEOUT")) {
        throw new Error("aborted");
      }
      return new Response(JSON.stringify({ sector: "Energy", personality: { market_cap: 5e9 } }), { status: 200 });
    }) as any;
    await seedOpenPosition(key, "AAPL", 10, 100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1: keeps existing positions payload AND adds risk", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.positions)).toBe(true);
    expect(body.positions.length).toBeGreaterThan(0);
    expect(body.risk).toBeTruthy();
  });

  it("2: schema and weightBasis are pinned literals", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.risk.schema).toBe("portfolio_risk.v1");
    expect(body.risk.weightBasis).toBe("cost");
  });

  it("6: total artifact outage -> still 200, concentration populated, others typed-unread", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network down"); }) as any;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.risk.concentration).toBeTruthy();
    expect(body.risk.sectors.length).toBe(0);
  });

  it("4: unauthenticated -> 401 with no risk key", async () => {
    // Fixture accounts auto-provision on any key, so the ONLY genuine unauthenticated path is
    // the real (non-fixture) transport with no Supabase session. Flip the env off for exactly
    // this call and mock `createClient` to answer "no user" — a real RED-first assertion that
    // fails if the route ever stops gating on session presence.
    const prevFixture = process.env.TERMINAL_E2E_FIXTURE;
    delete process.env.TERMINAL_E2E_FIXTURE;
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });
    try {
      const res = await GET();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).not.toHaveProperty("risk");
      expect(body).not.toHaveProperty("positions");
    } finally {
      if (prevFixture === undefined) delete process.env.TERMINAL_E2E_FIXTURE;
      else process.env.TERMINAL_E2E_FIXTURE = prevFixture;
    }
  });

  it("7: locked artifact (real 401 + x-regwall header) -> page_locked gap, not page_unreadable", async () => {
    await seedOpenPosition(key, "LOCKEDTICK", 5, 50);
    const res = await GET();
    const body = await res.json();
    const gap = body.risk.gaps.find((g: any) => g.ticker === "LOCKEDTICK");
    expect(gap).toBeTruthy();
    expect(gap.reason).toBe("page_locked");
  });

  // Meta-CEO B ruling (2026-09-06, BLOCKER-1 DECIDED) reverses the anonymous-fan-out design
  // the previous "8" pinned: macro's regwall 401s every anonymous artifact read in production
  // (app/regwall.py), so the route now forwards the CALLER's own Supabase session cookie —
  // the one credential macro's gate accepts (it has no Authorization-bearer path at all) and
  // the one Terminal already holds, since Terminal and macro share one Supabase project and
  // one `.mastermind-x.com`-scoped session cookie.
  it("8: forwards the caller's Supabase session cookie to the artifact fetch, and a recorded 200 fixture reads through it", async () => {
    const authCookieName = "sb-testref-auth-token";
    const authCookieValue = "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0";
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key, { [authCookieName]: authCookieValue }));

    const calls: any[] = [];
    global.fetch = vi.fn(async (url: string, init?: any) => {
      calls.push([url, init]);
      const cookieHeader = init?.headers?.Cookie ?? "";
      // Recorded 200 fixture: the artifact shape macro serves once a valid session clears the
      // regwall (never curl-provable from a build pass — see the PR body's live-verification
      // gap). Without the forwarded cookie this fixture answers the real observed 401 lock.
      if (cookieHeader.includes(authCookieName)) {
        return new Response(
          JSON.stringify({ sector: "Technology", personality: { market_cap: 3e12 } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ locked: true, reason: "authentication_required" }),
        { status: 401, headers: { "x-regwall": "deny" } },
      );
    }) as any;

    const res = await GET();
    const body = await res.json();
    // Proves the forwarded cookie was honored end-to-end: AAPL reads Technology/3e12, not a
    // page_locked gap, because the fixture only answers 200 when it sees the cookie. The grouping
    // KEY is now the canonical GICS name ("Information Technology"), not the raw alias the
    // artifact returned — round-2 review MINOR: normalise the grouping key so an alias and its
    // canonical spelling merge into one legend row instead of two.
    expect(body.risk.sectors.some((s: any) => s.key === "Information Technology")).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) {
      const headerNames = Object.keys(init?.headers ?? {}).map((h) => h.toLowerCase());
      expect(headerNames).toContain("cookie");
      // macro's gate has no Authorization-bearer path (app/regwall.py `_mm_supabase_access_token`
      // reads only `request.cookies`) — a bearer header would do nothing, so none is sent.
      expect(headerNames).not.toContain("authorization");
      expect(init.headers.Cookie).toBe(`${authCookieName}=${authCookieValue}`);
      // Only the auth cookie travels — never the unrelated fixture-store cookie from the jar.
      expect(init.headers.Cookie).not.toContain(FIXTURE_STORE_COOKIE);
    }
  });

  it("9: with no session cookie present, the artifact fetch carries no Cookie header (an anonymous caller stays anonymous)", async () => {
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: string, init?: any) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ sector: "Energy" }), { status: 200 });
    }) as any;
    await GET(); // beforeEach's mockCookies(key) carries no sb-*-auth-token cookie
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) {
      expect(init?.headers?.Cookie).toBeUndefined();
    }
  });

  it("9b: an anonymous GET reports coverageSource 'anonymous'; a signed-in GET reports 'credentialed' (MAJOR 2)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ sector: "Energy" }), { status: 200 })) as any;
    const anon = await (await GET()).json();
    expect(anon.risk.coverageSource).toBe("anonymous");

    const authCookieName = "sb-testref-auth-token";
    const authCookieValue = "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0";
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key, { [authCookieName]: authCookieValue }));
    const signedIn = await (await GET()).json();
    expect(signedIn.risk.coverageSource).toBe("credentialed");
  });

  it("10: N reloads within the 15-minute window produce ONE upstream fetch per ticker (MAJOR 3)", async () => {
    // A dedicated, never-reused ticker: the fixture DB accumulates every `it` block's positions
    // under the SAME `key` (by design — the isolation invariant these tests exist to prove is
    // per-USER, not per-test), so filtering the spy's calls by THIS ticker is what makes the
    // assertion robust to however many other tickers earlier tests in this file left open.
    await seedOpenPosition(key, "CACHETEST10", 5, 20);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sector: "Energy", personality: { market_cap: 5e9 } }), { status: 200 }));
    global.fetch = fetchMock as any;
    for (let i = 0; i < 4; i++) {
      const res = await GET();
      const body = await res.json();
      expect(body.risk.sectors.some((s: any) => s.key === "Energy")).toBe(true);
    }
    const cacheTestCalls = fetchMock.mock.calls.filter(([url]: any[]) => String(url).includes("CACHETEST10"));
    // 4 reloads, ONE upstream fetch for this ticker — the rest were served from the memo.
    expect(cacheTestCalls.length).toBe(1);
  });

  it("11: a redirect response from the artifact host is never followed, and the cookie never leaves it (MINOR: allow-list forward origin)", async () => {
    await seedOpenPosition(key, "REDIRECTTEST11", 3, 40);
    const authCookieName = "sb-testref-auth-token";
    const authCookieValue = "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0";
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key, { [authCookieName]: authCookieValue }));

    const calls: any[] = [];
    global.fetch = vi.fn(async (url: string, init?: any) => {
      calls.push([url, init]);
      if (String(url).includes("REDIRECTTEST11")) {
        // A same-host artifact response that tries to redirect the caller elsewhere.
        return new Response(null, { status: 302, headers: { location: "https://not-mastermind-x.example.com/steal" } });
      }
      return new Response(JSON.stringify({ sector: "Energy", personality: { market_cap: 5e9 } }), { status: 200 });
    }) as any;

    const res = await GET();
    const body = await res.json();
    const gap = body.risk.gaps.find((g: any) => g.ticker === "REDIRECTTEST11");
    expect(gap).toBeTruthy();
    expect(gap.reason).toBe("page_unreadable");
    const redirectCalls = calls.filter(([url]) => String(url).includes("REDIRECTTEST11"));
    // Exactly ONE fetch for this ticker — the redirect was never auto-followed with the cookie
    // re-attached to wherever `Location` pointed.
    expect(redirectCalls.length).toBe(1);
    expect(redirectCalls[0][1]?.redirect).toBe("manual");
  });
});
