import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the portfolio-brief proxy (app/api/portfolio-brief/route.ts).
//
// GET-only pass-through to the macro-api desk endpoint. With a valid Supabase session it
// injects Authorization: Bearer <token> and relays the upstream status + body VERBATIM
// (200 brief / 403 pro_required / 503). With NO session it 401s locally and never contacts
// the gateway (the panel treats 401 as "hidden"). The macro-api is the Pro authority,
// so this route does not gate on is_pro — it just relays.
//
// FRESHNESS — the contract this suite pins: the proxy keeps NO success cache. The producer
// owns freshness: macro's /api/portfolio/brief loads the CURRENT holdings BEFORE it
// consults its own (uid, ctx-file-mtime, holdings-fingerprint) cache. A token-keyed cache in
// front of it serves a brief composed for an EARLIER book, so every authenticated read must
// reach the producer, and the producer's answer must be what the caller sees. A failure
// after a success must never be answered with the earlier body.
//
// Same idiom as brainProxy.test.ts: mock @/lib/supabase/server for session presence,
// spy global.fetch to capture the outbound headers, distinct client IP per test so the
// module-global rate-limit buckets never bleed across cases.
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => {
  return {
    session: null as null | { access_token: string },
    user: null as null | { id: string },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: H.session } }),
      getUser: async () => ({ data: { user: H.user } }),
    },
  }),
}));

import { GET } from "@/app/api/portfolio-brief/route";

type Captured = { url: string; init: RequestInit; headers: Record<string, string> };
let calls: Captured[];
const PRISTINE_FETCH = globalThis.fetch;

// Fake gateway: records the request and returns a configurable status + JSON body.
function installFetchSpy(status = 200, body: unknown = { schema: "portfolio_brief.v1" }) {
  calls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({ url: String(url), init: init ?? {}, headers });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

// A producer whose ANSWER can change between calls while every call is still recorded.
// The freshness tests need the producer to answer A and then B under ONE token, so the
// spy has to survive a changed answer instead of being reinstalled (which would reset
// the call log).
type ProducerState = { status: number; body: unknown; contentType: string | null };
function installMutableProducer(): ProducerState {
  calls = [];
  const state: ProducerState = {
    status: 200,
    body: { schema: "portfolio_brief.v2", asof: "2026-11-02", holdings: ["AAPL"] },
    contentType: "application/json",
  };
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({ url: String(url), init: init ?? {}, headers });
    const responseHeaders: Record<string, string> = {};
    if (state.contentType) responseHeaders["content-type"] = state.contentType;
    // A BYTE body, not a string: the Response constructor stamps "text/plain" on a
    // string body, which would mask the "upstream sent no content-type" case.
    return new Response(new TextEncoder().encode(JSON.stringify(state.body)), {
      status: state.status,
      headers: responseHeaders,
    });
  }) as unknown as typeof globalThis.fetch;
  return state;
}

let ipCounter = 0;
function req(extra: Record<string, string> = {}): Request {
  ipCounter += 1;
  const ip = `198.51.100.${ipCounter}`;
  return new Request("https://app.mastermind-x.com/api/portfolio-brief", {
    method: "GET",
    headers: { "cf-connecting-ip": ip, ...extra },
  });
}

function anon() {
  H.session = null;
  H.user = null;
}
// Every test gets its OWN access token unless it names one. The route used to keep a
// module-level cache keyed by token, so two tests sharing a token shared a cached body —
// that coupling hid real behaviour and made failures depend on test order. Distinct
// tokens keep each case independent.
let tokenCounter = 0;
function signedIn(token?: string): string {
  const t = token ?? `sess-token-${++tokenCounter}`;
  H.session = { access_token: t };
  H.user = { id: "user-1" };
  return t;
}

beforeEach(() => {
  installFetchSpy();
  anon();
});
afterEach(() => {
  globalThis.fetch = PRISTINE_FETCH;
  vi.clearAllMocks();
});

