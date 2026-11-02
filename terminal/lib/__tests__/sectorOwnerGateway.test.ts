import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic authentication exists only inside this unit test. No account/session
// is installed, no network is used, and these cases are not production auth proof.
const adminGate = vi.hoisted(() => ({ isAdminRequest: vi.fn() }));
vi.mock("@/lib/adminGate", () => adminGate);
const auth = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn() }));
const currentCookieStore = vi.hoisted(() => {
  const state = { values: [] as { name: string; value: string }[] };
  return { state, getAll: vi.fn(() => state.values) };
});
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: currentCookieStore.getAll })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/upstreams", () => ({ NW_BASE: "https://mastermind-x.com" }));
import { filteredSupabaseCookieHeader, GET } from "@/app/api/sector-intelligence/route";
import { finvizMembershipPayload, finvizMembershipFixture } from "./fixtures/finvizMembership";
import { MARKET_RISK_NOW, riskEnvelopeFixture } from "./marketRiskFixture";
import relativeTrendFixture from "./fixtures/sector-rotation-relative-trend.v1.json";
import holdingsCoverageFixture from "./fixtures/sector-holdings-coverage.v1.json";
import { basket, basketPulse, mixedPulse, observedComparison } from "./sectorIntradayFixture";

const AUTH_COOKIE = "sb-fsldfzlxyavsuwqbceod-auth-token.0=base64-part-0; theme=dark; sb-fsldfzlxyavsuwqbceod-auth-token.1=part-1";
const FILTERED_COOKIE = "sb-fsldfzlxyavsuwqbceod-auth-token.0=base64-part-0; sb-fsldfzlxyavsuwqbceod-auth-token.1=part-1";
const request = (source: string, cookie: string | null = AUTH_COOKIE) => new Request(
  `http://localhost/api/sector-intelligence?source=${source}`,
  cookie === null ? undefined : { headers: { Cookie: cookie } },
);
const payload = { as_of: "2026-09-25", sectors: [] };
let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  adminGate.isAdminRequest.mockResolvedValue({ status: "denied" });
  currentCookieStore.state.values = [
    { name: "sb-fsldfzlxyavsuwqbceod-auth-token.0", value: "base64-part-0" },
    { name: "theme", value: "dark" },
    { name: "sb-fsldfzlxyavsuwqbceod-auth-token.1", value: "part-1" },
  ];
  auth.getUser.mockResolvedValue({ data: { user: { id: "test-owner" } }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "test-owner" }, access_token: "synthetic-unit-token" } } });
  upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sector gateway owner-envelope admission", () => {
  it("filters the incoming jar to exact Supabase auth-cookie chunks", () => {
    expect(filteredSupabaseCookieHeader(request("sector"))).toBe(FILTERED_COOKIE);
    expect(filteredSupabaseCookieHeader(request("sector", "theme=dark; mm_aid=visitor"))).toBeNull();
    expect(filteredSupabaseCookieHeader(request("sector", "sb-ref-auth-token=; theme=dark"))).toBeNull();
    expect(filteredSupabaseCookieHeader(request("sector", "sb-ref-auth-token-code-verifier=pkce; sb-ref-auth-token.x=bad"))).toBeNull();
  });

  it("does not fetch owner JSON without a validated user", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request("sector"));
    expect(response.status).toBe(401); expect(upstream).not.toHaveBeenCalled();
    expect((await response.json()).data).toBeNull();
  });

  it("does not fetch without a forwardable shared auth cookie", async () => {
    for (const req of [request("sector", null), request("sector", "theme=dark; mm_aid=visitor")]) {
      const response = await GET(req);
      expect(response.status).toBe(401); expect((await response.json()).receipt.status).toBe("access");
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not forward a session belonging to a different user", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "other-owner" }, access_token: "synthetic-unit-token" } } });
    expect((await GET(request("sector"))).status).toBe(401); expect(upstream).not.toHaveBeenCalled();
  });

  it("requires a current local access token without using it as the Macro credential", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "test-owner" }, access_token: "" } } });
    expect((await GET(request("sector"))).status).toBe(401); expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards only the filtered cookie to the canonical fixed owner host", async () => {
    const raw = JSON.stringify(payload);
    upstream.mockResolvedValue(new Response(raw, { headers: { "Content-Type": "application/json" } }));
    const response = await GET(request("sector")), result = await response.json();
    expect(response.status).toBe(200); expect(result.data).toEqual(payload);
    expect(result.receipt.asOf).toBe("2026-09-25");
    expect(result.receipt.contentHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/sectordata/sector_central.json");
    const init = upstream.mock.calls[0][1] as RequestInit, headers = new Headers(init.headers);
    expect(init).toMatchObject({ redirect: "manual", cache: "no-store" });
    expect(headers.get("cookie")).toBe(FILTERED_COOKIE);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("cookie")).not.toContain("theme=dark");
  });

  it("forwards the refreshed current cookie instead of the stale incoming snapshot", async () => {
    const stale = "sb-fsldfzlxyavsuwqbceod-auth-token.0=stale-0; sb-fsldfzlxyavsuwqbceod-auth-token.1=stale-1";
    auth.getUser.mockImplementation(async () => {
      currentCookieStore.state.values = [
        { name: "sb-fsldfzlxyavsuwqbceod-auth-token.0", value: "fresh-0" },
        { name: "theme", value: "light" },
        { name: "sb-fsldfzlxyavsuwqbceod-auth-token.1", value: "fresh-1" },
      ];
      return { data: { user: { id: "test-owner" } }, error: null };
    });
    upstream.mockResolvedValue(Response.json(payload));

    expect((await GET(request("sector", stale))).status).toBe(200);
    const headers = new Headers((upstream.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("cookie")).toBe(
      "sb-fsldfzlxyavsuwqbceod-auth-token.0=fresh-0; sb-fsldfzlxyavsuwqbceod-auth-token.1=fresh-1",
    );
    expect(headers.get("cookie")).not.toContain("stale");
    expect(headers.get("cookie")).not.toContain("theme=light");
  });

  it("does not fetch when session initialization leaves no current auth cookie", async () => {
    auth.getUser.mockImplementation(async () => {
      currentCookieStore.state.values = [{ name: "theme", value: "dark" }];
      return { data: { user: { id: "test-owner" } }, error: null };
    });
    const response = await GET(request("sector"));
    expect(response.status).toBe(401);
    expect((await response.json()).receipt.status).toBe("access");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects an unknown source before any owner request", async () => {
    const response = await GET(request("__proto__"));
    expect(response.status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a flat theme fixture rather than accepting it as the real owner schema", async () => {
    upstream.mockResolvedValue(Response.json({ themes: [{ theme_id: "memory", stage: "WATCH", entry_ready: false }] }));
    const response = await GET(request("themes")), result = await response.json();
    expect(response.status).toBe(502); expect(result.data).toBeNull(); expect(result.receipt.status).toBe("invalid");
  });


  it("proxies the fixed native RC episode owner through the same authenticated gateway", async () => {
    const data = {
      schema: "rotation_events.v1", ok: true, as_of: "2026-10-06",
      generated_utc: "2026-10-07 08:08 UTC", coldstart: false,
      authority: { tier: "display", may_rank: false, may_gate: false, may_size: false, may_escalate: false },
      active: [], created_tonight: [], closed_tonight: [], closed_recent: [],
    };
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("events")), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.receipt.source).toBe("events");
    expect(result.receipt.asOf).toBe("2026-10-06");
    expect(result.data.closed_recent).toEqual([]);
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/marketdata/rotation_events.json");
  });

  it("rejects an RC episode feed that forges ranking permission", async () => {
    upstream.mockResolvedValue(Response.json({
      schema: "rotation_events.v1", ok: true, as_of: "2026-10-06",
      generated_utc: "2026-10-07 08:08 UTC", coldstart: false,
      authority: { tier: "display", may_rank: true, may_gate: false, may_size: false, may_escalate: false },
      active: [], created_tonight: [], closed_tonight: [], closed_recent: [],
    }));
    const response = await GET(request("events")), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.data).toBeNull();
    expect(result.receipt.status).toBe("invalid");
  });

  it("proxies the fixed sector-cycle history owner through the same authenticated gateway", async () => {
    const data = {
      meta: {
        asOf: "2026-10-02",
        rs_history: {
          schema: "sector_cycles.rs_history.v1",
          mode: "reconstructed_price_history",
          naturally_observed: false,
          basis: "tr",
          benchmark: "SPY",
          horizons_sessions: [21, 63],
          max_points_per_sector: 252,
        },
      },
      sectors: [{ id: "xlk", ticker: "XLK", kind: "sector", rs_history: [{ date: "2026-10-02", rs_21d: 8.1, rs_63d: 6.1 }] }],
    };
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("history")), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.receipt.source).toBe("history");
    expect(result.receipt.asOf).toBe("2026-10-02");
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/sectordata/sector_cycles.json");
  });

  it("rejects malformed or falsely-observed sector history as an invalid owner envelope", async () => {
    const invalid = {
      meta: {
        asOf: "2026-10-02",
        rs_history: {
          schema: "sector_cycles.rs_history.v1",
          mode: "reconstructed_price_history",
          naturally_observed: true,
          basis: "tr",
          benchmark: "SPY",
          horizons_sessions: [21, 63],
          max_points_per_sector: 252,
        },
      },
      sectors: [{ id: "xlk", ticker: "XLK", kind: "sector", rs_history: [{ date: "2026-10-02", rs_21d: 8.1, rs_63d: 6.1 }] }],
    };
    upstream.mockResolvedValue(Response.json(invalid));
    const response = await GET(request("history")), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.data).toBeNull();
    expect(result.receipt.status).toBe("invalid");
  });

  it("keeps a valid empty theme collection distinct from an invalid response", async () => {
    const data = { schema: "neuralweb.theme_state.v1", as_of: "2026-09-26", themes: [] };
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("themes"));
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual(data);
  });

  it.each([401, 403])("does not relay upstream authorization failure %s as usable JSON", async status => {
    upstream.mockResolvedValue(Response.json(payload, { status }));
    const response = await GET(request("sector")), result = await response.json();
    expect(response.status).toBe(status); expect(result.data).toBeNull(); expect(result.receipt.status).toBe("access");
  });

  it("keeps a missing owner file distinct from an owner failure", async () => {
    upstream.mockResolvedValue(Response.json({}, { status: 404 }));
    const response = await GET(request("sector")), result = await response.json();
    expect(response.status).toBe(404); expect(result.receipt.status).toBe("unavailable");
  });

  it("does not follow an upstream redirect or expose its body", async () => {
    upstream.mockResolvedValue(new Response("untrusted redirect", { status: 302, headers: { location: "https://example.invalid" } }));
    const response = await GET(request("sector"));
    expect(response.status).toBe(503); expect(upstream).toHaveBeenCalledTimes(1);
    expect((upstream.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
    expect((await response.json()).data).toBeNull();
  });

  it("does not accept an HTML login page as sector data", async () => {
    upstream.mockResolvedValue(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
    const response = await GET(request("sector"));
    expect(response.status).toBe(502); expect((await response.json()).receipt.status).toBe("invalid");
  });

  it("fails closed on malformed JSON and declared oversized bodies", async () => {
    upstream.mockResolvedValueOnce(new Response("{broken", { headers: { "Content-Type": "application/json" } }));
    expect((await GET(request("sector"))).status).toBe(502);
    upstream.mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(4 * 1024 * 1024 + 1) } }));
    const oversized = await GET(request("sector"));
    expect(oversized.status).toBe(502); expect((await oversized.json()).receipt.status).toBe("invalid");
  });
});


