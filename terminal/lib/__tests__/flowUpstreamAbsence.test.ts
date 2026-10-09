import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true }),
  tooMany: () => new Response("rate limited", { status: 429 }),
}));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions: async () => true }));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({ fetchOptionsAlphaCandidatePair: async () => ({}) }));

import { tryFetchUpstream, tryFetchUpstreamResult } from "@/lib/flowSource";
import { R2_BASE } from "@/lib/upstreams";

// The real upstream reader and route run against a scripted backend and R2. A number is an
// HTTP status, "throw" a refused connection, an object a 200 JSON payload. The macro hub
// backend answers 503 (not 404) for an object it has never read, so only R2's own 404 can
// prove that a payload is unpublished.
type Answer = number | "throw" | Record<string, unknown>;
let realFetch: typeof globalThis.fetch;
let transport: ReturnType<typeof vi.fn>;

function upstreams(backend: Answer, r2: Answer) {
  transport = vi.fn(async (input: RequestInfo | URL) => {
    const answer = String(input).startsWith(R2_BASE) ? r2 : backend;
    if (answer === "throw") throw new TypeError("fetch failed");
    if (typeof answer === "number") return new Response(JSON.stringify({ detail: "scripted" }), { status: answer });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  });
  globalThis.fetch = transport as unknown as typeof globalThis.fetch;
}
const r2Reads = () => transport.mock.calls.filter(([url]) => String(url).startsWith(R2_BASE)).length;

beforeEach(() => {
  realFetch = globalThis.fetch;
  delete process.env.FLOW_FIXTURE;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("tryFetchUpstreamResult: absence is proven, never inferred", () => {
  it("vol: the hub's 503 for a missing object plus R2's 404 is a published absence", async () => {
    upstreams(503, 404);
    expect(await tryFetchUpstreamResult("vol:ZZZ")).toEqual({ status: "absent" });
  });

  it("vol: a refused backend plus R2's 404 is still a published absence", async () => {
    upstreams("throw", 404);
    expect(await tryFetchUpstreamResult("vol:ZZZ")).toEqual({ status: "absent" });
  });

  it.each([503, "throw" as const])("vol: an R2 read that did not land (%s) is unavailable", async (r2) => {
    upstreams(503, r2);
    expect(await tryFetchUpstreamResult("vol:SPY")).toEqual({ status: "unavailable" });
  });

  it("vol: R2 data behind a failed backend is data", async () => {
    upstreams(503, { root: "SPY" });
    expect(await tryFetchUpstreamResult("vol:SPY")).toEqual({ status: "data", data: { root: "SPY" } });
  });

  it("vol: backend data is returned without reading R2", async () => {
    upstreams({ root: "SPY" }, 404);
    expect(await tryFetchUpstreamResult("vol:SPY")).toEqual({ status: "data", data: { root: "SPY" } });
    expect(r2Reads()).toBe(0);
  });

  it.each([404, "throw" as const])("agg: with no backend route, R2's 404 is a published absence (backend %s)", async (backend) => {
    upstreams(backend, 404);
    expect(await tryFetchUpstreamResult("agg:ZZZ")).toEqual({ status: "absent" });
  });

  it("agg: an R2 5xx is unavailable even when the backend says 404", async () => {
    upstreams(404, 503);
    expect(await tryFetchUpstreamResult("agg:SPY")).toEqual({ status: "unavailable" });
  });

  it("ticker: a failed live backend is not explained by an R2 404", async () => {
    upstreams(503, 404);
    expect(await tryFetchUpstreamResult("ticker:SPY")).toEqual({ status: "unavailable" });
  });

  it("ticker: both sources answering 404 is a published absence", async () => {
    upstreams(404, 404);
    expect(await tryFetchUpstreamResult("ticker:ZZZ")).toEqual({ status: "absent" });
  });

  it("prophet_idx never reads R2, so it can never be proven absent", async () => {
    upstreams(404, 404);
    expect(await tryFetchUpstreamResult("prophet_idx")).toEqual({ status: "unavailable" });
    expect(r2Reads()).toBe(0);
  });

  it("tryFetchUpstream keeps its null contract", async () => {
    upstreams(503, 404);
    expect(await tryFetchUpstream("vol:ZZZ")).toBeNull();
    upstreams(503, { root: "SPY" });
    expect(await tryFetchUpstream("vol:SPY")).toEqual({ root: "SPY" });
  });
});

describe("GET /api/flow: a proven absence is a 404, an outage stays a 503", () => {
  const loadGet = async () => (await import("@/app/api/flow/route")).GET;
  const request = (f: string) => new Request(`http://localhost:3108/api/flow?f=${encodeURIComponent(f)}`);
  beforeEach(() => vi.resetModules());

  it("answers 404 with no-store when the payload is not published", async () => {
    upstreams(503, 404);
    const res = await (await loadGet())(request("vol:ZZZ"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not published" });
  });

  it.each([503, "throw" as const])("answers 503 with no-store when R2 could not be read (%s)", async (r2) => {
    upstreams("throw", r2);
    const res = await (await loadGet())(request("vol:SPY"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not remember an absence: a payload published after a 404 is served on the next read", async () => {
    const GET = await loadGet();
    upstreams(503, 404);
    expect((await GET(request("vol:NEW"))).status).toBe(404);
    upstreams(503, { root: "NEW" });
    const res = await GET(request("vol:NEW"));
    expect(res.status).toBe(200);
    expect((await res.json()).root).toBe("NEW");
  });
});
