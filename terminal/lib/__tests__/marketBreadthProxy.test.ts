import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the market-breadth proxy (app/api/market-breadth/route.ts) and its
// projection (lib/shared-shell/marketBreadth.ts).
//
// GET-only, session-gated read of Macro's public live.breadth.v1 file. With NO session it 401s
// locally and never contacts the gateway. With a session it returns a WHITELISTED projection
// (S&P 500 tier, composite, clocks, coverage, verdict) and never per-name membership. Anything
// that does not validate is a 503 — never a partial or zero-filled reading. A file older than the
// live window is re-dated on the server clock as `source_stale` with no numbers; the clock is
// frozen per test so each case is about one known moment.
// ─────────────────────────────────────────────────────────────────────────────

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

import { GET } from "@/app/api/market-breadth/route";
import { BREADTH_UPSTREAM, breadthExpiresAt, marketBreadthPayload, projectBreadth } from "@/lib/shared-shell/marketBreadth";

// Shape of the live file on 2026-10-30 (post-session), trimmed to the fields the producer
// writes; `meta` stands in for the per-name membership that must never leave the proxy.
const LIVE = {
  schema: "live.breadth.v1",
  asof: "2026-10-30T22:59:11Z",
  built_at: "2026-10-30T22:59:11Z",
  source_age_min: 0.0,
  session: "post",
  delay_min: 15,
  usable: true,
  unusable_reason: null,
  coverage: { pct: 99.2, n: 498 },
  tiers: [
    { key: "large", n: 503, adv_pct: 44.31, pa200: 60.37 },
    { key: "mid", n: 400, adv_pct: 41.0, pa200: 52.1 },
  ],
  comp: { n: 1503, adv_pct: 42.8, pa200: 55.0 },
  meta: { members: ["AAPL", "MSFT"], source_clock: "2026-10-30T22:44:00Z" },
};
// Eleven minutes after LIVE was built: inside the 25-minute live window.
const FRESH = new Date("2026-10-30T23:10:00Z");
// Sunday 07:00 New York: the poller has been stopped since Friday evening.
const SUNDAY = new Date("2026-11-01T12:00:00Z");
const fresh = () => vi.setSystemTime(FRESH);

type Captured = { url: string; init: RequestInit; headers: Record<string, string> };
let calls: Captured[];
let realFetch: typeof globalThis.fetch;

function installFetchSpy(status = 200, body: unknown = LIVE, raw?: string) {
  realFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    calls.push({ url: String(url), init: init ?? {}, headers });
    return new Response(raw ?? JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
}

let ipCounter = 0;
function req(extra: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request("https://app.mastermind-x.com/api/market-breadth", {
    method: "GET",
    headers: { "cf-connecting-ip": `198.51.100.${ipCounter}`, ...extra },
  });
}
const anon = () => { H.session = null; H.user = null; };
const signedIn = () => { H.session = { access_token: "sess-token-abc" }; H.user = { id: "user-1" }; };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); fresh(); installFetchSpy(); anon(); });
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); vi.clearAllMocks(); });

