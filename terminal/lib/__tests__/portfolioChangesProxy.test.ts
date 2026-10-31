import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the portfolio-changes proxy (app/api/portfolio-changes/route.ts).
//
// POST-only pass-through to the macro-api "since your last visit" desk endpoint. With a
// valid Supabase session it injects Authorization: Bearer <token>, forwards the client's
// {previous} digest (sanitized to a plain object or null) and relays the upstream status +
// body VERBATIM. With NO session it 401s locally and never contacts the gateway. There is
// no server cache and no logging: the body is the customer's holdings (TWO-ORGANISMS law).
// ─────────────────────────────────────────────────────────────────────────────

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

import { POST } from "@/app/api/portfolio-changes/route";

type Captured = { url: string; init: RequestInit; headers: Record<string, string>; body: unknown };
let calls: Captured[];
let realFetch: typeof globalThis.fetch;

const CHANGES = {
  schema: "portfolio_changes.v1",
  asof: "2026-10-30",
  first_visit: false,
  changes: [{ kind: "regime", en: "NVDA moved from Trend to Chop.", zh: "NVDA 从趋势转为震荡。", ticker: "NVDA" }],
  state_digest: { names: { NVDA: "chop" } },
  cursor: { scope: "device", note_en: "Marker kept on this device.", note_zh: "标记保存在本设备。" },
};

function installFetchSpy(status = 200, body: unknown = CHANGES) {
  realFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const raw = typeof init?.body === "string" ? init.body : null;
    calls.push({ url: String(url), init: init ?? {}, headers, body: raw === null ? null : JSON.parse(raw) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
}

let ipCounter = 0;
function req(body: string | null = JSON.stringify({ previous: { names: { NVDA: "trend" } } }), extra: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request("https://app.mastermind-x.com/api/portfolio-changes", {
    method: "POST",
    headers: { "cf-connecting-ip": `203.0.113.${ipCounter}`, "content-type": "application/json", ...extra },
    body,
  });
}
const anon = () => { H.session = null; H.user = null; };
const signedIn = (token = "sess-token-abc") => { H.session = { access_token: token }; H.user = { id: "user-1" }; };

beforeEach(() => { installFetchSpy(); anon(); });
afterEach(() => { globalThis.fetch = realFetch; vi.clearAllMocks(); });

describe("anonymous → local 401, gateway never contacted", () => {
  it("no session 401s without calling upstream and never caches", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("signed-in → Bearer injected, previous forwarded, upstream relayed", () => {
  it("posts {previous} with the minted bearer and relays the desk's changes verbatim", async () => {
    signedIn("sess-token-xyz");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/portfolio/changes");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-xyz");
    expect(calls[0].body).toEqual({ previous: { names: { NVDA: "trend" } } });
    expect(await res.json()).toEqual(CHANGES);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("never forwards a client-supplied Authorization header — only the minted one", async () => {
    signedIn("sess-token-real");
    const res = await POST(req(undefined, { authorization: "Bearer client-forged" }));
    expect(res.status).toBe(200);
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-real");
  });

  it("a missing, malformed or non-object previous is sent as null (a first visit, never garbage)", async () => {
    signedIn();
    await POST(req(null));
    await POST(req("{not json"));
    await POST(req(JSON.stringify({ previous: ["names"] })));
    await POST(req(JSON.stringify({ previous: "names" })));
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.body).toEqual({ previous: null });
  });

  it("two identical requests reach the desk twice — there is no server cache", async () => {
    signedIn();
    await POST(req());
    await POST(req());
    expect(calls).toHaveLength(2);
  });
});

describe("status pass-through (macro-api is the Pro authority)", () => {
  it("relays a 403 pro_required verbatim (never gated locally)", async () => {
    installFetchSpy(403, { error: "pro_required", tier: "free" });
    signedIn();
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pro_required", tier: "free" });
  });

  it("relays a 503 ctx_unavailable verbatim", async () => {
    installFetchSpy(503, { error: "ctx_unavailable" });
    signedIn();
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ctx_unavailable" });
  });
});

describe("gateway unreachable → local 503", () => {
  it("a fetch throw becomes a 503 changes_unavailable, not a crash", async () => {
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof globalThis.fetch;
    signedIn();
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "changes_unavailable" });
  });
});
