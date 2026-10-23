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

// ---- Wave B3: the proxy re-serializes the PARSED object (lib/server/tickerNews.ts
// returns Response.json(parse(decoded))), so any flow the parser does not carry is
// silently dropped at the proxy. These pins hold flow through that round trip.

describe("ticker news snapshot BFF — news-flow passthrough (Wave B3)", () => {
  const FLOW_METHOD =
    "distinct reports by source + source_item_id; active status only; " +
    "rights-allowed sources only; UTC calendar days; median of 28 prior days";

  const FLOW_PROVENANCE = {
    velocity_schema: "qbus.news_velocity.v1",
    sources_counted: ["benzinga"],
    status_counted: "active",
    distinct_by: "source + source_item_id",
    story_grouping: "news_cluster_members.cluster_id; a report in no cluster is its own story",
    cluster_policy_version: "qbus_news_cluster.v2",
    windows: {
      reports_24h: "rolling, closed at both ends: [as_of - 24h, as_of]",
      reports_7d: "rolling, closed at both ends: [as_of - 7d, as_of]",
      daily_28d: {
        start_date: "2026-09-14",
        end_date: "2026-10-11",
        unit: "UTC calendar day",
        excludes: "the current UTC day",
        order: "oldest first",
      },
    },
    calculation: { method: FLOW_METHOD, comparison_rule: "flow_compare.v1" },
    time_basis_counts_24h: { published_at: 6, received_at: 1 },
  };

  // Contract section 5 FLOW_OK, verbatim.
  const FLOW_OK = {
    schema: "ticker_news.flow.v1",
    state: "ok",
    reason: null,
    coverage: "complete",
    as_of: "2026-10-12T10:30:00Z",
    reports_24h: 7,
    reports_7d: 21,
    stories_24h: 4,
    median_daily_28d: 2.5,
    daily_counts_28d: [2, 3, 1, 4, 2, 3, 0, 5, 2, 3, 2, 3, 1, 4, 2, 3, 2, 3, 1, 3, 2, 4, 2, 3, 2, 3, 2, 3],
    history_days_observed: 28,
    comparison: "busier",
    provenance: FLOW_PROVENANCE,
  };

  const snapshotWithFlow = (flow?: unknown) => ({
    schema: "ticker_news.snapshot.v1",
    ticker: "NVDA",
    security_id: "SEC:US-XNAS-NVDA",
    state: "quiet",
    rows: [],
    next_cursor: null,
    has_more: false,
    source_health: { state: "live" },
    ...(flow === undefined ? {} : { flow }),
  });

  it("re-serializes a valid flow deep-equal through the parser round trip", async () => {
    signedIn();
    installJson(200, snapshotWithFlow(FLOW_OK));
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flow).toEqual(FLOW_OK);
  });

  it("a malformed flow degrades to the terminal unavailable/malformed flow, never a 502", async () => {
    signedIn();
    installJson(200, snapshotWithFlow({ ...FLOW_OK, state: "weird" }));
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flow: Record<string, unknown> };
    expect(body.flow.state).toBe("unavailable");
    expect(body.flow.reason).toBe("malformed");
  });

  it("an upstream snapshot with no flow key is serialized with flow null (the panel hides the strip for it)", async () => {
    signedIn();
    installJson(200, snapshotWithFlow(undefined));
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // parseTickerNewsSnapshot always carries the typed key, so the proxy body has
    // flow: null. The strip's mount rule treats null as absent (design pin P6).
    expect(Object.prototype.hasOwnProperty.call(body, "flow")).toBe(true);
    expect(body.flow).toBeNull();
  });
});

