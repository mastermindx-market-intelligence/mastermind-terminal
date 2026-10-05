import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the Brain-gateway catch-all proxy
// (app/api/brain/[...path]/route.ts).
//
// The proxy verifies the Supabase session and, when it has one, injects
// `Authorization: Bearer <token>` for the co-located gateway. As of the guest-lane
// change, `GET me` and `POST stream` no longer 401 without a session — they forward
// WITHOUT any Authorization header and let the GATEWAY decide (guest mode on → tier
// "guest"; off → the gateway 401s and we relay that). Every other allowlisted path
// (`threads`, `threads/<id>`, `chart/state`) stays a proxy-side session-required 401.
//
// LOCATION NOTE: this file lives in lib/__tests__/ — terminal/vitest.config.ts includes
// ONLY "lib/__tests__/**/*.test.ts", so a colocated app/api/.../route.test.ts would never
// be collected (same constraint documented in lib/__tests__/lwcAdapter.test.ts).
//
// We mock @/lib/supabase/server to control session presence, and replace global.fetch
// with a spy that records the outbound RequestInit so we can assert exactly which headers
// cross the boundary to the gateway. rateLimit + next/server's NextResponse run for real
// (pure; Node 22 has native Request/Response). Each test uses a DISTINCT client IP so the
// module-global per-IP rate-limit buckets never bleed across cases.
// ─────────────────────────────────────────────────────────────────────────────

// The gateway trusts device headers only when they carry this secret. The route captures
// PROXY_SECRET at MODULE LOAD, and the `import` below is hoisted above top-level statements
// — so a plain `process.env.X = ...` here would run too late. Set it inside vi.hoisted (which
// runs before the hoisted imports) so PROXY_SECRET is non-empty when the route is evaluated.
vi.hoisted(() => {
  process.env.BRAIN_PROXY_SECRET = "test-secret";
});

// Controllable session state for the mocked Supabase server client. Tests flip
// H.session between a real-ish session and null (anonymous).
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

// Imported AFTER the mock + env are in place.
import { GET, POST, PATCH, DELETE } from "@/app/api/brain/[...path]/route";

// A recorded outbound call to the gateway.
type Captured = { url: string; init: RequestInit; headers: Record<string, string> };

let calls: Captured[];
let realFetch: typeof globalThis.fetch;

