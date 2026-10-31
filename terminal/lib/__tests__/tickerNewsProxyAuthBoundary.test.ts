import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The authenticated Terminal -> Macro ticker-news proxy boundary.
//
// Companion to `tickerNewsProxy.test.ts`, which pins the happy-path transport (minted bearer
// forwarded, anonymous refused, malformed payload refused, upstream status relayed, flow
// passthrough). This file pins the TRUST DECISIONS that decide whether a request is allowed to
// reach an upstream at all, and is deliberately disjoint from it:
//
//   1. the session/user pair — a session token with no verified user is NOT authentication;
//   2. the trusted-transport gate on the upstream base (HTTPS, or loopback HTTP);
//   3. the mapping of non-JSON / content-type-confused upstream replies;
//   4. that EVERY proxied response — success, refusal, malformed — is private and unindexed;
//   5. the story-id and news|company|all view contracts.
//
// No provider, network or credential is involved: `globalThis.fetch` is replaced in `beforeEach`
// for every case, so a regression that reached the real upstream would surface as an assertion
// failure rather than an outbound request. No Tiingo key, business data or signed-in session is
// used anywhere in this file; the session/user pair is a local stub of `@/lib/supabase/server`.

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

const REVISION = "b".repeat(64);
const SYMBOL = "NVDA";

let realFetch: typeof globalThis.fetch;
let calls: { url: string; headers: Record<string, string> }[] = [];

// Each case gets its own client IP. `rateLimit` buckets by IP in a module-level Map, so a unique
// `cf-connecting-ip` per case makes every case independent of every other — no case can be turned
// into a 429 by the cases that happen to run before it.
let ipCounter = 0;
function clientHeaders(extra: Record<string, string> = {}): Record<string, string> {
  ipCounter += 1;
  return { "cf-connecting-ip": `203.0.113.${ipCounter}`, ...extra };
}

function signedIn(token = "server-minted-token"): void {
  H.session = { access_token: token };
  H.user = { id: "user-1" };
}

/** A session cookie that verifies no user: the "logged out cookie jar" case. */
function tokenWithoutUser(): void {
  H.session = { access_token: "unverified-session-token" };
  H.user = null;
}

function anon(): void {
  H.session = null;
  H.user = null;
}

function editorialView(mode: "news" | "company" | "all", revision = REVISION) {
  return {
    schema: "ticker_news.editorial_view.v1",
    rules: "ticker_news.editorial_rules.v1",
    mode,
    revision,
    name_coverage: "names_and_symbols",
  };
}

function snapshotFixture(extra: Record<string, unknown> = {}) {
  return {
    schema: "ticker_news.snapshot.v1",
    ticker: SYMBOL,
    security_id: "SEC:US-XNAS-NVDA",
    state: "quiet",
    rows: [],
    next_cursor: null,
    has_more: false,
    source_health: { state: "live" },
    ...extra,
  };
}

function storyFixture(extra: Record<string, unknown> = {}) {
  return {
    schema: "ticker_news.story.v1",
    story_id: "ev2_group",
    source_count: 0,
    item_count: 0,
    members: [],
    ...extra,
  };
}

/** Install the upstream stub for one case. Every fetch records its url and headers. */
function installUpstream(
  respond: () => Response,
  base = "https://macro.test",
): void {
  process.env.TICKER_NEWS_API_BASE = base;
  calls = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ url: String(url), headers });
    return respond();
  }) as unknown as typeof globalThis.fetch;
}

function installJson(body: unknown, status = 200, base?: string): void {
  installUpstream(
    () => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
    base,
  );
}

/** Upstream 200 whose body is valid JSON but not the contract. */
function installJsonOk(body: unknown = snapshotFixture(), base?: string): void {
  installJson(body, 200, base);
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  anon();
  process.env.TICKER_NEWS_API_BASE = "https://macro.test";
  installJsonOk();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TICKER_NEWS_API_BASE;
  vi.restoreAllMocks();
});

const snapshot = (url: string, headers: Record<string, string> = {}, symbol = SYMBOL) =>
  snapshotGET(new Request(url, { headers: clientHeaders(headers) }), {
    params: Promise.resolve({ symbol }),
  });

const story = (url: string, headers: Record<string, string> = {}, storyId = "ev2_group") =>
  storyGET(new Request(url, { headers: clientHeaders(headers) }), {
    params: Promise.resolve({ storyId }),
  });

const stream = (url: string, headers: Record<string, string> = {}) =>
  streamGET(new Request(url, { headers: clientHeaders(headers) }));

