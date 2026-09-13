import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.TERMINAL_E2E_FIXTURE = "1";
process.env.STOCKDATA_BASE = "http://127.0.0.1:9377";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "@/app/api/portfolio/risk-history/route";
import {
  createFixtureDb,
  fixtureUserId,
  FIXTURE_STORE_COOKIE,
  FIXTURE_FAULT_COOKIE,
  FAULT_POSITIONS_READ,
} from "@/lib/watchlistsFixtureDb";
import { resetOhlcSeriesCache } from "@/lib/ohlcSeriesCache";
import { RF_UNPUBLISHED_REASON, RF_UNREADABLE_REASON } from "@/lib/portfolioRiskHistory";

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

async function seedOpen(key: string, ticker: string, shares: number | null, entryPrice: number | null) {
  const db = createFixtureDb(key, undefined);
  const userId = fixtureUserId(key);
  await db.from("portfolio_positions").insert({
    user_id: userId, ticker, shares, entry_price: entryPrice, status: "open",
  } as any);
}

function bars(n: number, start = "2023-01-02", seed = 100): unknown[] {
  const [y, m, d] = start.split("-").map(Number);
  const t0 = Date.UTC(y, m - 1, d);
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    const c = seed * (1 + 0.001 * ((i % 7) - 3));
    out.push([date, c, c, c, c, 1]);
  }
  return out;
}

function ohlcBody(ticker: string, n = 140, seed = 100) {
  return { t: ticker, o: 1, src: "test", bars: bars(n, "2023-01-02", seed) };
}

function closeOnlyBars(n: number, start = "2023-01-02", seed = 100): unknown[] {
  const [y, m, d] = start.split("-").map(Number);
  const t0 = Date.UTC(y, m - 1, d);
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    const c = seed * (1 + 0.001 * ((i % 7) - 3));
    out.push([date, c, 1]);
  }
  return out;
}