/** Fake gateway: records the request and returns a benign 200 JSON body. */
function installFetchSpy() {
  realFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const headers: Record<string, string> = {};
    // route always passes a plain object for headers
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({ url: String(url), init: init ?? {}, headers });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

let ipCounter = 0;
/** Build a Request with a UNIQUE client IP (own rate-limit bucket), an mm_aid cookie,
 *  and optional extra headers (e.g. a client-supplied Authorization we must never forward). */
function req(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  extra: Record<string, string> = {},
  body?: string,
  url = "https://app.mastermind-x.com/api/brain",
): Request {
  ipCounter += 1;
  const ip = `203.0.113.${ipCounter}`;
  const headers: Record<string, string> = {
    "cf-connecting-ip": ip, // both clientIp() (rateLimit) and mmIp() read this
    cookie: "mm_aid=aid-123; other=x",
    ...extra,
  };
  return new Request(url, {
    method,
    headers,
    body,
  });
}

/** A GET whose URL carries a query string — the only way to exercise cursor forwarding,
 *  since the route reads it off req.url and not off the path params. */
function getWithQuery(qs: string, extra: Record<string, string> = {}): Request {
  return req("GET", extra, undefined, `https://app.mastermind-x.com/api/brain${qs}`);
}

const params = (...path: string[]) => ({ params: Promise.resolve({ path }) });


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

// ── Anonymous GUEST_OK paths: forwarded WITHOUT Authorization, device headers present ──

describe("anonymous guest lane: GET me", () => {
  it("forwards to the gateway with NO Authorization header, device identity attached", async () => {
    anon();
    const res = await GET(req("GET"), params("me"));

    // Reached the gateway (not a proxy-side 401) and relayed its 200.
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/me");

    // The absolute rule: no Authorization on a guest request.
    expect("authorization" in calls[0].headers).toBe(false);

    // Device-identity headers still ride along for the per-device guest pool.
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
    expect(calls[0].headers["x-mm-ip"]).toBe("203.0.113.1");
    expect(calls[0].headers["x-mm-proxy-secret"]).toBe("test-secret");
  });
});

describe("anonymous guest lane: POST stream", () => {
  it("forwards the body to the gateway with NO Authorization, device identity attached", async () => {
    anon();
    const payload = JSON.stringify({ q: "hello brain" });
    const res = await POST(
      req("POST", { "content-type": "application/json" }, payload),
      params("stream"),
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/stream");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(payload);

    expect("authorization" in calls[0].headers).toBe(false);
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
    expect(calls[0].headers["x-mm-ip"]).toBe("203.0.113.2");
    expect(calls[0].headers["content-type"]).toBe("application/json");
  });

  it("still enforces the body cap for guests (413 before any gateway call)", async () => {
    anon();
    // stream cap is 8MB; advertise more via content-length → rejected pre-fetch.
    const res = await POST(
      req("POST", { "content-length": String(9_000_000) }, "x"),
      params("stream"),
    );
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

// A client-supplied Authorization must NEVER be forwarded (guest path → none at all).
describe("client-supplied Authorization is never laundered", () => {
  it("anonymous stream drops a client Authorization header entirely", async () => {
    anon();
    const res = await POST(
      req("POST", {
        "content-type": "application/json",
        authorization: "Bearer client-forged-token",
      }, "{}"),
      params("stream"),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect("authorization" in calls[0].headers).toBe(false);
  });
});

// ── Anonymous authed-only paths: proxy 401s locally; the gateway is NEVER contacted ──

describe("anonymous authed-only paths → local 401, never forwarded", () => {
  it("GET threads → 401, no gateway call", async () => {
    anon();
    const res = await GET(req("GET"), params("threads"));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("GET threads/<id> → 401, no gateway call", async () => {
    anon();
    const res = await GET(req("GET"), params("threads", "t_42"));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("POST chart/state → 401, no gateway call", async () => {
    anon();
    const res = await POST(
      req("POST", { "content-type": "application/json" }, "{}"),
      params("chart", "state"),
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

// ── Signed-in path unchanged: Bearer injected on every allowlisted path ──

describe("signed-in path: Bearer injected (unchanged behavior)", () => {
  it("GET me forwards Authorization: Bearer <token> + device headers", async () => {
    signedIn("sess-token-abc");
    const res = await GET(req("GET"), params("me"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-abc");
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
  });

  it("GET threads (authed-only) forwards Bearer for a signed-in user", async () => {
    signedIn("sess-token-xyz");
    const res = await GET(req("GET"), params("threads"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/threads");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-xyz");
  });

  it("POST stream forwards Bearer + body for a signed-in user, and NEVER a client-supplied one", async () => {
    signedIn("sess-token-777");
    const payload = JSON.stringify({ q: "hi" });
    const res = await POST(
      req("POST", {
        "content-type": "application/json",
        authorization: "Bearer client-forged-token",
      }, payload),
      params("stream"),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // The proxy's own session Bearer, not the client's forged one.
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-777");
    expect(calls[0].init.body).toBe(payload);
  });
});

// ── Unknown paths still 404 (allowlist unchanged) ──

describe("allowlist unchanged: unknown paths 404 before auth", () => {
  it("GET some/other → 404, no gateway call, regardless of session", async () => {
    anon();
    const res = await GET(req("GET"), params("some", "other"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RUN PLANE (macro PR #3574). The widget re-attaches to a server-side run after a
// dropped connection. All four routes 404'd on the Terminal before this allowlist
// widening, so the live re-attach never worked on this surface.
// ─────────────────────────────────────────────────────────────────────────────

describe("run plane: GET runs/<id> (status)", () => {
  it("signed-in → forwarded with Bearer", async () => {
    signedIn("sess-run-status");
    const res = await GET(req("GET"), params("runs", "r_abc123"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/runs/r_abc123");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-run-status");
  });

  it("anonymous → forwarded with NO Authorization (guest lane), device identity attached", async () => {
    anon();
    const res = await GET(req("GET"), params("runs", "r_guest1"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/runs/r_guest1");
    expect("authorization" in calls[0].headers).toBe(false);
    // The gateway resolves the run's guest owner from these — without them it cannot
    // match the principal that started the run, and every guest resume 404s.
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
    expect(calls[0].headers["x-mm-proxy-secret"]).toBe("test-secret");
  });
});

describe("run plane: GET runs/<id>/stream (resume) forwards the cursor", () => {
  it("forwards ?cursor=N verbatim — dropping it would replay from 0 and double the answer", async () => {
    signedIn("sess-resume");
    const res = await GET(getWithQuery("?cursor=7"), params("runs", "r_xyz", "stream"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://mastermind-x.com/api/brain/runs/r_xyz/stream?cursor=7",
    );
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-resume");
  });

  it("cursor=0 is forwarded explicitly (not dropped as falsy)", async () => {
    signedIn();
    await GET(getWithQuery("?cursor=0"), params("runs", "r_xyz", "stream"));
    expect(calls[0].url).toBe(
      "https://mastermind-x.com/api/brain/runs/r_xyz/stream?cursor=0",
    );
  });

  it("no cursor → no query string; the gateway's own default applies", async () => {
    signedIn();
    await GET(req("GET"), params("runs", "r_xyz", "stream"));
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/runs/r_xyz/stream");
  });

  it("only `cursor` crosses — other query params are discarded", async () => {
    signedIn();
    await GET(
      getWithQuery("?cursor=3&admin=1&user_id=someone-else"),
      params("runs", "r_xyz", "stream"),
    );
    expect(calls[0].url).toBe(
      "https://mastermind-x.com/api/brain/runs/r_xyz/stream?cursor=3",
    );
  });

  it("a malformed cursor is a 400, never a silent replay-from-0", async () => {
    signedIn();
    const res = await GET(getWithQuery("?cursor=abc"), params("runs", "r_xyz", "stream"));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("a negative cursor is a 400 (the digits guard rejects the sign)", async () => {
    signedIn();
    const res = await GET(getWithQuery("?cursor=-1"), params("runs", "r_xyz", "stream"));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("an absurdly long cursor is a 400 (bounds the gateway's int parse)", async () => {
    signedIn();
    const res = await GET(
      getWithQuery(`?cursor=${"9".repeat(40)}`),
      params("runs", "r_xyz", "stream"),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("anonymous → forwarded with NO Authorization: the guest's only recovery path", async () => {
    anon();
    const res = await GET(getWithQuery("?cursor=2"), params("runs", "r_guest2", "stream"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://mastermind-x.com/api/brain/runs/r_guest2/stream?cursor=2",
    );
    expect("authorization" in calls[0].headers).toBe(false);
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
  });

  it("the cursor is only read on the resume path — a thread id of 'stream' gets no query", async () => {
    // `threads/stream` ends with "/stream" too; the resolved-path regex must not treat it
    // as a resume, or a stray param would ride along to an unrelated upstream route.
    signedIn();
    await GET(getWithQuery("?cursor=5"), params("threads", "stream"));
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/threads/stream");
  });
});

describe("run plane: GET runs/active is SESSION-REQUIRED (never guest-eligible)", () => {
  it("signed-in → forwarded with Bearer", async () => {
    signedIn("sess-active");
    const res = await GET(req("GET"), params("runs", "active"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/runs/active");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-active");
  });

  // The invariant: a guest principal is shared by everyone behind one egress IP, so
  // enumerating run ids to it would hand one visitor another's question and answer.
  // The gateway returns [] for guests on purpose; we must not even ask on their behalf.
  it("anonymous → 401, gateway never contacted", async () => {
    anon();
    const res = await GET(req("GET"), params("runs", "active"));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("run plane: POST runs/<id>/cancel (Stop)", () => {
  it("signed-in → forwarded with POST + Bearer", async () => {
    signedIn("sess-cancel");
    const res = await POST(req("POST", { "content-type": "application/json" }, ""), params("runs", "r_stop", "cancel"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/runs/r_stop/cancel");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-cancel");
  });

  it("anonymous → 401 (cleanup, not a recovery path), gateway never contacted", async () => {
    anon();
    const res = await POST(req("POST", { "content-type": "application/json" }, ""), params("runs", "r_stop", "cancel"));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("carries no body, and a stuffed one is 413 before any gateway call", async () => {
    signedIn();
    const res = await POST(
      req("POST", { "content-type": "application/json" }, "z".repeat(1_001)),
      params("runs", "r_stop", "cancel"),
    );
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

// ── The widening must not become an open proxy: method scoping + traversal ──

describe("run plane stays tight", () => {
  it("GET runs/<id>/cancel → 404 (cancel is POST-only)", async () => {
    signedIn();
    const res = await GET(req("GET"), params("runs", "r_x", "cancel"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("POST runs/<id> and POST runs/<id>/stream → 404 (reads are GET-only)", async () => {
    signedIn();
    const a = await POST(req("POST", {}, ""), params("runs", "r_x"));
    expect(a.status).toBe(404);
    const b = await POST(req("POST", {}, ""), params("runs", "r_x", "stream"));
    expect(b.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("POST runs/active → 404 (not a POST target)", async () => {
    signedIn();
    const res = await POST(req("POST", {}, ""), params("runs", "active"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("GET runs → 404 (bare collection is not allowlisted)", async () => {
    signedIn();
    const res = await GET(req("GET"), params("runs"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a traversal run id → 404, gateway never contacted", async () => {
    signedIn();
    const res = await GET(req("GET"), params("runs", ".."));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  // The resolved path is interpolated into the upstream URL, so a "?" inside the id segment
  // would smuggle a query string into the gateway call rather than just being a bad id.
  // Next decodes route params, so a client sending `%3F` lands here as a literal "?".
  it("a run id carrying a query/fragment separator → 404, never interpolated into the URL", async () => {
    signedIn();
    for (const bad of ["abc?admin=1", "abc#frag", "abc%2Fx", "a/b", "."]) {
      const res = await GET(req("GET"), params("runs", bad));
      expect(res.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  // The specific escape this closes: `runs/active?x=1` is not the string "runs/active", so
  // guestOk's exact-match refusal would miss it while its run-read regex matched — handing a
  // guest the enumeration route. The charset guard stops it one layer earlier.
  it("`runs/active?x=1` cannot be smuggled past the runs/active session gate", async () => {
    anon();
    const res = await GET(req("GET"), params("runs", "active?x=1"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a real uuid4().hex run id is accepted (the guard is not too tight)", async () => {
    signedIn();
    const res = await GET(req("GET"), params("runs", "3f2a1b4c5d6e7f8091a2b3c4d5e6f708"));
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      "https://mastermind-x.com/api/brain/runs/3f2a1b4c5d6e7f8091a2b3c4d5e6f708",
    );
  });

  it("an unknown sub-resource under a run → 404", async () => {
    signedIn();
    const res = await GET(req("GET"), params("runs", "r_x", "secrets"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a deeper run path → 404", async () => {
    signedIn();
    const res = await GET(req("GET"), params("runs", "r_x", "stream", "extra"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("PATCH/DELETE never reach a run", async () => {
    signedIn();
    const p = await PATCH(
      req("PATCH", { "content-type": "application/json" }, "{}"),
      params("runs", "r_x"),
    );
    expect(p.status).toBe(404);
    const d = await DELETE(req("DELETE"), params("runs", "r_x"));
    expect(d.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

// ── PATCH (rename) / DELETE threads/<id>: session-required, Bearer injected, tight scope ──

describe("PATCH threads/<id> (rename): session-required", () => {
  it("signed-in → forwarded with PATCH + Bearer + body, client Authorization dropped", async () => {
    signedIn("sess-token-patch");
    const payload = JSON.stringify({ title: "New name" });
    const res = await PATCH(
      req("PATCH", {
        "content-type": "application/json",
        authorization: "Bearer client-forged-token",
      }, payload),
      params("threads", "t_42"),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/threads/t_42");
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.body).toBe(payload);
    // The proxy's own session Bearer, never the client's forged one.
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-patch");
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
  });

  it("anonymous → 401, gateway never contacted (NOT guest-eligible)", async () => {
    anon();
    const res = await PATCH(
      req("PATCH", { "content-type": "application/json" }, JSON.stringify({ title: "x" })),
      params("threads", "t_42"),
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("non-thread path → 404, gateway never contacted", async () => {
    signedIn();
    const res = await PATCH(
      req("PATCH", { "content-type": "application/json" }, JSON.stringify({ title: "x" })),
      params("me"),
    );
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("oversized body → 413 (advertised content-length), gateway never contacted", async () => {
    signedIn();
    const res = await PATCH(
      req("PATCH", {
        "content-type": "application/json",
        "content-length": String(5_000), // cap is 4KB
      }, "x"),
      params("threads", "t_42"),
    );
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("oversized body → 413 (actual body length), gateway never contacted", async () => {
    signedIn();
    const big = "y".repeat(4_001); // one byte over the 4KB cap, no content-length header
    const res = await PATCH(
      req("PATCH", { "content-type": "application/json" }, big),
      params("threads", "t_42"),
    );
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("DELETE threads/<id>: session-required", () => {
  it("signed-in → forwarded with DELETE + Bearer, no body", async () => {
    signedIn("sess-token-del");
    const res = await DELETE(req("DELETE"), params("threads", "t_99"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastermind-x.com/api/brain/threads/t_99");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].headers["authorization"]).toBe("Bearer sess-token-del");
    expect(calls[0].headers["x-mm-aid"]).toBe("aid-123");
  });

  it("anonymous → 401, gateway never contacted (NOT guest-eligible)", async () => {
    anon();
    const res = await DELETE(req("DELETE"), params("threads", "t_99"));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("non-thread path (threads collection) → 404, gateway never contacted", async () => {
    signedIn();
    const res = await DELETE(req("DELETE"), params("threads"));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("thread identifiers cannot change the upstream URL", () => {
  for (const [method, handle] of [["GET", GET], ["PATCH", PATCH], ["DELETE", DELETE]] as const) {
    for (const id of ["t_42?cursor=9", "t_42#ignored", "t_42%2Fstream", "t_42%252Fstream", "t_42\\stream", "t_42 extra", "t_42\n", "线程", "x".repeat(65)]) {
      it(`${method} refuses ${JSON.stringify(id)} before any gateway call`, async () => {
        signedIn();
        const response = await handle(
          req(method, method === "PATCH" ? { "content-type": "application/json" } : {},
            method === "PATCH" ? JSON.stringify({ title: "Rename" }) : undefined),
          params("threads", id),
        );
        expect(response.status).toBe(404);
        expect(calls).toHaveLength(0);
      });
    }
  }
});