describe("anonymous → local 401, gateway never contacted", () => {
  it("no session 401s without calling upstream and never caches", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(calls).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a session without a user is still anonymous", async () => {
    H.session = { access_token: "orphan" };
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("signed-in → whitelisted projection of the live file", () => {
  it("reads the public breadth file and returns only the projected fields", async () => {
    signedIn();
    const res = await GET(req({ authorization: "Bearer client-forged", cookie: "sb=secret" }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // The bare default host is resolved to its canonical www origin, so redirects stay refused.
    expect(calls[0].url).toBe("https://www.mastermind-x.com/live/breadth.json");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.cache).toBe("no-store");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    // The file is public: nothing about the reader's session travels to the gateway.
    expect(calls[0].headers["authorization"]).toBeUndefined();
    expect(calls[0].headers["cookie"]).toBeUndefined();
    const body = await res.json();
    expect(body).toEqual({
      schema: "mmx.market_breadth.v1",
      asof: "2026-10-30T22:59:11Z",
      built_at: "2026-10-30T22:59:11Z",
      source_age_min: 0,
      session: "post",
      delay_min: 15,
      usable: true,
      unusable_reason: null,
      coverage_pct: 99.2,
      large: { n: 503, adv_pct: 44.31, pa200: 60.37 },
      comp: { n: 1503, adv_pct: 42.8, pa200: 55.0 },
    });
    expect(JSON.stringify(body)).not.toContain("AAPL");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("relays an unusable verdict with its reason and none of the numbers it declined", async () => {
    signedIn();
    // The producer still writes its computed shares beside an unusable verdict.
    installFetchSpy(200, { ...LIVE, usable: false, unusable_reason: "session_closed" });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usable).toBe(false);
    expect(body.unusable_reason).toBe("session_closed");
    expect(body.large).toBeNull();
    expect(body.comp).toBeNull();
    expect(JSON.stringify(body)).not.toContain("44.31");
  });
});

describe("the live window is applied on the reader's clock", () => {
  it("Sunday: Friday's post-session file is source_stale with no numbers", async () => {
    vi.setSystemTime(SUNDAY);
    signedIn();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ usable: false, unusable_reason: "source_stale", large: null, comp: null });
    expect(JSON.stringify(body)).not.toMatch(/44\.31|42\.8/);
  });

  it("mid-session, a file 40 minutes old is source_stale", async () => {
    vi.setSystemTime(new Date("2026-10-30T15:40:00Z"));
    signedIn();
    installFetchSpy(200, { ...LIVE, session: "rth", asof: "2026-10-30T15:00:00Z", built_at: "2026-10-30T15:00:00Z" });
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ usable: false, unusable_reason: "source_stale", large: null });
  });

  it("a source clock behind the build, or missing, is source_stale", () => {
    expect(projectBreadth({ ...LIVE, source_age_min: 31 }, FRESH)).toMatchObject({ usable: false, unusable_reason: "source_stale" });
    expect(projectBreadth({ ...LIVE, source_age_min: null }, FRESH)).toMatchObject({ usable: false, unusable_reason: "source_stale" });
  });

  it("the edge of the window: 25 minutes is live, 26 is not; a slightly ahead source is allowed", () => {
    expect(projectBreadth(LIVE, new Date("2026-10-30T23:24:11Z"))?.usable).toBe(true);
    expect(projectBreadth(LIVE, new Date("2026-10-30T23:25:12Z"))?.usable).toBe(false);
    expect(projectBreadth({ ...LIVE, source_age_min: -2 }, FRESH)?.usable).toBe(true);
  });

  it("a file without built_at falls back to asof, as Macro's own reader does", () => {
    expect(projectBreadth({ ...LIVE, built_at: undefined }, FRESH)?.built_at).toBe(LIVE.asof);
  });
});

describe("anything that does not validate → 503, never a partial reading", () => {
  it.each([
    ["upstream 500", 500, LIVE, undefined],
    ["upstream 404", 404, LIVE, undefined],
    ["not JSON", 200, null, "<html>gateway error</html>"],
    ["wrong schema", 200, { ...LIVE, schema: "live.breadth.v2" }, undefined],
    ["no schema", 200, { ...LIVE, schema: undefined }, undefined],
    ["no asof", 200, { ...LIVE, asof: undefined }, undefined],
    ["unparseable built_at", 200, { ...LIVE, built_at: "soon" }, undefined],
    ["unparseable asof", 200, { ...LIVE, asof: "yesterday" }, undefined],
    ["unknown session", 200, { ...LIVE, session: "lunch" }, undefined],
    ["usable not boolean", 200, { ...LIVE, usable: "yes" }, undefined],
    ["usable without the S&P 500 tier", 200, { ...LIVE, tiers: [] }, undefined],
    ["usable without adv_pct", 200, { ...LIVE, tiers: [{ key: "large", n: 503, adv_pct: null, pa200: 60 }] }, undefined],
    ["usable with an out-of-range share", 200, { ...LIVE, tiers: [{ key: "large", n: 503, adv_pct: 140, pa200: 60 }] }, undefined],
  ])("%s", async (_name, status, body, raw) => {
    signedIn();
    installFetchSpy(status as number, body, raw as string | undefined);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "breadth_unavailable" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a body over the size cap is a 503", async () => {
    signedIn();
    installFetchSpy(200, null, JSON.stringify({ ...LIVE, pad: "x".repeat(300 * 1024) }));
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("a redirect the fetch refuses is a 503", async () => {
    signedIn();
    globalThis.fetch = vi.fn(async () => { throw new TypeError("unexpected redirect"); }) as unknown as typeof globalThis.fetch;
    expect((await GET(req())).status).toBe(503);
  });

  it("a network failure is a 503", async () => {
    signedIn();
    globalThis.fetch = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof globalThis.fetch;
    const res = await GET(req());
    expect(res.status).toBe(503);
  });
});

describe("projection guards", () => {
  it("reduces an unrecognised reason to 'unknown' instead of echoing it", () => {
    expect(projectBreadth({ ...LIVE, usable: false, unusable_reason: "<script>alert(1)</script>" }, FRESH)?.unusable_reason).toBe("unknown");
    expect(projectBreadth({ ...LIVE, usable: false, unusable_reason: 7 }, FRESH)?.unusable_reason).toBe("unknown");
  });

  it("drops a negative delay and a non-positive tier count", () => {
    const p = projectBreadth({ ...LIVE, delay_min: -5, comp: { n: 0, adv_pct: 40, pa200: 50 } }, FRESH);
    expect(p?.delay_min).toBeNull();
    expect(p?.comp).toBeNull();
  });

  it("the client re-check accepts the proxy's own answer and nothing else", () => {
    const projected = projectBreadth(LIVE, FRESH);
    expect(marketBreadthPayload(projected, FRESH)).toEqual(projected);
    expect(marketBreadthPayload(LIVE, FRESH)).toBeNull();
    expect(marketBreadthPayload({ ...projected, schema: "mmx.market_breadth.v0" }, FRESH)).toBeNull();
    expect(marketBreadthPayload(null, FRESH)).toBeNull();
    expect(marketBreadthPayload([projected], FRESH)).toBeNull();
  });

  it("the client re-check withholds an answer that aged out after the proxy sent it", () => {
    const projected = projectBreadth(LIVE, FRESH);
    expect(projected?.usable).toBe(true);
    expect(marketBreadthPayload(projected, SUNDAY)).toMatchObject({ usable: false, unusable_reason: "source_stale", large: null, comp: null });
  });

  it("pins the upstream origin and ignores the brain gateway setting", async () => {
    expect(BREADTH_UPSTREAM.href).toBe("https://www.mastermind-x.com/live/breadth.json");
    const prior = process.env.BRAIN_GATEWAY_URL;
    process.env.BRAIN_GATEWAY_URL = "http://127.0.0.1:8787";
    try {
      signedIn();
      const res = await GET(req());
      expect(res.status).toBe(200);
      expect(calls[0].url).toBe("https://www.mastermind-x.com/live/breadth.json");
    } finally {
      if (prior === undefined) delete process.env.BRAIN_GATEWAY_URL;
      else process.env.BRAIN_GATEWAY_URL = prior;
    }
  });

  it("does not trust a clock far ahead of the reader as live", () => {
    expect(projectBreadth({ ...LIVE, source_age_min: -10 }, FRESH)).toMatchObject({ usable: false, unusable_reason: "source_stale", large: null });
    expect(projectBreadth({ ...LIVE, built_at: "2026-10-31T23:10:00Z" }, FRESH)).toMatchObject({ usable: false, unusable_reason: "source_stale", large: null });
    expect(projectBreadth({ ...LIVE, built_at: "2026-10-30T23:13:00Z" }, FRESH)?.usable).toBe(true);
  });

  it("dates the end of a live reading's window from its build clock", () => {
    const live = projectBreadth(LIVE, FRESH)!;
    expect(breadthExpiresAt(live)).toBe(Date.parse(LIVE.built_at) + 25 * 60_000);
    expect(breadthExpiresAt(projectBreadth(LIVE, SUNDAY)!)).toBeNull();
  });
});
