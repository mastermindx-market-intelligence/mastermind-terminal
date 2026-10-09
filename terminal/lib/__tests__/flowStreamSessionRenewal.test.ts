import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the SSE route through the REAL Supabase server client (@supabase/ssr +
// auth-js), the real billingAuth and the real entitlement owner. Only the cookie
// jar, the network and the process-level producer are stand-ins.
const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  valid: new Set<string>(),
  refreshes: [] as string[],
  meTokens: [] as string[],
  answer: { tier: "pro", features: ["terminal_live_options"] } as unknown,
  detach: null as ReturnType<typeof vi.fn> | null,
  seq: 0,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => { if (value) state.jar.set(name, value); else state.jar.delete(name); },
}) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ isValidF: () => true }));
vi.mock("@/lib/flowBroadcast", () => ({ subscribe: () => state.detach! }));

const SUPABASE = "http://127.0.0.1:54321";
const NOW = 1_800_000_000_000;
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "renewal@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let response: Response | undefined;

function storeSession(access: string, refresh: string, expiresInS: number) {
  const session = { access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: expiresInS, expires_at: Math.floor(Date.now() / 1000) + expiresInS, user };
  state.jar.set("sb-127-auth-token", "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"));
  state.valid.add(access);
}

async function open() {
  const route = await import("../../app/api/flow/stream/route");
  response = await route.GET(new Request("http://localhost/api/flow/stream?f=feed"));
  expect(response.status).toBe(200);
  return response;
}

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubEnv("FLOW_FIXTURE", "0");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test");
  vi.stubEnv("BILLING_GATEWAY_BASE", "http://billing.test");
  state.jar.clear(); state.valid.clear(); state.refreshes = []; state.meTokens = []; state.seq = 0;
  state.answer = { tier: "pro", features: ["terminal_live_options"] };
  state.detach = vi.fn(); response = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (url.pathname === "/auth/v1/user") {
      return state.valid.has(token) ? json(200, user) : json(403, { code: 403, error_code: "session_not_found", msg: "session not found" });
    }
    if (url.pathname === "/auth/v1/token") {
      const spent = JSON.parse(String(init?.body)).refresh_token as string;
      state.refreshes.push(spent);
      const access = `tok-r${++state.seq}`; state.valid.add(access);
      return json(200, { access_token: access, refresh_token: `rt-${state.seq}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    }
    if (url.origin === "http://billing.test" && url.pathname === "/api/me") {
      state.meTokens.push(token);
      return state.valid.has(token) ? json(200, state.answer) : json(401, { error: "unauthorized" });
    }
    throw new Error(`unexpected request ${url.href}`);
  }));
});
afterEach(async () => {
  if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("SSE lifetime renewal through the real Supabase session path", () => {
  it("never spends the browser's refresh token while a stream is open", async () => {
    // The access token enters auth-js's 90 s refresh margin before the second recheck.
    storeSession("tok-open", "rt-open", 140);
    await open();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(state.refreshes).toEqual([]);
    expect(state.meTokens).toEqual(["tok-open", "tok-open", "tok-open"]);
    expect(state.detach).not.toHaveBeenCalled();
  });

  it("ends the stream when the opening token stops verifying instead of renewing it from the cookie", async () => {
    storeSession("tok-open", "rt-open", 140);
    const r = await open();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(state.detach).not.toHaveBeenCalled();
    state.valid.delete("tok-open"); // expired or revoked at Supabase Auth
    await vi.advanceTimersByTimeAsync(45_000);
    expect(state.refreshes).toEqual([]);
    expect(state.detach).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const reader = r.body!.getReader(); await expect(reader.read()).rejects.toThrow(); reader.releaseLock();
  });

  it("a refresh during the opening request is renewed on the refreshed token only", async () => {
    // Inside the opening request a refresh can still set the rotated cookie on the response.
    storeSession("tok-open", "rt-open", 60);
    await open();
    expect(state.refreshes).toEqual(["rt-open"]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(state.refreshes).toEqual(["rt-open"]);
    expect(state.meTokens).toEqual(["tok-r1", "tok-r1", "tok-r1"]);
    expect(state.detach).not.toHaveBeenCalled();
  });

  it("revokes on a lost feature at renewal through the real owner", async () => {
    storeSession("tok-open", "rt-open", 3600);
    await open();
    state.answer = { tier: "essential", features: [] };
    await vi.advanceTimersByTimeAsync(45_000);
    expect(state.detach).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses to open without a verified session", async () => {
    const route = await import("../../app/api/flow/stream/route");
    response = await route.GET(new Request("http://localhost/api/flow/stream?f=feed"));
    expect(response.status).toBe(403); expect(state.meTokens).toEqual([]);
  });
});
