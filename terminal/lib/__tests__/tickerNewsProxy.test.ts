import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET as snapshotGET } from "@/app/api/news/[symbol]/route";
import { GET as storyGET } from "@/app/api/news/stories/[storyId]/route";
import { GET as streamGET } from "@/app/api/news/stream/route";

let realFetch: typeof globalThis.fetch;
let calls: { url: string; init: RequestInit; headers: Record<string, string> }[] = [];

function signedIn(token = "server-session-token") {
  H.session = { access_token: token };
  H.user = { id: "user-1" };
}

function anon() {
  H.session = null;
  H.user = null;
}

function installJson(status = 200, body: unknown = {
  schema: "ticker_news.snapshot.v1",
  ticker: "NVDA",
  security_id: "SEC:US-XNAS-NVDA",
  state: "quiet",
  rows: [],
  next_cursor: null,
  has_more: false,
  source_health: { state: "live" },
}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ url: String(url), init: init ?? {}, headers });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  anon();
  process.env.TICKER_NEWS_API_BASE = "https://macro.test";
  installJson();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TICKER_NEWS_API_BASE;
  vi.restoreAllMocks();
});

describe("ticker news snapshot BFF", () => {
  it("rejects anonymous locally without contacting Macro", async () => {
    anon();
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("forwards only the server-minted bearer and preserves bounded query params", async () => {
    signedIn("minted-real");
    const req = new Request("https://app.test/api/news/NVDA?limit=20&cursor=7", {
      headers: { authorization: "Bearer client-forged" },
    });
    const res = await snapshotGET(req, { params: Promise.resolve({ symbol: "NVDA" }) });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://macro.test/api/ticker-news/NVDA?limit=20&cursor=7");
    expect(calls[0].headers.authorization).toBe("Bearer minted-real");
    expect(calls[0].headers.authorization).not.toContain("client-forged");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses a malformed successful upstream payload as 502", async () => {
    signedIn();
    installJson(200, { schema: "wrong.v1", rows: [] });
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("invalid_upstream_payload");
  });

  it("relays an upstream restricted/unavailable status without inventing access", async () => {
    signedIn();
    installJson(503, { detail: "ticker news rights unavailable" });
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ detail: "ticker news rights unavailable" });
  });
});

describe("story BFF", () => {
  it("uses the minted bearer and percent-encodes the story id", async () => {
    signedIn("story-token");
    installJson(200, {
      schema: "ticker_news.story.v1",
      story_id: "ev2_abc",
      source_count: 0,
      item_count: 0,
      members: [],
    });
    const res = await storyGET(
      new Request("https://app.test/api/news/stories/ev2_abc"),
      { params: Promise.resolve({ storyId: "ev2_abc" }) },
    );
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("https://macro.test/api/ticker-news/stories/ev2_abc");
    expect(calls[0].headers.authorization).toBe("Bearer story-token");
  });
});

describe("SSE BFF", () => {
  it("proxies the authenticated upstream stream without buffering or exposing the bearer", async () => {
    signedIn("sse-token");
    calls = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      calls.push({ url: String(url), init: init ?? {}, headers });
      return new Response('event: upsert\ndata: {"sequence":8}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    }) as unknown as typeof globalThis.fetch;

    const res = await streamGET(
      new Request("https://app.test/api/news/stream?symbol=NVDA&after_sequence=7", {
        headers: { authorization: "Bearer forged" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(calls[0].url).toBe(
      "https://macro.test/api/ticker-news/NVDA/stream?after_sequence=7",
    );
    expect(calls[0].headers.authorization).toBe("Bearer sse-token");
    expect(await res.text()).toContain("event: upsert");
  });

  it("does not contact Macro without a verified session", async () => {
    anon();
    const res = await streamGET(
      new Request("https://app.test/api/news/stream?symbol=NVDA"),
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("returns upstream 503 as JSON instead of an event stream", async () => {
    signedIn();
    calls = [];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ detail: "macro down" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;

    const res = await streamGET(
      new Request("https://app.test/api/news/stream?symbol=NVDA&after_sequence=0"),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ detail: "macro down" });
  });

  it("maps upstream transport failure to gateway_unreachable", async () => {
    signedIn();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "gateway_unreachable" });
  });
});