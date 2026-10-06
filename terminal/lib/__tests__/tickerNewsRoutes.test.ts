import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: "session-token" as string | null }));
vi.mock("@/app/api/billing/gateway", () => ({
  billingAuth: vi.fn(async () => (state.token ? { token: state.token } : null)),
}));
vi.mock("@/lib/upstreams", () => ({ ISSUE_DESK_API_BASE: "https://macro.test" }));

import { GET as getSymbol } from "@/app/api/news/[symbol]/route";
import { GET as getStream } from "@/app/api/news/stream/route";
import { GET as getStory } from "@/app/api/news/stories/[storyId]/route";
import { TICKER_NEWS_SNAPSHOT_SCHEMA } from "@/lib/newsContract";
import { parseChanges, parseSnapshot } from "@/lib/newsContract";

let realFetch: typeof globalThis.fetch;
let ip = 0;

const req = (path: string, signal?: AbortSignal) => new Request(`https://app.test${path}`, {
  headers: { "cf-connecting-ip": `203.0.113.${++ip}` },
  signal,
});
const symbolParams = (symbol: string) => ({ params: Promise.resolve({ symbol }) });
const storyParams = (storyId: string) => ({ params: Promise.resolve({ storyId }) });
const json = async (res: Response) => res.json() as Promise<Record<string, unknown>>;

const snapshotBody = (ticker: string, extra: Record<string, unknown> = {}) => ({
  schema: TICKER_NEWS_SNAPSHOT_SCHEMA,
  ticker,
  security_id: `sec:${ticker}`,
  state: "quiet",
  rows: [],
  next_cursor: null,
  has_more: false,
  source_health: { state: "ok" },
  ...extra,
});

