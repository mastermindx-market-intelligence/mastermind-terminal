import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import capturedGeneration from "./fixtures/sector_generation.captured.preview.v1.json";
import { nativeSectorEvidence, SECTOR_GENERATION_PATH, SECTOR_GENERATION_PREVIEW_PATH } from "../sectorNativeGeneration";

const AUTH_COOKIE = "sb-fsldfzlxyavsuwqbceod-auth-token.0=base64-part-0; theme=dark; sb-fsldfzlxyavsuwqbceod-auth-token.1=part-1";
const FILTERED_COOKIE = "sb-fsldfzlxyavsuwqbceod-auth-token.0=base64-part-0; sb-fsldfzlxyavsuwqbceod-auth-token.1=part-1";
const request = (source: string, cookie: string | null = AUTH_COOKIE) => new Request(
  `http://localhost/api/sector-intelligence?source=${source}`,
  cookie === null ? undefined : { headers: { Cookie: cookie } },
);
const payload = { as_of: "2026-09-25", sectors: [] };
const OWNER = "https://www.mastermind-x.com";
/** An entitled clone of the captured preview generation: both audience labels
 * flipped, nothing else touched. R4: every successful entitled fixture is a
 * derived clone — the immutable captured preview fixture is never modified. */
const entitledGeneration = () => {
  const data = structuredClone(capturedGeneration);
  data.audience = "entitled";
  data.projection.data.audience = "entitled";
  return data;
};
/** A 403 whose body THROWS if anything reads it: Macro's denial verdict is the
 * status alone, and the step-down must never read (or relay) that body. */
