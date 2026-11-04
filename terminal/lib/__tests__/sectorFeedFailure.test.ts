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

/** An owner body that starts arriving and then never completes.
 *
 * The headers are already in and the body read is genuinely under way; the
 * pending read only settles when the given signal aborts it. That is the
 * boundary the body-phase classification has to get right: the interruption
 * happens *after* the response resolved, not before it.
 */
function stallingBody(signal: AbortSignal | null | undefined, onRead: () => void) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let sent = false;
  const cut = () => controller?.error(new DOMException("The operation was aborted.", "AbortError"));
  if (signal?.aborted) cut();
  else signal?.addEventListener("abort", cut, { once: true });
  return new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    pull(c) {
      onRead();
      if (sent) return;
      sent = true;
      c.enqueue(new TextEncoder().encode('{"as_of":"2026-09-25"'));
    },
  });
}

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

  it("names an owner 502 without claiming a reset the status does not prove", async () => {
    upstream.mockResolvedValue(new Response(
      "upstream connect error or disconnect/reset before headers. reset reason: remote connection failure",
      { status: 502, headers: { "Content-Type": "text/plain" } },
    ));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.failure).toBe("upstream_bad_gateway");
    expect(result.receipt.status).toBe("error");
    expect(result.data).toBeNull();
  });

  // The counterexample for the defect the root review named: the production
  // branch classified every 502 as a proven reset without ever looking at the
  // body, so an unrelated gateway failure was reported as a proven reset.
  it("does not claim a reset for a generic owner 502 either", async () => {
    upstream.mockResolvedValue(new Response(
      "other gateway failure", { status: 502, headers: { "Content-Type": "text/plain" } },
    ));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.status).toBe("error");
    expect(result.receipt.failure).toBe("upstream_bad_gateway");
    expect(result.receipt.failure).not.toBe("upstream_reset");
    expect(response.headers.get("x-sector-failure")).toBe("upstream_bad_gateway");
    expect(result.data).toBeNull();
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

  // The body-phase boundary the root review named: the headers are already in
  // and the body read has begun when the budget elapses. The inner catch used
  // to answer payload_invalid here and the transport classifier never ran.
  it("classifies a body read interrupted by the elapsed owner fetch budget as a timeout", async () => {
    vi.useFakeTimers();
    try {
      let markReadStarted!: () => void;
      const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
      upstream.mockImplementation(async (_input: unknown, init: unknown) => {
        const signal = (init as RequestInit).signal;
        const body = stallingBody(signal, markReadStarted);
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      });
      const pending = GET(request());
      // The owner response resolved and the body consumption is under way.
      await readStarted;
      await vi.advanceTimersByTimeAsync(6000);
      const response = await pending, result = await response.json();
      expect(response.status).toBe(504);
      expect(result.receipt.status).toBe("error");
      expect(result.receipt.failure).toBe("upstream_timeout");
      expect(response.headers.get("x-sector-failure")).toBe("upstream_timeout");
      expect(result.data).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("classifies a body read interrupted by the caller hanging up as a request abort", async () => {
    const aborted = new AbortController();
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
    upstream.mockImplementation(async (_input: unknown, init: unknown) => {
      const signal = (init as RequestInit).signal;
      const body = stallingBody(signal, markReadStarted);
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const req = new Request("http://localhost/api/sector-intelligence?source=sector",
      { headers: { Cookie: AUTH_COOKIE }, signal: aborted.signal });
    const pending = GET(req);
    await readStarted;
    aborted.abort();
    const response = await pending, result = await response.json();
    expect(response.status).toBe(499);
    expect(result.receipt.status).toBe("error");
    expect(result.receipt.failure).toBe("request_aborted");
    expect(response.headers.get("x-sector-failure")).toBe("request_aborted");
    expect(result.data).toBeNull();
  });

  // The forbidden inference: an abort-shaped exception is not evidence that the
  // request was cancelled. With no recorded deadline and no cancelled caller
  // signal, the interruption stays an unnamed transport failure.
  it("does not infer a cancellation from an abort-shaped body rejection alone", async () => {
    upstream.mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new DOMException("The operation was aborted.", "AbortError")); },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(502);
    expect(result.receipt.status).toBe("error");
    expect(result.receipt.failure).not.toBe("request_aborted");
    expect(result.receipt.failure).not.toBe("upstream_timeout");
    expect(result.receipt.failure).toBe("upstream_transport");
  });

  it("labels this gateway's own per-IP limiter distinctly", async () => {
    limiter.rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfterSec: 17 });
    const response = await GET(request()), result = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(result.receipt.failure).toBe("rate_limited");
    expect(upstream).not.toHaveBeenCalled();
  });

  // The defect this covers: the owner origin's 429, its 502, its 503
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
      "502|error|upstream_bad_gateway",
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
