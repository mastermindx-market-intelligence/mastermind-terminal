import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the alert-prefs BFF (app/api/account/alert-prefs/route.ts).
//
// GET+POST pass-through to macro GET/POST /api/account/prefs. With a valid
// Supabase session it injects Authorization: Bearer <token> and relays the
// upstream status + body VERBATIM. With NO session it 401s locally and never
// contacts the gateway. No response cache (unlike portfolio-brief).
//
// Same idiom as portfolioBriefProxy.test.ts: mock @/lib/supabase/server,
// spy global.fetch to capture outbound url/headers/body, distinct client IP
// per request so the module-global rate-limit buckets never bleed.
//
// R1 (identity mapping): hostile cases mock macro 401 on a bad token, 200 on
// a good one, and 404/503 not-available states. The live round-trip against a
// deployed #6907 is still owed and is disclosed in the PR body under GAPS.
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

import { GET, POST } from "@/app/api/account/alert-prefs/route";

type Captured = { url: string; init: RequestInit; headers: Record<string, string>; body: string | undefined };
let calls: Captured[];
let realFetch: typeof globalThis.fetch;

function installFetchSpy(status = 200, body: unknown = { ok: true, prefs: {} }) {
  realFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({
      url: String(url),
      init: init ?? {},
      headers,
      body: typeof init?.body === "string" ? init.body : init?.body == null ? undefined : String(init.body),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

let ipCounter = 0;
function req(method: "GET" | "POST", extra: Record<string, string> = {}, body?: string): Request {
  ipCounter += 1;
  const ip = `198.51.100.${ipCounter}`;
  return new Request("https://app.mastermind-x.com/api/account/alert-prefs", {
    method,
    headers: { "cf-connecting-ip": ip, ...extra },
    body: method === "POST" ? (body ?? "{}") : undefined,
  });
}

function anon() {
  H.session = null;
  H.user = null;
}
function signedIn(token = "sess-token-abc") {
  H.session = { access_token: token };
  H.user = { id: "user-1" };
}

beforeEach(() => {
  installFetchSpy();
  anon();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.clearAllMocks();
});

describe("anonymous → local 401, macro never contacted", () => {
  it("GET 401s without calling upstream", async () => {
    anon();
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(calls).toHaveLength(0);
  });

  it("POST 401s without calling upstream", async () => {
    anon();
    const res = await POST(req("POST", { "content-type": "application/json" }, JSON.stringify({ alert_email_optin: true })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(calls).toHaveLength(0);
  });
});

describe("identity mapping (R1): session-minted Bearer is the only token forwarded", () => {
  it("signed-in GET forwards Authorization: Bearer <session token> to macro /api/account/prefs, never a client-forged header", async () => {
    installFetchSpy(200, { ok: true, prefs: { alert_email_optin: true }, unset: [], categories_available: ["holdings_material_change", "thesis_window"] });
    signedIn("sess-token-real");
    const res = await GET(req("GET", { authorization: "Bearer client-forged" }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/account/prefs");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-real");
    expect(calls[0].headers["authorization"]).not.toBe("Bearer client-forged");
  });

  it("signed-in POST forwards the same Bearer plus the raw JSON body", async () => {
    installFetchSpy(200, { ok: true, prefs: { alert_email_optin: true }, metadata: true, email_prefs: false });
    signedIn("sess-token-post");
    const payload = JSON.stringify({ alert_email_optin: true });
    const res = await POST(req("POST", {
      "content-type": "application/json",
      authorization: "Bearer client-forged",
    }, payload));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/account/prefs");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-post");
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].body).toBe(payload);
  });

  it("a good session token that macro accepts is relayed as 200", async () => {
    const body = { ok: true, prefs: { tz: "UTC" }, unset: ["quiet_hours"], categories_available: ["holdings_material_change", "thesis_window"] };
    installFetchSpy(200, body);
    signedIn("good-token");
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("a session token that macro rejects is relayed as 401, not presented as signed-out locally beyond the status", async () => {
    installFetchSpy(401, { detail: "invalid token" });
    signedIn("bad-token");
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: "invalid token" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["authorization"]).toBe("Bearer bad-token");
  });
});

describe("macro status + body relayed verbatim", () => {
  it("GET 200 body is byte-for-byte the upstream JSON", async () => {
    const body = {
      ok: true,
      prefs: { alert_email_optin: true, alert_categories: ["holdings_material_change"], tz: "Asia/Shanghai" },
      unset: ["quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    };
    installFetchSpy(200, body);
    signedIn();
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("POST 200 body is relayed verbatim", async () => {
    const body = { ok: true, prefs: { alert_email_optin: true, tz: "UTC" }, metadata: true, email_prefs: false };
    installFetchSpy(200, body);
    signedIn();
    const res = await POST(req("POST", { "content-type": "application/json" }, JSON.stringify({ alert_email_optin: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("macro 400 field-error body is relayed byte-for-byte (detail.field / detail.en / detail.zh)", async () => {
    const body = {
      detail: {
        field: "tz",
        en: "That time zone isn't one we know. Pick one from the list.",
        zh: "无法识别该时区，请从列表中选择。",
      },
    };
    installFetchSpy(400, body);
    signedIn();
    const res = await POST(req("POST", { "content-type": "application/json" }, JSON.stringify({ tz: "Not/AZone" })));
    expect(res.status).toBe(400);
    const got = await res.json();
    expect(got).toEqual(body);
    expect(got.detail.field).toBe("tz");
    expect(got.detail.en).toBe("That time zone isn't one we know. Pick one from the list.");
    expect(got.detail.zh).toBe("无法识别该时区，请从列表中选择。");
  });

  it("macro 404 (pre-deploy, router not mounted) is relayed verbatim", async () => {
    installFetchSpy(404, { detail: "Not Found" });
    signedIn();
    const res = await GET(req("GET"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ detail: "Not Found" });
  });

  it("macro 502 (Supabase Auth outage) is relayed verbatim", async () => {
    installFetchSpy(502, { detail: "auth check failed, please try again" });
    signedIn();
    const res = await GET(req("GET"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: "auth check failed, please try again" });
  });

  it("macro 503 (transient not-available) is relayed verbatim", async () => {
    installFetchSpy(503, { detail: "service unavailable" });
    signedIn();
    const res = await GET(req("GET"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ detail: "service unavailable" });
  });
});

describe("gateway unreachable → local 503, not a 500", () => {
  it("a fetch throw becomes {error: gateway_unreachable}", async () => {
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    signedIn();
    const res = await GET(req("GET"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("gateway_unreachable");
    expect(body.detail).toBe("ECONNREFUSED");
  });

  it("POST fetch throw is the same local 503", async () => {
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof globalThis.fetch;
    signedIn();
    const res = await POST(req("POST", { "content-type": "application/json" }, "{}"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("gateway_unreachable");
  });
});

describe("POST body cap 4 KB → local 413, macro never contacted", () => {
  it("content-length over 4000 is 413 without an upstream call", async () => {
    signedIn();
    const res = await POST(req("POST", {
      "content-type": "application/json",
      "content-length": "5000",
    }, "{}"));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(calls).toHaveLength(0);
  });

  it("an actual body over 4000 bytes is 413 without an upstream call", async () => {
    signedIn();
    const payload = JSON.stringify({ pad: "x".repeat(4100) });
    const res = await POST(req("POST", { "content-type": "application/json" }, payload));
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("rate limit: the 31st call in a window is tooMany", () => {
  it("31 signed-in GETs from one IP: the 31st is 429 and does not contact macro", async () => {
    installFetchSpy(200, { ok: true, prefs: {} });
    signedIn("rate-token");
    const ip = "203.0.113.31";
    const make = () => new Request("https://app.mastermind-x.com/api/account/alert-prefs", {
      method: "GET",
      headers: { "cf-connecting-ip": ip },
    });
    for (let i = 0; i < 30; i++) {
      const res = await GET(make());
      expect(res.status).toBe(200);
    }
    const last = await GET(make());
    expect(last.status).toBe(429);
    const body = await last.json();
    expect(body.error).toBe("rate_limited");
    expect(calls).toHaveLength(30);
  });
});