const unreadableDenial = () => new Response(new ReadableStream({
  pull(controller) { controller.error(new Error("the 403 denial body must not be read")); },
}), { status: 403 });
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
  it.each(["accepted", "stale", "degraded"])("keeps the native %s verdict without inferring temporal staleness", async qualification => {
    const data = entitledGeneration();
    data.qualification = data.projection.receipt.qualification = qualification;
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("generation"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data.qualification).toBe(qualification);
    expect(result.receipt.stale).toBe(qualification === "stale");
    expect(nativeSectorEvidence(result).generation?.receipt.qualification).toBe(qualification);
  });

  // Owner 403 is not here on purpose: it is the R2 step-down trigger (and, on
  // both paths, the entitlement envelope) — see the R2/R4 walk suite below.
  it.each([401, 404, 502])("withdraws the native wire on owner HTTP %i with one request and no legacy fallback", async status => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const response = await GET(request("generation"));
    expect(response.status).toBe(status);
    expect((await response.json()).data).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("refuses an entitled representation mislabeled as a ready native feed", async () => {
    const data = structuredClone(capturedGeneration); data.projection.data.audience = "entitled";
    upstream.mockResolvedValue(Response.json(data));
    const response = await GET(request("generation"));
    expect(response.status).toBe(502); expect((await response.json()).receipt.status).toBe("invalid");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("requires the existing caller credential before reading a native generation", async () => {
    expect((await GET(request("generation", null))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

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


describe("the entitled-then-preview generation walk (R2/R4, COO rulings 2026-11-11)", () => {
  const previewWire = () => readFileSync(new URL("./fixtures/sector_generation.captured.preview.v1.json", import.meta.url), "utf8").trimEnd();

  it("entitled 200 makes exactly one owner request", async () => {
    upstream.mockResolvedValue(Response.json(entitledGeneration()));
    const response = await GET(request("generation"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe(OWNER + SECTOR_GENERATION_PATH);
    expect(new Headers((upstream.mock.calls[0][1] as RequestInit).headers).get("cookie")).toBe(FILTERED_COOKIE);
    expect(new Headers((upstream.mock.calls[0][1] as RequestInit).headers).has("authorization")).toBe(false);
    expect(result.receipt).toMatchObject({ source: "generation", path: SECTOR_GENERATION_PATH, status: "ready",
      asOf: capturedGeneration.source_session });
    expect(nativeSectorEvidence(result).generation?.sectors).toHaveLength(11);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("entitled 403 steps down once to the fixed preview path", async () => {
    const raw = previewWire();
    expect(createHash("sha256").update(raw).digest("hex")).toBe("3e275fc69d22e990f81261c8a803576a832be9332484c7a99b2dddd165a5d425");
    upstream.mockResolvedValueOnce(unreadableDenial())
      .mockResolvedValueOnce(new Response(raw, { headers: { "Content-Type": "application/json" } }));
    const response = await GET(request("generation"));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    // Order asserted: entitled first, the fixed preview path second — never
    // preview first, never the same path twice, never a third request.
    expect(String(upstream.mock.calls[0][0])).toBe(OWNER + SECTOR_GENERATION_PATH);
    expect(String(upstream.mock.calls[1][0])).toBe(OWNER + SECTOR_GENERATION_PREVIEW_PATH);
    // Both requests carry the same computed-once filtered cookie, no bearer.
    for (const call of upstream.mock.calls) {
      expect(new Headers((call[1] as RequestInit).headers).get("cookie")).toBe(FILTERED_COOKIE);
      expect(new Headers((call[1] as RequestInit).headers).has("authorization")).toBe(false);
    }
    // The member keeps the preview document, receipted on the preview path.
    expect(result.data).toEqual(capturedGeneration);
    expect(result.receipt).toMatchObject({ source: "generation", path: SECTOR_GENERATION_PREVIEW_PATH, status: "ready",
      asOf: capturedGeneration.source_session, stale: false,
      contentHash: createHash("sha256").update(raw).digest("hex") });
    expect(nativeSectorEvidence(result).generation?.sectors).toHaveLength(11);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("SF-1: the unread 403 denial body is cancelled, never read, before request 2", async () => {
    const raw = previewWire();
    // The denial body is a real, permanently-idle stream (pull never enqueues),
    // so only a CANCEL can end it — and the spy on the stream's own cancel
    // method observes the release whatever the runtime wraps around the body.
    // That the route never READS the denial is proven one test up and in the
    // both-paths test: their denial bodies throw on any read, and the walk
    // only completes because nothing ever pulls a byte of them.
    const body = new ReadableStream({ pull() { /* idle forever: no verdict byte exists */ } });
    const cancelSpy = vi.spyOn(body, "cancel");
    upstream.mockResolvedValueOnce(new Response(body, { status: 403 }))
      .mockResolvedValueOnce(new Response(raw, { headers: { "Content-Type": "application/json" } }));
    const response = await GET(request("generation"));
    const result = await response.json();
    expect(response.status).toBe(200);
    // The unread denial body was cancelled exactly once, releasing its socket.
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    // The walk itself is unchanged: request 2 still goes to the fixed preview
    // path, and the member still keeps the preview document.
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[0][0])).toBe(OWNER + SECTOR_GENERATION_PATH);
    expect(String(upstream.mock.calls[1][0])).toBe(OWNER + SECTOR_GENERATION_PREVIEW_PATH);
    expect(result.data).toEqual(capturedGeneration);
    expect(result.receipt).toMatchObject({ source: "generation", path: SECTOR_GENERATION_PREVIEW_PATH, status: "ready" });
  });

  it("SF-1 class: a non-2xx owner exit releases the unread owner body", async () => {
    // The owner body is a real, permanently-idle stream: only a cancel or the
    // finally's controller abort can end it. Non-2xx exits classify on the
    // status alone — the body is never read — and the cancel fires once.
    const body = new ReadableStream({ pull() { /* idle forever: the refusal body does not exist yet */ } });
    const cancelSpy = vi.spyOn(body, "cancel");
    upstream.mockResolvedValueOnce(new Response(body, { status: 502 }));
    const response = await GET(request("generation"));
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.failure).toBe("upstream_bad_gateway");
    expect(result.data).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe(OWNER + SECTOR_GENERATION_PATH);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("403 on both paths is the only subscription cause", async () => {
    upstream.mockResolvedValueOnce(unreadableDenial()).mockResolvedValueOnce(unreadableDenial());
    const response = await GET(request("generation"));
    const result = await response.json();
    expect(response.status).toBe(403);
    expect(result.data).toBeNull();
    expect(result.receipt).toEqual({ source: "generation", path: SECTOR_GENERATION_PREVIEW_PATH, status: "access",
      asOf: null, observedAt: null, stale: false, contentHash: null, failure: "entitlement_required" });
    expect(response.headers.get("x-sector-failure")).toBe("entitlement_required");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("no failure of the entitled read other than 403 ever asks for preview", async () => {
    const arms: Array<[name: string, arm: () => void, status: number, cause: string]> = [
      ["owner 401", () => upstream.mockResolvedValueOnce(new Response(null, { status: 401 })), 401, "upstream_unauthorized"],
      ["owner 404", () => upstream.mockResolvedValueOnce(new Response(null, { status: 404 })), 404, "upstream_not_found"],
      ["owner 429", () => upstream.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "1" } })), 429, "upstream_rate_limited"],
      ["owner 500", () => upstream.mockResolvedValueOnce(new Response(null, { status: 500 })), 503, "upstream_unavailable"],
      ["owner 502", () => upstream.mockResolvedValueOnce(new Response(null, { status: 502 })), 502, "upstream_bad_gateway"],
      ["owner 504", () => upstream.mockResolvedValueOnce(new Response(null, { status: 504 })), 503, "upstream_unavailable"],
      ["redirect", () => upstream.mockResolvedValueOnce(new Response("untrusted", { status: 302, headers: { location: "https://example.invalid" } })), 503, "upstream_unavailable"],
      ["html", () => upstream.mockResolvedValueOnce(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } })), 502, "payload_invalid"],
      ["malformed JSON", () => upstream.mockResolvedValueOnce(new Response("{broken", { headers: { "Content-Type": "application/json" } })), 502, "payload_invalid"],
      ["declared oversize", () => upstream.mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(4 * 1024 * 1024 + 1) } })), 502, "payload_invalid"],
      ["transport error", () => upstream.mockRejectedValueOnce(new TypeError("fetch failed")), 502, "upstream_transport"],
      ["audience mismatch (preview document on the entitled path)",
        () => upstream.mockResolvedValueOnce(new Response(previewWire(), { headers: { "Content-Type": "application/json" } })), 502, "payload_invalid"],
    ];
    for (const [name, arm, status, cause] of arms) {
      upstream.mockReset();
      arm();
      const response = await GET(request("generation"));
      const result = await response.json();
      expect(response.status, name).toBe(status);
      expect(result.data, name).toBeNull();
      expect(result.receipt.failure, name).toBe(cause);
      expect(result.receipt.failure, name).not.toBe("entitlement_required");
      // Exactly one owner request: an outage must never wear the paywall's
      // face, and never hand a paying member the preview as consolation.
      expect(upstream, name).toHaveBeenCalledTimes(1);
      expect(String(upstream.mock.calls[0][0]), name).toBe(OWNER + SECTOR_GENERATION_PATH);
    }
  });

  it("failures of the preview read after a step-down keep their own cause", async () => {
    const arms: Array<[name: string, arm: () => void, status: number, cause: string]> = [
      ["owner 401", () => upstream.mockResolvedValueOnce(new Response(null, { status: 401 })), 401, "upstream_unauthorized"],
      ["owner 404", () => upstream.mockResolvedValueOnce(new Response(null, { status: 404 })), 404, "upstream_not_found"],
      ["owner 429", () => upstream.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "1" } })), 429, "upstream_rate_limited"],
      ["owner 500", () => upstream.mockResolvedValueOnce(new Response(null, { status: 500 })), 503, "upstream_unavailable"],
      ["owner 502", () => upstream.mockResolvedValueOnce(new Response(null, { status: 502 })), 502, "upstream_bad_gateway"],
      ["owner 504", () => upstream.mockResolvedValueOnce(new Response(null, { status: 504 })), 503, "upstream_unavailable"],
      ["redirect", () => upstream.mockResolvedValueOnce(new Response("untrusted", { status: 302, headers: { location: "https://example.invalid" } })), 503, "upstream_unavailable"],
      ["html", () => upstream.mockResolvedValueOnce(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } })), 502, "payload_invalid"],
      ["malformed JSON", () => upstream.mockResolvedValueOnce(new Response("{broken", { headers: { "Content-Type": "application/json" } })), 502, "payload_invalid"],
      ["declared oversize", () => upstream.mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(4 * 1024 * 1024 + 1) } })), 502, "payload_invalid"],
      ["transport error", () => upstream.mockRejectedValueOnce(new TypeError("fetch failed")), 502, "upstream_transport"],
      ["audience mismatch (entitled document on the preview path)", () => upstream.mockResolvedValueOnce(Response.json(entitledGeneration())), 502, "payload_invalid"],
    ];
    for (const [name, arm, status, cause] of arms) {
      upstream.mockReset();
      upstream.mockResolvedValueOnce(unreadableDenial());
      arm();
      const response = await GET(request("generation"));
      const result = await response.json();
      expect(response.status, name).toBe(status);
      expect(result.data, name).toBeNull();
      expect(result.receipt.failure, name).toBe(cause);
      expect(result.receipt.failure, name).not.toBe("entitlement_required");
      expect(upstream, name).toHaveBeenCalledTimes(2);
      expect(String(upstream.mock.calls[0][0]), name).toBe(OWNER + SECTOR_GENERATION_PATH);
      expect(String(upstream.mock.calls[1][0]), name).toBe(OWNER + SECTOR_GENERATION_PREVIEW_PATH);
    }
  });

  it("hostile browser parameters cannot choose the audience", async () => {
    const hostile = [
      "generation&audience=preview",
      "generation&audience=entitled",
      "generation&url=https://untrusted.test",
      "generation&path=%2Fapi%2Fsector-generation%3Faudience%3Dpreview",
      "generation&audience=preview&audience=entitled",
    ];
    for (const source of hostile) {
      upstream.mockReset();
      upstream.mockResolvedValueOnce(Response.json(entitledGeneration()));
      const response = await GET(request(source));
      expect(response.status, source).toBe(200);
      expect(upstream, source).toHaveBeenCalledTimes(1);
      expect(String(upstream.mock.calls[0][0]), source).toBe(OWNER + SECTOR_GENERATION_PATH);
    }
  });

  it("cross-bound documents are dropped", async () => {
    // Direction 1: a preview document (with rows planted in an entitled-only
    // block) answered 200 on the fixed ENTITLED path.
    const previewWithRows = structuredClone(capturedGeneration) as typeof capturedGeneration & {
      projection: { data: Record<string, unknown> } };
    previewWithRows.projection.data.typed_blocks = { theme_rows: { status: "available", reason: null,
      value: [{ id: "LEAK-PREVIEW-ROW" }] } };
    upstream.mockResolvedValueOnce(new Response(JSON.stringify(previewWithRows), { headers: { "Content-Type": "application/json" } }));
    let response = await GET(request("generation"));
    let body = await response.json();
    expect(response.status).toBe(502);
    expect(body.data).toBeNull();
    expect(body.receipt.status).toBe("invalid");
    expect(JSON.stringify(body)).not.toContain("LEAK-PREVIEW-ROW");
    expect(upstream).toHaveBeenCalledTimes(1);
    // Direction 2: an entitled document answered 200 on the fixed PREVIEW
    // path after a lawful step-down.
    const entitledWithRows = entitledGeneration() as ReturnType<typeof entitledGeneration> & {
      projection: { data: Record<string, unknown> } };
    entitledWithRows.projection.data.typed_blocks = { theme_rows: { status: "available", reason: null,
      value: [{ id: "LEAK-ENTITLED-ROW" }] } };
    upstream.mockReset();
    upstream.mockResolvedValueOnce(unreadableDenial())
      .mockResolvedValueOnce(new Response(JSON.stringify(entitledWithRows), { headers: { "Content-Type": "application/json" } }));
    response = await GET(request("generation"));
    body = await response.json();
    expect(response.status).toBe(502);
    expect(body.data).toBeNull();
    expect(body.receipt.status).toBe("invalid");
    expect(JSON.stringify(body)).not.toContain("LEAK-ENTITLED-ROW");
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).toBe(OWNER + SECTOR_GENERATION_PREVIEW_PATH);
  });

  it("caller abort between the two requests starts no second request", async () => {
    const controller = new AbortController();
    const req = new Request("http://localhost/api/sector-intelligence?source=generation",
      { headers: { Cookie: AUTH_COOKIE }, signal: controller.signal });
    upstream.mockImplementationOnce(async () => { controller.abort(); return unreadableDenial(); });
    const response = await GET(req);
    const result = await response.json();
    expect(response.status).toBe(499);
    expect(result.receipt.failure).toBe("request_aborted");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("the shared deadline bounds both requests", async () => {
    vi.useFakeTimers();
    try {
      upstream.mockImplementationOnce(() => Promise.resolve(unreadableDenial()))
        .mockImplementationOnce((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })));
      const pending = GET(request("generation"));
      // The one timer started before owner request 1 fires while owner
      // request 2 is in flight: the deadline spans the whole walk.
      await vi.advanceTimersByTimeAsync(6_000);
      const response = await pending;
      const result = await response.json();
      expect(response.status).toBe(504);
      expect(result.receipt.failure).toBe("upstream_timeout");
      expect(upstream).toHaveBeenCalledTimes(2);
      expect(String(upstream.mock.calls[1][0])).toBe(OWNER + SECTOR_GENERATION_PREVIEW_PATH);
    } finally { vi.useRealTimers(); }
  });

  it("a timed-out entitled read never asks for preview", async () => {
    vi.useFakeTimers();
    try {
      upstream.mockImplementationOnce((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })));
      const pending = GET(request("generation"));
      await vi.advanceTimersByTimeAsync(6_000);
      const response = await pending;
      const result = await response.json();
      expect(response.status).toBe(504);
      expect(result.receipt.failure).toBe("upstream_timeout");
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
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
