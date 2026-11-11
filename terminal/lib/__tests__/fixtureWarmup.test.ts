import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warmFixtureRoutes } = createRequire(import.meta.url)("../../e2e/fixtureWarmup.cjs");
const BASE = "http://127.0.0.1:31997";
const PROBE = "/api/flow?f=prophet_idx";
const ORIGINAL_ROUTES = [
  "/terminal?symbol=NVDA", "/options", "/portfolio", "/alerts", "/analysis",
  "/discover", "/admin", "/embed/chart?symbol=NVDA", "/login", "/reset-password",
  "/api/me", "/api/watchlist", "/api/layouts", "/api/watchlist/annotations",
];

function fixtureResponse(body: unknown = { schema: "prophet.index/v1", plans: [] }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "X-Flow-Source": "fixture", "Content-Type": "application/json" },
  });
}

function serve(
  probe: (signal: AbortSignal) => Response | Promise<Response>,
  refusedWarmRoute = false,
) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const path = input.slice(BASE.length);
    if (path === PROBE) {
      expect(init?.redirect).toBe("error");
      return probe(init!.signal as AbortSignal);
    }
    if (refusedWarmRoute && path === "/api/watchlist") {
      throw new Error("ordinary warmup unavailable");
    }
    return new Response("route compiled", {
      status: path === "/api/watchlist/annotations" ? 503 : 200,
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function probeCount(fetch: ReturnType<typeof serve>) {
  return fetch.mock.calls.filter(([url]) => url === BASE + PROBE).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fixture startup readiness", () => {
  it("consumes one valid empty-plan fixture after all original route warmups", async () => {
    const fetch = serve(() => fixtureResponse());
    await warmFixtureRoutes(BASE);
    expect(fetch.mock.calls.map(([url]) => url.slice(BASE.length))).toEqual([
      "/login", ...ORIGINAL_ROUTES, PROBE,
    ]);
    expect(probeCount(fetch)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains permissive status and transport handling for ordinary route warmups", async () => {
    const fetch = serve(() => fixtureResponse(), true);
    await warmFixtureRoutes(BASE);
    expect(fetch.mock.calls.map(([url]) => url.slice(BASE.length))).toEqual([
      "/login", ...ORIGINAL_ROUTES, PROBE,
    ]);
    expect(probeCount(fetch)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["HTTP 401", () => new Response("private payload", { status: 401 }), "http_status status=401"],
    ["HTTP 503", () => new Response("private payload", { status: 503 }), "http_status status=503"],
    ["missing provenance", () => new Response("{}"), "fixture_provenance"],
    ["upstream provenance", () => new Response("{}", { headers: { "X-Flow-Source": "upstream" } }), "fixture_provenance"],
    ["malformed JSON", () => new Response("private invalid JSON", { headers: { "X-Flow-Source": "fixture" } }), "malformed_json"],
    ["null", () => fixtureResponse(null), "body_shape"],
    ["array", () => fixtureResponse([]), "body_shape"],
    ["wrong schema", () => fixtureResponse({ schema: "wrong", plans: [] }), "body_shape"],
    ["missing plans", () => fixtureResponse({ schema: "prophet.index/v1" }), "body_shape"],
    ["non-array plans", () => fixtureResponse({ schema: "prophet.index/v1", plans: {} }), "body_shape"],
    ["transport", () => { throw new Error("private transport details"); }, "transport"],
  ] as const)("refuses %s once with a bounded diagnostic", async (_name, response, reason) => {
    const fetch = serve(response);
    const error = await warmFixtureRoutes(BASE).then(
      () => { throw new Error("unexpected success"); },
      (failure: Error) => failure,
    );
    expect(error.message).toContain("[fixture-ready] prophet_idx " + reason);
    expect(error.message).not.toContain("private");
    expect(probeCount(fetch)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a request that never receives headers without retrying", async () => {
    let signal: AbortSignal | undefined;
    const fetch = serve((inputSignal) => {
      signal = inputSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("header abort")), { once: true });
      });
    });
    const rejected = expect(warmFixtureRoutes(BASE)).rejects.toThrow(
      "[fixture-ready] prophet_idx timeout after 25000ms",
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(probeCount(fetch)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the same deadline after headers while the response body is stalled", async () => {
    let signal: AbortSignal | undefined;
    const fetch = serve((inputSignal) => {
      signal = inputSignal;
      const stream = new ReadableStream({
        start(controller) {
          signal!.addEventListener("abort", () => controller.error(new Error("body abort")), { once: true });
        },
      });
      return new Response(stream, { headers: { "X-Flow-Source": "fixture" } });
    });
    const rejected = expect(warmFixtureRoutes(BASE)).rejects.toThrow(
      "[fixture-ready] prophet_idx timeout status=200 after 25000ms",
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(probeCount(fetch)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