describe("anonymous → local 401, gateway never contacted", () => {
  it("no session 401s without calling upstream", async () => {
    anon();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("signed-in → Bearer injected, upstream 200 relayed", () => {
  it("forwards Authorization: Bearer <token> to the desk endpoint and relays the brief", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v1", asof: "2026-07-23" });
    signedIn("sess-token-xyz");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/portfolio/brief");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-xyz");
    const body = await res.json();
    expect(body.schema).toBe("portfolio_brief.v1");
  });

  it("never forwards a client-supplied Authorization header — only the minted one", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v1" });
    signedIn("sess-token-real");
    const res = await GET(req({ authorization: "Bearer client-forged" }));
    expect(res.status).toBe(200);
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-real");
  });

  it("answers with a private, no-store response so no intermediary may hold the brief", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v1" });
    signedIn();
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("status pass-through (macro-api is the Pro authority)", () => {
  it("relays a 403 pro_required verbatim (never gated locally)", async () => {
    installFetchSpy(403, { error: "pro_required", tier: "free" });
    signedIn();
    const res = await GET(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "pro_required", tier: "free" });
  });

  it("relays a 503 artifact-unavailable verbatim", async () => {
    installFetchSpy(503, { error: "artifact_unavailable" });
    signedIn();
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("passes the upstream content type through unchanged", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v2" });
    signedIn();
    const res = await GET(req());
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("falls back to a JSON content type when the upstream sends none", async () => {
    const producer = installMutableProducer();
    producer.contentType = null;
    signedIn();
    const res = await GET(req());
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

describe("gateway unreachable → local 503 (book below is never blocked)", () => {
  it("a fetch throw becomes a 503, not a crash", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    signedIn();
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("gateway_unreachable");
  });
});

describe("brief freshness: every read returns the producer's CURRENT answer", () => {
  it("returns the producer's second answer for a second call under the SAME token", async () => {
    const producer = installMutableProducer();
    signedIn("sess-token-fresh");

    // First read — the book holds AAPL.
    const first = await GET(req());
    expect(first.status).toBe(200);
    expect((await first.json()).holdings).toEqual(["AAPL"]);
    expect(calls).toHaveLength(1);

    // The book changed and the producer now answers MSFT for the SAME token.
    producer.body = { schema: "portfolio_brief.v2", asof: "2026-11-02", holdings: ["MSFT"] };
    const second = await GET(req());

    expect(second.status).toBe(200);
    expect((await second.json()).holdings).toEqual(["MSFT"]);
    // The proxy holds no success of its own: the producer is consulted every time.
    expect(calls).toHaveLength(2);
  });

  it("does not replay a prior success when the next producer read fails", async () => {
    const producer = installMutableProducer();
    signedIn("sess-token-then-fail");

    const first = await GET(req());
    expect(first.status).toBe(200);
    expect((await first.json()).holdings).toEqual(["AAPL"]);

    producer.status = 503;
    producer.body = { error: "artifact_unavailable" };

    const second = await GET(req());
    expect(second.status).toBe(503);
    expect(await second.json()).toEqual({ error: "artifact_unavailable" });
  });

  it("never claims a proxy-cache hit", async () => {
    const producer = installMutableProducer();
    signedIn("sess-token-diagnostic");

    const first = await GET(req());
    expect(first.headers.get("x-brief-cache")).toBe("miss");

    const second = await GET(req());
    expect(second.headers.get("x-brief-cache")).not.toBe("hit");

    producer.status = 503;
    producer.body = { error: "artifact_unavailable" };
    const third = await GET(req());
    expect(third.headers.get("x-brief-cache")).not.toBe("hit");
  });
});

describe("per-user isolation", () => {
  it("keeps each user's bearer on its own upstream call", async () => {
    installMutableProducer();
    signedIn("sess-token-user-a");
    await GET(req());
    signedIn("sess-token-user-b");
    await GET(req());

    expect(calls).toHaveLength(2);
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-user-a");
    expect(calls[1].headers["authorization"]).toBe("Bearer sess-token-user-b");
  });
});

describe("upstream read is explicitly uncached", () => {
  it("issues the producer read with cache: no-store", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v2" });
    signedIn();
    await GET(req());
    expect(calls[0].init.cache).toBe("no-store");
  });

  it("propagates the client request signal to the producer read", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v2" });
    signedIn();
    const request = req();
    await GET(request);
    expect(calls[0].init.signal).toBe(request.signal);
  });
});

describe("cancellation", () => {
  it("an aborted client request fails through the quiet 503 path", async () => {
    const controller = new AbortController();
    const request = new Request("https://app.mastermind-x.com/api/portfolio-brief", {
      method: "GET",
      headers: { "cf-connecting-ip": "198.51.100.201" },
      signal: controller.signal,
    });
    controller.abort();

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;

    signedIn();
    const res = await GET(request);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("gateway_unreachable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The BOUND contract: `X-Mastermind-Portfolio-Context: snapshot-v1`.
//
// The opt-in selects a RESPONSE CONTRACT, not an authority. This half pins:
//
//   * the header is forwarded to the desk and the desk's answer is REBUILT, not relayed;
//   * the private witness never crosses the boundary — not in a success, not in a
//     failure, not in an exception;
//   * 401 and 403 are classified BEFORE any witness qualification, and both stay
//     observable without a witness or a canonical book key;
//   * an unsupported header value is TOLD, never answered with an ordinary response a
//     caller would read as a witness;
//   * the ORDINARY branch is untouched: the same body, the same status, the same headers.
//
// The witness fixture is the shared synthetic one; the owner id is rewritten to the
// server-verified user id the mocked session carries ("user-1"), because the contract
// compares the witness's owner to THAT and never to a request-supplied value.
// ─────────────────────────────────────────────────────────────────────────────

const BOUND_HEADER = { "X-Mastermind-Portfolio-Context": "snapshot-v1" };

function boundRequest(extra: Record<string, string> = {}): Request {
  return req({ ...BOUND_HEADER, ...extra });
}

/** The shared synthetic witness, with the owner rewritten to the verified session user. */
function boundBody(
  mutate: (body: { portfolio_context: { owner_id: string } }) => void = () => {},
): unknown {
  const body = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "portfolio-brief-context", "witness_book.json"), "utf8"),
  ) as { portfolio_context: { owner_id: string } };
  body.portfolio_context.owner_id = "user-1";
  mutate(body);
  return body;
}

describe("bound mode — the opt-in is forwarded and the answer is rebuilt", () => {
  it("forwards the opt-in header to the desk", async () => {
    installFetchSpy(200, boundBody());
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["x-mastermind-portfolio-context"]).toBe("snapshot-v1");
  });

  it("never forwards a client-supplied Authorization header", async () => {
    installFetchSpy(200, boundBody());
    signedIn("sess-token-real");
    await GET(boundRequest({ authorization: "Bearer client-forged" }));
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-real");
  });

  it("answers with the public brief plus the minimal context — never the witness", async () => {
    installFetchSpy(200, boundBody());
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe("portfolio_brief.v2");
    expect(body.headline.en).toBeTruthy();
    expect(body.context.version).toBe("snapshot-v1");
    expect(body.context.owner).toBe("user-1");
    expect(body.context.population).toBe("positions");
    expect(body.context.bookKey).toMatch(/^[a-f0-9]{64}$/);
    // The witness — the owner's rows, notes and currency receipts — does not cross.
    expect(body.portfolio_context).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("11111111-1111-4111-8111");
    expect(JSON.stringify(body)).not.toContain("entry_currency_basis");
    expect(JSON.stringify(body)).not.toContain("第二笔 加仓");
  });

  it("keeps the answer private and uncached", async () => {
    installFetchSpy(200, boundBody());
    signedIn();
    const res = await GET(boundRequest());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(calls[0].init.cache).toBe("no-store");
  });

  it("the ordinary branch is untouched: no header, the producer's own body", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v2", asof: "2026-11-02" });
    signedIn();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asof).toBe("2026-11-02");
    expect(body.context).toBeUndefined();
    expect(calls[0].headers["x-mastermind-portfolio-context"]).toBeUndefined();
  });
});

describe("bound mode — the entitlement statuses are classified first", () => {
  it("a 401 is observed without a witness or a book key", async () => {
    installFetchSpy(401, { detail: { error: "unauthenticated" } });
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("a 403 is observed as a teaser, with the tier when the producer states one", async () => {
    installFetchSpy(403, { detail: { error: "pro_required", tier: "free" } });
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pro_required", tier: "free" });
  });

  it("a 403 with an unknown tier carries no invented one", async () => {
    installFetchSpy(403, { detail: { error: "pro_required", tier: "platinum" } });
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pro_required" });
  });

  it("a 503 from the desk is an honest unavailable, with a safe body", async () => {
    installFetchSpy(503, { detail: { error: "portfolio_snapshot_unavailable", reason: "count_mismatch" } });
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});

describe("bound mode — an unsupported version is told, never fudged", () => {
  it("refuses an unknown contract version locally and never contacts the desk", async () => {
    installFetchSpy(200, boundBody());
    signedIn();
    const res = await GET(req({ "X-Mastermind-Portfolio-Context": "snapshot-v2" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported_portfolio_context" });
    expect(calls).toHaveLength(0);
  });
});

describe("bound mode — every failure is one fixed safe body", () => {
  it("a witness owned by somebody else never reaches the browser", async () => {
    installFetchSpy(200, boundBody((body) => {
      body.portfolio_context.owner_id = "someone-else@example.com";
    }));
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "portfolio_snapshot_unavailable" });
    expect(JSON.stringify(body)).not.toContain("someone-else");
  });

  it("a malformed upstream body never reaches the browser", async () => {
    installFetchSpy(200, { schema: "portfolio_brief.v2", portfolio_context: { schema: "nope" } });
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "portfolio_snapshot_unavailable" });
  });

  it("a non-JSON upstream body never reaches the browser", async () => {
    installFetchSpy(200, "not json at all");
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "portfolio_snapshot_unavailable" });
  });

  it("a thrown error carrying a sentinel never leaks the sentinel", async () => {
    const sentinel = "SENTINEL-PRIVATE-WITNESS-CONTENT";
    globalThis.fetch = vi.fn(async () => {
      throw new Error(`upstream failed while reading ${sentinel}`);
    }) as unknown as typeof globalThis.fetch;
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "portfolio_snapshot_unavailable" });
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(JSON.stringify(body)).not.toContain("upstream failed");
  });

  it("a malformed witness body carrying a sentinel never leaks the sentinel", async () => {
    const sentinel = "SENTINEL-PRIVATE-WITNESS-CONTENT";
    installFetchSpy(200, {
      schema: "portfolio_brief.v2",
      portfolio_context: { schema: "portfolio_snapshot_witness.v1", owner_id: sentinel },
    });
    signedIn();
    const res = await GET(boundRequest());
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(sentinel);
  });
});