beforeEach(() => {
  state.token = "session-token";
  realFetch = globalThis.fetch;
  delete process.env.TERMINAL_E2E_FIXTURE;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("tickerNews routes", () => {
  it("[T01 401-fail-closed] no session returns 401 and fetch is not called on all three routes", async () => {
    state.token = null;
    const spy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = spy;
    expect((await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"))).status).toBe(401);
    expect((await getStream(req("/api/news/stream?symbol=AAPL"))).status).toBe(401);
    expect((await getStory(req("/api/news/stories/story-1"), storyParams("story-1"))).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("[T02 403-passthrough] upstream 403 and 402 preserve detail and status", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "rights denied" }),
      { status: 403, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const forbidden = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(forbidden.status).toBe(403);
    expect(await json(forbidden)).toMatchObject({ error: { code: "forbidden", message: "rights denied" } });

    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "paywall" }),
      { status: 402, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const payment = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(payment.status).toBe(402);
    expect(await json(payment)).toMatchObject({ error: { code: "payment_required", message: "paywall" } });
  });

  it("[T03 bearer+no-store+redirect] token is forwarded and never echoed in the response", async () => {
    const spy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(
      JSON.stringify(snapshotBody("AAPL")),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    globalThis.fetch = spy as unknown as typeof fetch;
    const response = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(response.status).toBe(200);
    const [, init] = spy.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
    expect(init!.cache).toBe("no-store");
    expect(init!.redirect).toBe("error");
    const text = await response.text();
    expect(text).not.toContain("session-token");
    expect(response.headers.get("authorization")).toBeNull();
  });

  it("[T04 previous-symbol-late-response] MSFT snapshot for AAPL request returns 502 invalid_upstream_response", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify(snapshotBody("MSFT")),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const response = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({ error: { code: "invalid_upstream_response" } });
  });

  it("[T09 expired-cursor] upstream 409 and 410 on cursor or after_sequence map to cursor_expired", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "cursor stale" }),
      { status: 409, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const cursor = await getSymbol(req("/api/news/AAPL?cursor=2"), symbolParams("AAPL"));
    expect(cursor.status).toBe(409);
    expect(await json(cursor)).toMatchObject({ error: { code: "cursor_expired" } });

    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "sequence stale" }),
      { status: 410, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const changes = await getSymbol(req("/api/news/AAPL?after_sequence=5"), symbolParams("AAPL"));
    expect(changes.status).toBe(410);
    expect(await json(changes)).toMatchObject({ error: { code: "cursor_expired" } });
  });

  it("[T10 aborted-client] aborted req.signal aborts upstream fetch without throwing from the route", async () => {
    const controller = new AbortController();
    const spy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("Aborted", "AbortError");
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    controller.abort();
    const response = await getSymbol(
      req("/api/news/AAPL", controller.signal),
      symbolParams("AAPL"),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("[T11 rights-restricted] stream upstream 403 returns JSON forbidden, not event-stream", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "forbidden stream" }),
      { status: 403, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const response = await getStream(req("/api/news/stream?symbol=AAPL"));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(await json(response)).toMatchObject({ error: { code: "forbidden" } });
  });

  it("[T12 unavailable-store] upstream 503 maps to unavailable with private no-store cache", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "store down" }),
      { status: 503, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const response = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({ error: { code: "unavailable", retryable: true } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("[T13 rate-limited] upstream 429 copies Retry-After and local rateLimit returns 429", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: "macro limit" }),
      { status: 429, headers: { "content-type": "application/json", "Retry-After": "60" } },
    )) as unknown as typeof fetch;
    const upstreamLimited = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(upstreamLimited.status).toBe(429);
    expect(upstreamLimited.headers.get("Retry-After")).toBe("60");
    expect(await json(upstreamLimited)).toMatchObject({ error: { code: "rate_limited" } });

    const sameIp = "203.0.113.99";
    for (let i = 0; i < 60; i++) {
      globalThis.fetch = vi.fn(async () => new Response(
        JSON.stringify(snapshotBody("AAPL")),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
      await getSymbol(
        new Request("https://app.test/api/news/AAPL", { headers: { "cf-connecting-ip": sameIp } }),
        symbolParams("AAPL"),
      );
    }
    const localLimited = await getSymbol(
      new Request("https://app.test/api/news/AAPL", { headers: { "cf-connecting-ip": sameIp } }),
      symbolParams("AAPL"),
    );
    expect(localLimited.status).toBe(429);
    expect(await json(localLimited)).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("[T15 html-upstream] html snapshot upstream becomes 502 JSON with nosniff", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      "<html></html>",
      { status: 500, headers: { "content-type": "text/html" } },
    )) as unknown as typeof fetch;
    const response = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("[T16 stream-passthrough] event-stream body is returned byte-identical with buffering disabled", async () => {
    const sse = "event: upsert\ndata: {\"sequence\":1}\n\n: heartbeat\n\n";
    globalThis.fetch = vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;
    const response = await getStream(req("/api/news/stream?symbol=AAPL"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(sse);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("[T17 quiet-vs-disconnected] snapshot state and source_health pass through untouched", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify(snapshotBody("AAPL", {
        state: "unavailable",
        source_health: { state: "degraded", reason: "upstream" },
      })),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const response = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    const body = await json(response);
    expect(body.state).toBe("unavailable");
    expect(body.source_health).toEqual({ state: "degraded", reason: "upstream" });
  });

  it("[T18 fixture-mode] fixture routes never call fetch and stream emits upsert, remove, heartbeat", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    const spy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = spy;
    const snapRes = await getSymbol(req("/api/news/AAPL"), symbolParams("AAPL"));
    const snap = await json(snapRes);
    parseSnapshot(snap, "AAPL");
    const changesRes = await getSymbol(req("/api/news/AAPL?after_sequence=0"), symbolParams("AAPL"));
    parseChanges(await json(changesRes), "AAPL");
    const storyRes = await getStory(req("/api/news/stories/story-102"), storyParams("story-102"));
    expect(storyRes.status).toBe(200);
    const streamRes = await getStream(req("/api/news/stream?symbol=AAPL"));
    const streamText = await streamRes.text();
    expect(streamText).toContain("event: upsert");
    expect(streamText).toContain("event: remove");
    expect(streamText).toContain(": heartbeat");
    expect(spy).not.toHaveBeenCalled();
  });

  it("[T19 invalid-symbol] bad symbols and story ids return 400 without fetch", async () => {
    const spy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = spy;
    expect((await getSymbol(req("/api/news/aapl"), symbolParams("aapl"))).status).toBe(400);
    expect((await getSymbol(req("/api/news/AAPL;DROP"), symbolParams("AAPL;DROP"))).status).toBe(400);
    const long = "A".repeat(20);
    expect((await getSymbol(req(`/api/news/${long}`), symbolParams(long))).status).toBe(400);
    expect((await getStory(req("/api/news/stories/bad id"), storyParams("bad id"))).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("[T20 limit-bounds] invalid limits return 400 before upstream", async () => {
    const spy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = spy;
    expect((await getSymbol(req("/api/news/AAPL?limit=0"), symbolParams("AAPL"))).status).toBe(400);
    expect((await getSymbol(req("/api/news/AAPL?limit=201"), symbolParams("AAPL"))).status).toBe(400);
    expect((await getSymbol(req("/api/news/AAPL?after_sequence=0&limit=501"), symbolParams("AAPL"))).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