// ── 1. The session/user pair ────────────────────────────────────────────────────────────────
// A Supabase session cookie alone is not authentication. `sessionToken()` in
// lib/server/tickerNews.ts returns a token only when BOTH a session access_token AND a verified
// user are present; anything less must be a 401 that never reaches the upstream.

describe("ticker news proxy authentication boundary", () => {
  it("refuses a request with no session and no user, and contacts no upstream", async () => {
    anon();
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("refuses a session token with no verified user on the snapshot route", async () => {
    tokenWithoutUser();
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a session token with no verified user on the story route", async () => {
    tokenWithoutUser();
    const res = await story("https://app.test/api/news/stories/ev2_group");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a session token with no verified user on the stream route", async () => {
    tokenWithoutUser();
    const res = await stream("https://app.test/api/news/stream?symbol=NVDA");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a verified user carrying no session token", async () => {
    H.session = null;
    H.user = { id: "user-1" };
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("does not accept a client-supplied Authorization header in place of a session", async () => {
    anon();
    const res = await snapshot("https://app.test/api/news/NVDA", {
      authorization: "Bearer attacker-forged",
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    // The forged value must not appear anywhere in the refusal.
    expect(await res.text()).not.toContain("attacker-forged");
  });

  it("forwards the server-minted bearer and never the client's", async () => {
    signedIn("minted-only");
    installJsonOk();
    const res = await snapshot("https://app.test/api/news/NVDA", {
      authorization: "Bearer client-forged",
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe("Bearer minted-only");
    // No forwarded header may carry the client's credential, including the one that should.
    for (const value of Object.values(calls[0].headers)) {
      expect(value).not.toContain("client-forged");
    }
  });
});

// ── 2. The trusted-transport gate ───────────────────────────────────────────────────────────
// `baseUrl()` admits HTTPS, or plain HTTP only for loopback. Anything else throws
// `ticker_news_proxy:invalid_upstream_base`, which `upstreamFetch` surfaces as a 503 with no
// outbound call. This is what stops a mis-set (or injected) base from downgrading the proxy's
// upstream hop to plaintext against an attacker-chosen host.

describe("ticker news upstream transport trust gate", () => {
  it.each([
    ["plaintext http to a remote host", "http://macro.test"],
    ["a non-http scheme", "ftp://macro.test"],
    ["a javascript: base", "javascript:alert(1)"],
    ["an unparseable base", "not a url at all"],
  ])("fails closed on %s with 503 and zero upstream calls", async (_label, base) => {
    signedIn();
    installJsonOk(snapshotFixture(), base);
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "gateway_unreachable" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["127.0.0.1", "http://127.0.0.1:8080"],
    ["localhost", "http://localhost:8080"],
  ])("admits loopback http on %s for local development", async (_host, base) => {
    signedIn("loopback-token");
    installJsonOk(snapshotFixture(), base);
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith(base)).toBe(true);
    expect(calls[0].headers.authorization).toBe("Bearer loopback-token");
  });

  it("strips query and fragment from the base so they cannot steer the upstream path", async () => {
    signedIn();
    installJsonOk(snapshotFixture(), "https://macro.test/gw/?leak=1#frag");
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("https://macro.test/gw/api/ticker-news/NVDA");
  });
});

// ── 3. Upstream payload / content-type confusion ────────────────────────────────────────────

describe("ticker news upstream payload failures", () => {
  it("refuses a non-JSON 200 upstream body as 502", async () => {
    signedIn();
    installUpstream(() => new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_upstream_payload" });
  });

  it("refuses a JSON 200 body that violates the contract as 502", async () => {
    signedIn();
    installJsonOk({ schema: "wrong.v1", rows: [] });
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_upstream_payload" });
  });

  it("falls back to a safe JSON content type when an upstream error carries none", async () => {
    signedIn();
    // A body with no implied content type (a byte body), so the upstream reply genuinely has none.
    installUpstream(() => new Response(new TextEncoder().encode("upstream said no"), {
      status: 502,
    }));
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("cannot be split by a CRLF-laced upstream content type", async () => {
    signedIn();
    // Duck-typed because Node's Headers would refuse to construct this value — which is the
    // point: the guard in `safeContentType` must hold even for a header an intermediary smuggled.
    const hostile = {
      ok: false,
      status: 502,
      headers: { get: (k: string) => (k === "content-type" ? "text/html\r\nX-Injected: pwned" : null) },
      text: async () => "upstream error",
    } as unknown as Response;
    installUpstream(() => hostile);
    const res = await snapshot("https://app.test/api/news/NVDA");
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-injected")).toBeNull();
  });

  it("refuses a 200 upstream that is not an event stream on the stream route", async () => {
    signedIn();
    installUpstream(() => new Response(JSON.stringify(snapshotFixture()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const res = await stream("https://app.test/api/news/stream?symbol=NVDA");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_upstream_stream" });
  });

  it("refuses an event-stream upstream with no body", async () => {
    signedIn();
    installUpstream(() => new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const res = await stream("https://app.test/api/news/stream?symbol=NVDA");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_upstream_stream" });
  });
});

// ── 4. Response hygiene ─────────────────────────────────────────────────────────────────────
// Ticker news is licensed, per-account data. Every response that leaves the proxy — payload,
// refusal, malformed upstream — must be uncacheable and unindexable, so a shared cache or a
// crawler can never retain it.

describe("ticker news responses are private and unindexed", () => {
  async function responseFor(status: 200 | 400 | 401 | 502 | 503): Promise<Response> {
    if (status === 200) {
      signedIn();
      installJsonOk();
      return snapshot("https://app.test/api/news/NVDA");
    }
    if (status === 400) {
      signedIn();
      installJsonOk();
      return snapshot("https://app.test/api/news/NVDA?view=not-a-mode");
    }
    if (status === 401) {
      anon();
      installJsonOk();
      return snapshot("https://app.test/api/news/NVDA");
    }
    if (status === 502) {
      signedIn();
      installUpstream(() => new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }));
      return snapshot("https://app.test/api/news/NVDA");
    }
    signedIn();
    installJson({ detail: "macro unavailable" }, 503);
    return snapshot("https://app.test/api/news/NVDA");
  }

  it.each([200, 400, 401, 502, 503] as const)(
    "a %i response carries private, no-store, noindex and nosniff",
    async (status) => {
      const res = await responseFor(status);
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, noarchive");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      // The response varies by credential, so any cache must key on Authorization.
      expect(res.headers.get("vary")).toBe("Authorization");
    },
  );
});

// ── 5. Story id contract ────────────────────────────────────────────────────────────────────
// The story id is interpolated into the upstream PATH. It must be validated as an opaque
// `ev2_`-prefixed token before any upstream call, so a crafted id can never traverse or steer it.

describe("ticker news story id validation", () => {
  it.each([
    ["a legacy ev1_ prefix", "ev1_legacy"],
    ["an empty ev2_ suffix", "ev2_"],
    ["a path separator", "ev2_a/b"],
    ["a traversal sequence", "../../etc/passwd"],
    ["an encoded traversal", "ev2_a..%2f..%2fadmin"],
    ["whitespace", "ev2_a b"],
    ["a null byte", "ev2_a\u0000b"],
    ["an over-long id", `ev2_${"a".repeat(300)}`],
  ])("rejects %s with 400 and zero upstream calls", async (_label, storyId) => {
    signedIn();
    installJsonOk(storyFixture({ story_id: storyId }));
    const res = await story("https://app.test/api/news/stories/anything", {}, storyId);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it.each([
    ["ev2_a"],
    ["ev2_a.b_c-9"],
    ["ev2_0123456789"],
  ])("accepts and forwards the opaque story id %s", async (storyId) => {
    signedIn();
    installJsonOk(storyFixture({ story_id: storyId }));
    const res = await story(`https://app.test/api/news/stories/${storyId}`, {}, storyId);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://macro.test/api/ticker-news/stories/${encodeURIComponent(storyId)}`);
  });
});

// ── 6. The news | company | all view matrix ─────────────────────────────────────────────────
// `all` is the Broader mode: a distinct third view, not an alias for `company` and not a
// widening of `news`. Each mode must reach the upstream verbatim, be acknowledged by the payload
// before it is returned, and never be substituted for another mode.

const MODES = ["news", "company", "all"] as const;

describe("ticker news editorial view matrix", () => {
  it.each(MODES)("forwards view=%s verbatim to the snapshot upstream", async (mode) => {
    signedIn();
    installJsonOk(snapshotFixture({ editorial_view: editorialView(mode) }));
    const res = await snapshot(`https://app.test/api/news/NVDA?view=${mode}&view_revision=${REVISION}`);
    expect(res.status).toBe(200);
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("view")).toBe(mode);
    expect(sent.searchParams.get("view_revision")).toBe(REVISION);
    expect((await res.json()).editorial_view.mode).toBe(mode);
  });

  it("treats view=all as the Broader mode rather than narrowing it to company", async () => {
    signedIn();
    installJsonOk(snapshotFixture({ editorial_view: editorialView("all") }));
    const res = await snapshot(`https://app.test/api/news/NVDA?view=all&view_revision=${REVISION}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.editorial_view.mode).toBe("all");
    expect(new URL(calls[0].url).searchParams.get("view")).toBe("all");
  });

  it.each(MODES)("forwards view=%s verbatim to the story upstream with ticker context", async (mode) => {
    signedIn();
    installJsonOk(storyFixture({ editorial_view: editorialView(mode) }));
    const res = await story(
      `https://app.test/api/news/stories/ev2_group?ticker=${SYMBOL}&view=${mode}&view_revision=${REVISION}`,
    );
    expect(res.status).toBe(200);
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("view")).toBe(mode);
    expect(sent.searchParams.get("view_revision")).toBe(REVISION);
    expect((await res.json()).editorial_view.mode).toBe(mode);
  });

  it.each(MODES)("forwards view=%s verbatim to the stream upstream", async (mode) => {
    signedIn();
    installUpstream(() => new Response("event: reset\ndata: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const res = await stream(
      `https://app.test/api/news/stream?symbol=NVDA&view=${mode}&view_revision=${REVISION}`,
    );
    expect(res.status).toBe(200);
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("view")).toBe(mode);
    expect(sent.searchParams.get("view_revision")).toBe(REVISION);
  });

  it.each([
    ["an unknown mode", "broader"],
    ["a case-shifted mode", "ALL"],
    ["a near-miss", "newsroom"],
    ["an empty value", ""],
  ])("rejects %s with 400 and zero upstream calls", async (_label, mode) => {
    signedIn();
    installJsonOk();
    const res = await snapshot(`https://app.test/api/news/NVDA?view=${mode}`);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it.each([
    ["a revision with no view", `?view_revision=${REVISION}`],
    ["a short revision", "?view=all&view_revision=" + "b".repeat(63)],
    ["a non-hex revision", "?view=all&view_revision=" + "z".repeat(64)],
    ["an empty revision", "?view=all&view_revision="],
  ])("rejects %s with 400 and zero upstream calls", async (_label, query) => {
    signedIn();
    installJsonOk();
    const res = await snapshot(`https://app.test/api/news/NVDA${query}`);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects a duplicate view parameter rather than picking one", async () => {
    signedIn();
    installJsonOk();
    const res = await snapshot("https://app.test/api/news/NVDA?view=news&view=all");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each(MODES)("refuses a view=%s request the upstream acknowledges as a different mode", async (mode) => {
    signedIn();
    const acknowledged = mode === "all" ? "company" : "all";
    installJsonOk(snapshotFixture({ editorial_view: editorialView(acknowledged) }));
    const res = await snapshot(`https://app.test/api/news/NVDA?view=${mode}&view_revision=${REVISION}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_upstream_payload" });
  });

  it("refuses a view=request whose payload carries no editorial acknowledgement at all", async () => {
    signedIn();
    installJsonOk(snapshotFixture());
    const res = await snapshot(`https://app.test/api/news/NVDA?view=all&view_revision=${REVISION}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "invalid_upstream_payload" });
  });
});

// ── 7. Stream request validation ────────────────────────────────────────────────────────────

describe("ticker news stream request validation", () => {
  it.each([
    ["no symbol", "https://app.test/api/news/stream"],
    ["an empty symbol", "https://app.test/api/news/stream?symbol="],
    ["an invalid symbol", "https://app.test/api/news/stream?symbol=$%^&*"],
    ["a non-numeric after_sequence", "https://app.test/api/news/stream?symbol=NVDA&after_sequence=abc"],
    ["a negative after_sequence", "https://app.test/api/news/stream?symbol=NVDA&after_sequence=-1"],
    ["a fractional after_sequence", "https://app.test/api/news/stream?symbol=NVDA&after_sequence=1.5"],
  ])("rejects %s with 400 and zero upstream calls", async (_label, url) => {
    signedIn();
    installUpstream(() => new Response("event: reset\ndata: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const res = await stream(url);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("carries the stream framing headers on a proxied event stream", async () => {
    signedIn();
    installUpstream(() => new Response("event: upsert\ndata: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }));
    const res = await stream("https://app.test/api/news/stream?symbol=NVDA");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, noarchive");
  });
});