describe("Finviz remains internal-only", () => {
  it("does not fetch internal Finviz for an authenticated customer", async () => {
    const response = await GET(request("finviz"));
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not turn admin authority failure into permission", async () => {
    adminGate.isAdminRequest.mockResolvedValue({ status: "unavailable" });
    expect((await GET(request("finviz"))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("requires shared authentication before the admin gate", async () => {
    expect((await GET(request("finviz", null))).status).toBe(401);
    expect(adminGate.isAdminRequest).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});

it("returns factual internal owner data without vendor descriptions", async () => {
  adminGate.isAdminRequest.mockResolvedValue({ status: "admin" });
  const internal = { source: "finviz-themes", map_type: "themes", asof: "2026-10-07", generated_utc: "2026-10-07 19:59", n_tiles: 1, n_members: 1, size_basis: "count",
    sectors: [{ key: "AI", en: "AI", zh: "人工智能" }], timeframes: ["1D", "1W", "MTD", "1M", "3M", "6M", "YTD", "1Y"].map(key => ({ key, available: true, description: "VENDOR_TIMEFRAME_PROSE" })),
    tiles: [{ t: "compute", name: "Compute", sector: "AI", size: 1, desc: "VENDOR_PROSE", perf: { "1D": 1 }, members: [{ t: "NVDA", perf: { "1D": 1 }, description: "VENDOR_MEMBER_PROSE" }] }], description: "VENDOR_ROOT_PROSE" };
  upstream.mockResolvedValue(new Response(JSON.stringify(internal), { headers: { "Content-Type": "application/json" } }));
  const response = await GET(request("finviz")), result = await response.json();
  expect(response.status).toBe(200);
  expect(JSON.stringify(result.data)).not.toContain("VENDOR_");
  expect(result.data.tiles[0].members[0].t).toBe("NVDA");
  expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/marketdata/themes_heatmap.json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
describe("canonical risk context over the existing authenticated gateway", () => {
  it("uses the same cookie, fixed owner path and no-store contract", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MARKET_RISK_NOW);
    const envelope = riskEnvelopeFixture();
    upstream.mockResolvedValue(Response.json(envelope));
    const response = await GET(request("risk")), result = await response.json();
    expect(result.data).toEqual(envelope);
    expect(result.receipt).toMatchObject({ source: "risk", path: "/riskdata/risk_envelope.json",
      status: "ready", asOf: "2026-10-07", stale: false, qualificationReasons: [] });
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/riskdata/risk_envelope.json");
    expect(new Headers((upstream.mock.calls[0][1] as RequestInit).headers).get("cookie")).toBe(FILTERED_COOKIE);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not query risk context when there is no authenticated cookie", async () => {
    expect((await GET(request("risk", null))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    { source_session: "2026-10-01", as_of: "2026-10-01" },
    { source_session: "2026-10-09", as_of: "2026-10-09" },
    { produced_at: "2026-10-08T13:00:00Z" },
    { stale_after: "2026-10-08T11:00:00Z" },
  ])("a receipt cannot freshen unqualified source clocks: %j", async patch => {
    vi.spyOn(Date, "now").mockReturnValue(MARKET_RISK_NOW);
    const envelope = { ...riskEnvelopeFixture(), ...patch };
    upstream.mockResolvedValue(Response.json(envelope));
    const response = await GET(request("risk")), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data).toBeNull();
    expect(result.receipt).toMatchObject({ status: "ready", stale: true, asOf: envelope.as_of });
    expect(result.receipt.qualificationReasons.length).toBeGreaterThan(0);
  });
  it("rejects a look-alike body before exposing its values", async () => {
    upstream.mockResolvedValue(Response.json({ schema: "market_state.v1", verdict: "RISK_OFF" }));
    const response = await GET(request("risk"));
    expect(response.status).toBe(502); expect((await response.json()).data).toBeNull();
  });
});


describe("Finviz membership metadata transport", () => {
  beforeEach(() => adminGate.isAdminRequest.mockResolvedValue({ status: "admin" }));
  it("projects the committed metadata contract and strips unrecognized authority claims", async () => {
    const manifest = finvizMembershipFixture();
    upstream.mockResolvedValue(Response.json({ ...finvizMembershipPayload(), membership_manifest: {
      ...manifest, rights: "public", accepted: true, vendor_prose: "do not transport",
    } }));
    const response = await GET(request("finviz"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.membership_manifest).toEqual(manifest);
    expect(body.data.membership_manifest.membership.asof).not.toBe(body.receipt.asOf);
    expect(body.data.membership_manifest.unresolved_identity_count).toBeNull();
  });
  it.each(["counts", "unknowns", "clock", "null"])("withholds inconsistent %s metadata with its population", async change => {
    const manifest = finvizMembershipFixture();
    if (change === "counts") (manifest.counts as Record<string, unknown>).appearances = 3;
    if (change === "unknowns") manifest.unresolved_identity_count = 0;
    if (change === "clock") (manifest.membership as Record<string, unknown>).refreshed_at_utc = "2027-01-01T00:00:00Z";
    upstream.mockResolvedValue(Response.json({ ...finvizMembershipPayload(), membership_manifest: change === "null" ? null : manifest }));
    const response = await GET(request("finviz")), body = await response.json();
    expect(response.status).toBe(502); expect(body.data).toBeNull(); expect(body.receipt.status).toBe("invalid");
  });
  it("keeps legacy metadata absent without inventing a source receipt", async () => {
    upstream.mockResolvedValue(Response.json(finvizMembershipPayload()));
    const response = await GET(request("finviz"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).not.toHaveProperty("membership_manifest");
  });
});

describe("Options R1 W2 owner feeds through the same authenticated gateway", () => {
  it("proxies the weekly relative trend owner and dates the receipt from the feed's own as-of", async () => {
    upstream.mockResolvedValue(Response.json(relativeTrendFixture));
    const response = await GET(request("relative_trend")), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.receipt.source).toBe("relative_trend");
    expect(result.receipt.path).toBe("/sectordata/sector_rotation_relative_trend.json");
    expect(result.receipt.asOf).toBe("2026-10-16");
    expect(result.data.meta.method.id).toBe("relative_trend_ema");
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/sectordata/sector_rotation_relative_trend.json");
  });
  it("rejects a relative trend feed whose weeks run backwards as an invalid owner envelope", async () => {
    const sectors = relativeTrendFixture.sectors.map(series => series.id !== "xlk" ? series : { ...series, observations: [...series.observations].reverse() });
    upstream.mockResolvedValue(Response.json({ ...relativeTrendFixture, sectors }));
    const response = await GET(request("relative_trend")), result = await response.json();
    expect(response.status).toBe(502); expect(result.data).toBeNull(); expect(result.receipt.status).toBe("invalid");
  });
  it("proxies the holdings coverage owner and keeps an unknown total null on the wire", async () => {
    upstream.mockResolvedValue(Response.json(holdingsCoverageFixture));
    const response = await GET(request("holdings")), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.receipt.source).toBe("holdings");
    expect(result.receipt.path).toBe("/sectordata/sector_holdings_coverage.json");
    expect(result.receipt.asOf).toBe("2026-10-16");
    expect(result.data.funds.find((fund: { fund: string }) => fund.fund === "XLU").n_holdings_total).toBeNull();
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/sectordata/sector_holdings_coverage.json");
  });
  it("rejects a holdings feed that renders an unknown total as zero", async () => {
    const funds = holdingsCoverageFixture.funds.map(fund => fund.fund !== "XLU" ? fund : { ...fund, n_holdings_total: 0, coverage: { ...fund.coverage, count: { ...fund.coverage.count, total: 0 } } });
    upstream.mockResolvedValue(Response.json({ ...holdingsCoverageFixture, funds }));
    const response = await GET(request("holdings")), result = await response.json();
    expect(response.status).toBe(502); expect(result.receipt.status).toBe("invalid");
  });
});

describe("catalyst intraday comparison through the same authenticated gateway", () => {
  it("reads the basket-pulse owner on the same fixed origin, cookie and no-store contract", async () => {
    const data = mixedPulse();
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("intraday")), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.receipt).toMatchObject({ source: "intraday", path: "/live/basket_pulse.json",
      status: "ready", stale: false });
    expect(String(upstream.mock.calls[0][0])).toBe("https://www.mastermind-x.com/live/basket_pulse.json");
    const init = upstream.mock.calls[0][1] as RequestInit, headers = new Headers(init.headers);
    expect(init).toMatchObject({ redirect: "manual", cache: "no-store" });
    expect(headers.get("cookie")).toBe(FILTERED_COOKIE);
    expect(headers.get("authorization")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(result.data.baskets.find((row: { id: string }) => row.id === "ai_infra").intraday_comparison.status).toBe("observed");
  });

  it("dates the receipt with the owner's full intraday clock, never a truncated date", async () => {
    upstream.mockResolvedValue(Response.json(mixedPulse()));
    const result = await (await GET(request("intraday"))).json();
    // Collapsing this to 2026-10-22 would make every observation of the day look identical.
    expect(result.receipt.asOf).toBe("2026-10-22T19:00:00.000Z");
    expect(result.receipt.observedAt).not.toBe(result.receipt.asOf);
  });

  it("leaves every other feed's source stamp exactly as it was", async () => {
    upstream.mockResolvedValue(Response.json(payload));
    const result = await (await GET(request("sector"))).json();
    expect(result.receipt.asOf).toBe("2026-09-25");
  });

  it("admits a basket-pulse build that has not published any comparison yet", async () => {
    const data = basketPulse([basket("ai_infra", undefined), basket("mag7", null)]);
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("intraday")), result = await response.json();
    // An absent capability is a readable owner envelope, not a transport failure.
    expect(response.status).toBe(200); expect(result.data).toEqual(data);
    expect(result.receipt.status).toBe("ready");
  });

  it("rejects a look-alike basket pulse before exposing any of its values", async () => {
    for (const envelope of [{ ...basketPulse([]), schema: "basket_pulse.v2" },
      { ...basketPulse([]), market: "hk" },
      { ...basketPulse([basket("ai_infra", observedComparison()), basket("ai_infra", observedComparison())]) }]) {
      upstream.mockResolvedValue(Response.json(envelope));
      const response = await GET(request("intraday")), result = await response.json();
      expect(response.status).toBe(502); expect(result.data).toBeNull(); expect(result.receipt.status).toBe("invalid");
    }
  });

  it("does not qualify intraday observations without an authenticated cookie or a valid session", async () => {
    expect((await GET(request("intraday", null))).status).toBe(401);
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(request("intraday"))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 503])("keeps an upstream %s an outage rather than usable comparison data", async status => {
    upstream.mockResolvedValue(Response.json(mixedPulse(), { status }));
    const response = await GET(request("intraday")), result = await response.json();
    expect(result.data).toBeNull();
    expect(result.receipt.status).toBe(status === 503 ? "error" : status === 404 ? "unavailable" : "access");
  });
});