describe("GET /api/portfolio/risk-history", () => {
  const key = `rh-route-${Math.random().toString(36).slice(2)}`;
  let calls: Array<{ url: string; init?: RequestInit }> = [];

  beforeEach(async () => {
    resetOhlcSeriesCache();
    calls = [];
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key));
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = String(url);
      if (init && init.method && init.method !== "GET") {
        return new Response("method not allowed", { status: 405 });
      }
      if (path.includes("/ohlc/DGS3MO.json") || path.includes("/ohlc/us3m.json")) {
        return new Response("not found", { status: 404 });
      }
      if (path.includes("/ohlc/SPY.json")) {
        return new Response(JSON.stringify(ohlcBody("SPY", 140, 200)), { status: 200 });
      }
      const m = /\/ohlc\/([A-Za-z0-9.]+)\.json/.exec(path);
      if (m) {
        return new Response(JSON.stringify(ohlcBody(m[1], 140, 100)), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    await seedOpen(key, "AAA", 10, 10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns schema portfolio_risk_history.v1", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history.schema).toBe("portfolio_risk_history.v1");
    expect(body.history.weightBasis).toBe("cost");
  });

  it("fetches per-ticker OHLC GETs only — no POST, no holdings list in the URL", async () => {
    await GET();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.init?.method ?? "GET").toBe("GET");
      expect(c.url).toContain("http://127.0.0.1:9377/ohlc/");
      expect(c.url).toContain("/ohlc/");
      expect(c.url).toMatch(/\/ohlc\/[A-Za-z0-9.]+\.json$/);
      expect(c.url).not.toContain("AAA,");
      expect(c.url).not.toContain("tickers=");
      expect(c.url).not.toContain("holdings");
      expect(c.url).not.toContain("?");
    }
    const tickers = calls.map((c) => /\/ohlc\/([A-Za-z0-9.]+)\.json/.exec(c.url)?.[1]);
    expect(tickers).toContain("AAA");
    expect(tickers).toContain("SPY");
    expect(tickers).toContain("DGS3MO");
  });

  it("does not fetch OHLC for a short or unsized row", async () => {
    await seedOpen(key, "SHORT", -3, 20);
    await seedOpen(key, "BARE", null, 10);
    resetOhlcSeriesCache();
    calls = [];
    await GET();
    const tickers = calls.map((c) => /\/ohlc\/([A-Za-z0-9.]+)\.json/.exec(c.url)?.[1]);
    expect(tickers).not.toContain("SHORT");
    expect(tickers).not.toContain("BARE");
    expect(tickers).toContain("AAA");
  });

  it("sets the unpublished risk-free reason and still computes beta when DGS3MO and us3m 404", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.history.sharpe).toBeNull();
    expect(body.history.sortino).toBeNull();
    expect(body.history.sharpeReason).toBe(RF_UNPUBLISHED_REASON);
    expect(body.history.sources.riskFreeSource).toBe("unpublished");
    expect(body.history.beta).not.toBeNull();
    expect(body.history.coverageStatus).toBe("partial");
  });

  it("does not type a 401/locked DGS3MO as unpublished; beta still computes", async () => {
    resetOhlcSeriesCache();
    calls = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = String(url);
      if (path.includes("/ohlc/DGS3MO.json") || path.includes("/ohlc/us3m.json")) {
        return new Response(JSON.stringify({ locked: true, reason: "authentication_required" }), {
          status: 401,
          headers: { "content-type": "application/json", "x-regwall": "deny" },
        });
      }
      if (path.includes("/ohlc/SPY.json")) {
        return new Response(JSON.stringify(ohlcBody("SPY", 140, 200)), { status: 200 });
      }
      const m = /\/ohlc\/([A-Za-z0-9.]+)\.json/.exec(path);
      if (m) {
        return new Response(JSON.stringify(ohlcBody(m[1], 140, 100)), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const res = await GET();
    const body = await res.json();
    expect(body.history.sharpe).toBeNull();
    expect(body.history.sortino).toBeNull();
    expect(body.history.sharpeReason).toBe(RF_UNREADABLE_REASON);
    expect(body.history.sortinoReason).toBe(RF_UNREADABLE_REASON);
    expect(body.history.sources.riskFreeSource).toBe("unreadable");
    expect(body.history.beta).not.toBeNull();
    expect(body.history.coverageStatus).toBe("partial");
  });

  it("unauthenticated -> 401 with no history key", async () => {
    const prev = process.env.TERMINAL_E2E_FIXTURE;
    delete process.env.TERMINAL_E2E_FIXTURE;
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });
    try {
      const res = await GET();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).not.toHaveProperty("history");
    } finally {
      process.env.TERMINAL_E2E_FIXTURE = prev;
    }
  });

  it("forwards the caller's session cookie and never a holdings POST", async () => {
    const authCookieName = "sb-testref-auth-token";
    const authCookieValue = "base64-eyJhY2Nlc3NfdG9rZW4iOiJmYWtlIn0";
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key, { [authCookieName]: authCookieValue }));
    resetOhlcSeriesCache();
    calls = [];
    await GET();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.init?.headers && (c.init.headers as Record<string, string>).Cookie).toBe(
        `${authCookieName}=${authCookieValue}`,
      );
      expect(c.init?.redirect).toBe("manual");
      const headerNames = Object.keys((c.init?.headers ?? {}) as object).map((h) => h.toLowerCase());
      expect(headerNames).not.toContain("authorization");
    }
  });

  it("caches per ticker: N reloads produce one upstream GET per path", async () => {
    resetOhlcSeriesCache();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    for (let i = 0; i < 3; i++) await GET();
    const aaa = fetchMock.mock.calls.filter(([url]) => String(url).includes("/ohlc/AAA.json"));
    expect(aaa.length).toBe(1);
  });

  it("includes a close-only o:0 holding and types a malformed 200 body as unreadable, not missing", async () => {
    resetOhlcSeriesCache();
    calls = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = String(url);
      if (path.includes("/ohlc/DGS3MO.json") || path.includes("/ohlc/us3m.json")) {
        return new Response("not found", { status: 404 });
      }
      if (path.includes("/ohlc/SPY.json")) {
        return new Response(JSON.stringify(ohlcBody("SPY", 140, 200)), { status: 200 });
      }
      if (path.includes("/ohlc/AAA.json")) {
        return new Response(JSON.stringify({ t: "AAA", o: 0, bars: closeOnlyBars(140) }), { status: 200 });
      }
      if (path.includes("/ohlc/BAD.json")) {
        return new Response(JSON.stringify({ t: "BAD", o: 0, bars: bars(140) }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    await seedOpen(key, "BAD", 4, 25);
    const res = await GET();
    const body = await res.json();
    expect(body.history.included.map((r: { ticker: string }) => r.ticker)).toContain("AAA");
    expect(body.history.excluded).toEqual(
      expect.arrayContaining([{ ticker: "BAD", reason: "unreadable_price_history" }]),
    );
    expect(body.history.excluded.some((e: { reason: string }) => e.reason === "missing_price_history")).toBe(false);
  });

  it("empty book still answers 200 with an empty included list", async () => {
    const emptyKey = `rh-empty-${Math.random().toString(36).slice(2)}`;
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(emptyKey));
    resetOhlcSeriesCache();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history.counts.included).toBe(0);
    expect(body.history.coverageStatus).toBe("empty");
  });

  it("store unreadable -> 503", async () => {
    const { cookies } = await import("next/headers");
    (cookies as any).mockResolvedValue(mockCookies(key, { [FIXTURE_FAULT_COOKIE]: FAULT_POSITIONS_READ }));
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
