import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic authentication exists only inside this unit test. No account/session
// is installed, no network is used, and these cases are not production auth proof.
const auth = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn() }));
const currentCookieStore = vi.hoisted(() => {
  const state = { values: [] as { name: string; value: string }[] };
  return { state, getAll: vi.fn(() => state.values) };
});
const limiter = vi.hoisted(() => ({
  rateLimit: vi.fn(() => ({ ok: true, remaining: 59, retryAfterSec: 30 })),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: currentCookieStore.getAll })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: limiter.rateLimit }));
vi.mock("@/lib/upstreams", () => ({ NW_BASE: "https://mastermind-x.com" }));
import { GET } from "@/app/api/sector-intelligence/route";

const AUTH_COOKIE = "sb-fsldfzlxyavsuwqbceod-auth-token.0=base64-part-0; theme=dark";
const request = (source = "sector") => new Request(
  `http://localhost/api/sector-intelligence?source=${source}`,
  { headers: { Cookie: AUTH_COOKIE } },
);

let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  limiter.rateLimit.mockReturnValue({ ok: true, remaining: 59, retryAfterSec: 30 });
  currentCookieStore.state.values = [
    { name: "sb-fsldfzlxyavsuwqbceod-auth-token.0", value: "base64-part-0" },
    { name: "theme", value: "dark" },
  ];
  auth.getUser.mockResolvedValue({ data: { user: { id: "test-owner" } }, error: null });
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "test-owner" }, access_token: "synthetic-unit-token" } },
  });
  upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sector feed owner-failure classification", () => {
  it("separates the owner origin's own 429 from this gateway's per-IP limiter", async () => {
    upstream.mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "42" } }));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("x-sector-failure")).toBe("upstream_rate_limited");
    expect(result.receipt.failure).toBe("upstream_rate_limited");
    expect(result.receipt.status).toBe("error");
    expect(result.data).toBeNull();
  });

  it("invents no Retry-After when the owner origin sent none", async () => {
    upstream.mockResolvedValue(new Response("{}", { status: 429 }));
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect((await response.json()).receipt.failure).toBe("upstream_rate_limited");
  });

  it("relays a Caddy upstream connect error as a reset, not as a generic 5xx", async () => {
    upstream.mockResolvedValue(new Response(
      "upstream connect error or disconnect/reset before headers. reset reason: remote connection failure",
      { status: 502, headers: { "Content-Type": "text/plain" } },
    ));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.failure).toBe("upstream_reset");
    expect(result.receipt.status).toBe("error");
  });

  it("keeps another owner 5xx on the unavailable class", async () => {
    upstream.mockResolvedValue(new Response("{}", { status: 503 }));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(503);
    expect(result.receipt.failure).toBe("upstream_unavailable");
  });

  it("classifies an unreachable owner origin as a transport failure", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.failure).toBe("upstream_transport");
    expect(result.receipt.status).toBe("error");
  });

  it("separates an elapsed owner fetch budget from an unreachable owner origin", async () => {
    vi.useFakeTimers();
    try {
      upstream.mockImplementation((_input: unknown, init: unknown) => new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        const fail = () => reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) fail(); else signal?.addEventListener("abort", fail);
      }));
      const pending = GET(request());
      await vi.advanceTimersByTimeAsync(6000);
      const response = await pending, result = await response.json();
      expect(response.status).toBe(504);
      expect(result.receipt.failure).toBe("upstream_timeout");
    } finally { vi.useRealTimers(); }
  });

  it("labels this gateway's own per-IP limiter distinctly", async () => {
    limiter.rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfterSec: 17 });
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(result.receipt.failure).toBe("rate_limited");
    expect(upstream).not.toHaveBeenCalled();
  });

  // The defect this covers: the owner origin's 429, its 502 upstream-reset, its 503
  // and an unreachable origin all answered HTTP 503 with receipt.status "error" and
  // no Retry-After, so the observed outage could not be told apart from a rate limit.
  it("no longer collapses the owner failure classes into one indistinguishable response", async () => {
    const observed: string[] = [];
    const capture = async () => {
      const response = await GET(request()), result = await response.json();
      observed.push(`${response.status}|${result.receipt.status}|${result.receipt.failure}`);
    };
    upstream.mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "42" } }));
    await capture();
    upstream.mockResolvedValue(new Response("upstream connect error or disconnect/reset before headers.", { status: 502 }));
    await capture();
    upstream.mockResolvedValue(new Response("{}", { status: 503 }));
    await capture();
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    await capture();
    expect(observed).toEqual([
      "429|error|upstream_rate_limited",
      "502|error|upstream_reset",
      "503|error|upstream_unavailable",
      "502|error|upstream_transport",
    ]);
    expect(new Set(observed).size).toBe(observed.length);
  });

  it("classifies a caller that hung up separately from an unreachable owner origin", async () => {
    const aborted = new AbortController();
    aborted.abort();
    upstream.mockImplementation((_input: unknown, init: unknown) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal;
      const fail = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) fail(); else signal?.addEventListener("abort", fail);
    }));
    const req = new Request("http://localhost/api/sector-intelligence?source=sector",
      { headers: { Cookie: AUTH_COOKIE }, signal: aborted.signal });
    const response = await GET(req), result = await response.json();
    expect(response.status).toBe(499);
    expect(result.receipt.failure).toBe("request_aborted");
  });

  it("keeps a rejected owner payload on the invalid class, not on a transport class", async () => {
    upstream.mockResolvedValue(new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.status).toBe("invalid");
    expect(result.receipt.failure).toBe("payload_invalid");
  });

  it("keeps the owner authorization and missing-file classes distinct", async () => {
    upstream.mockResolvedValue(new Response("{}", { status: 403 }));
    const denied = await GET(request());
    expect(denied.status).toBe(403);
    expect((await denied.json()).receipt.failure).toBe("upstream_unauthorized");
    upstream.mockResolvedValue(new Response("{}", { status: 404 }));
    const missing = await GET(request());
    expect(missing.status).toBe(404);
    expect((await missing.json()).receipt.failure).toBe("upstream_not_found");
  });

  it("does not change the ready path or the owner envelope gate", async () => {
    const body = { as_of: "2026-09-25", sectors: [] };
    upstream.mockResolvedValue(Response.json(body));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(200);
    expect(result.data).toEqual(body);
    expect(result.receipt.status).toBe("ready");
    expect(result.receipt.failure).toBeUndefined();
  });
});