describe("editorial view transport", () => {
  const revision = "b".repeat(64);
  const metadata = {
    schema: "ticker_news.editorial_view.v1", rules: "ticker_news.editorial_rules.v1",
    mode: "company", revision, name_coverage: "names_and_symbols",
  };

  it("forwards snapshot view and continuation revision without unrelated inputs", async () => {
    signedIn();
    installJson(200, {
      schema: "ticker_news.snapshot.v1", editorial_view: metadata, change_sequence: 31,
      ticker: "NVDA", security_id: "SEC:NVDA", state: "quiet", rows: [],
      next_cursor: null, has_more: false, source_health: { state: "live" },
    });
    const res = await snapshotGET(
      new Request("https://app.test/api/news/NVDA?limit=20&view=company&view_revision=" + revision + "&source=fool"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(res.status).toBe(200);
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("view")).toBe("company");
    expect(sent.searchParams.get("view_revision")).toBe(revision);
    expect(sent.searchParams.has("source")).toBe(false);
    expect((await res.json()).editorial_view).toEqual(metadata);
  });

  it("binds grouped detail to ticker, view and revision", async () => {
    signedIn();
    installJson(200, {
      schema: "ticker_news.story.v1", editorial_view: metadata, story_id: "ev2_group",
      source_count: 0, item_count: 0, members: [],
    });
    const res = await storyGET(
      new Request("https://app.test/api/news/stories/ev2_group?ticker=nvda&view=company&view_revision=" + revision),
      { params: Promise.resolve({ storyId: "ev2_group" }) },
    );
    expect(res.status).toBe(200);
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("ticker")).toBe("NVDA");
    expect(sent.searchParams.get("view")).toBe("company");
    expect(sent.searchParams.get("view_revision")).toBe(revision);
  });

  it("forwards stream context and the explicit reset event unchanged", async () => {
    signedIn();
    const frame = 'event: reset\ndata: {"schema":"ticker_news.reset.v1"}\n\n';
    const fetcher = vi.fn().mockResolvedValue(new Response(frame, {
      headers: { "content-type": "text/event-stream" },
    }));
    globalThis.fetch = fetcher;
    const res = await streamGET(new Request(
      "https://app.test/api/news/stream?symbol=NVDA&after_sequence=29&view=company&view_revision=" + revision,
    ));
    const sent = new URL(String(fetcher.mock.calls[0][0]));
    expect(sent.searchParams.get("view")).toBe("company");
    expect(sent.searchParams.get("view_revision")).toBe(revision);
    expect(await res.text()).toBe(frame);
  });

  it("rejects a filtered detail request without ticker context before upstream access", async () => {
    signedIn();
    const res = await storyGET(
      new Request("https://app.test/api/news/stories/ev2_group?view=company"),
      { params: Promise.resolve({ storyId: "ev2_group" }) },
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("editorial acknowledgement at the proxy boundary", () => {
  const revision = "b".repeat(64);
  const correct = {
    schema: "ticker_news.editorial_view.v1", rules: "ticker_news.editorial_rules.v1",
    mode: "company", revision, name_coverage: "names_and_symbols",
  };
  it.each([
    ["snapshot", undefined],
    ["snapshot", { ...correct, mode: "all" }],
    ["snapshot", { ...correct, revision: "c".repeat(64) }],
    ["story", undefined],
    ["story", { ...correct, mode: "all" }],
    ["story", { ...correct, revision: "c".repeat(64) }],
  ])("rejects missing or wrong %s acknowledgement without returning its payload", async (kind, acknowledgement) => {
    signedIn();
    const isSnapshot = kind === "snapshot";
    installJson(200, isSnapshot ? {
      schema: "ticker_news.snapshot.v1", editorial_view: acknowledgement,
      ticker: "NVDA", security_id: "SEC:NVDA", state: "quiet", rows: [],
      next_cursor: null, has_more: false, source_health: { state: "live" },
    } : {
      schema: "ticker_news.story.v1", editorial_view: acknowledgement, story_id: "ev2_group",
      source_count: 0, item_count: 0, members: [],
    });
    const query = "?ticker=NVDA&view=company&view_revision=" + revision;
    const response = isSnapshot
      ? await snapshotGET(new Request("https://app.test/api/news/NVDA" + query),
        { params: Promise.resolve({ symbol: "NVDA" }) })
      : await storyGET(new Request("https://app.test/api/news/stories/ev2_group" + query),
        { params: Promise.resolve({ storyId: "ev2_group" }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "invalid_upstream_payload" });
  });

  it("rejects a valid snapshot for another ticker", async () => {
    signedIn();
    installJson(200, {
      schema: "ticker_news.snapshot.v1", editorial_view: correct,
      ticker: "MSFT", security_id: "SEC:MSFT", state: "quiet", rows: [],
      next_cursor: null, has_more: false, source_health: { state: "live" },
    });
    const response = await snapshotGET(
      new Request("https://app.test/api/news/NVDA?view=company"),
      { params: Promise.resolve({ symbol: "NVDA" }) },
    );
    expect(response.status).toBe(502);
  });

  it("rejects a valid detail for another story", async () => {
    signedIn();
    installJson(200, {
      schema: "ticker_news.story.v1", editorial_view: correct, story_id: "ev2_other",
      source_count: 0, item_count: 0, members: [],
    });
    const response = await storyGET(
      new Request("https://app.test/api/news/stories/ev2_group?ticker=NVDA&view=company"),
      { params: Promise.resolve({ storyId: "ev2_group" }) },
    );
    expect(response.status).toBe(502);
  });
});
