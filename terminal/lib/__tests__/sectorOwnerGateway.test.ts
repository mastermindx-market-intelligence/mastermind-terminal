import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic authentication exists only inside this unit test. No account/session
// is installed, no network is used, and these cases are not production auth proof.
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
import { MARKET_RISK_NOW, riskEnvelopeFixture } from "./marketRiskFixture";

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
