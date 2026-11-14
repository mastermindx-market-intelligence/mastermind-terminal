import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { troughSpecimen } from "../../e2e/prophetTroughSpecimens";
const state = vi.hoisted(() => ({ auth: "ok", token: "test-token", base: "https://macro.test", limited: false }));
vi.mock("@/app/api/billing/gateway", () => ({
  get BILLING_BASE() { return state.base; },
  billingAuthResult: vi.fn(async () => ({ status: state.auth, token: state.token })),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => ({ ok: !state.limited, retryAfterSec: 60 })) }));
import { GET } from "@/app/api/prophet/trough-read/route";
import { TROUGH_DEADLINE_MS, TROUGH_MAX_BYTES } from "../prophetTroughReadServer";
const request = (query = "", signal?: AbortSignal) => new Request(`https://terminal.test/api/prophet/trough-read${query}`, { signal });
beforeEach(() => {
  state.auth = "ok"; state.token = "test-token"; state.base = "https://macro.test"; state.limited = false;
  vi.stubEnv("FLOW_FIXTURE", "0"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "0");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(troughSpecimen())));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });
it("uses the fixed authenticated singleton and private response", async () => {
  const response = await GET(request()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual(troughSpecimen());
  expect(fetch).toHaveBeenCalledWith("https://macro.test/api/prophet/trough-read/v1", expect.objectContaining({ cache: "no-store", redirect: "error", headers: { Accept: "application/json", Authorization: "Bearer test-token" } }));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});
it.each([["denied", 401], ["unavailable", 502]])("auth %s makes no upstream call", async (auth, status) => {
  state.auth = String(auth); expect((await GET(request())).status).toBe(status); expect(fetch).not.toHaveBeenCalled();
});
it("rejects missing token, queries and rate limits before source fetch", async () => {
  state.token = ""; expect((await GET(request())).status).toBe(502);
  expect((await GET(request("?ticker=ADP"))).status).toBe(422);
  state.token = "test-token"; state.limited = true; expect((await GET(request())).status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["http://remote.test", "https://macro.test/path", "https://user:pass@macro.test", "not a URL"])("rejects unsafe origin %s", async base => {
  state.base = base; expect((await GET(request())).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
});
it.each([401, 403, 429, 404, 500])("handles upstream %s without rehosting its body", async status => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ private: "secret" }, { status }));
  const response = await GET(request()); expect(response.status).toBe([401, 403, 429].includes(status) ? status : 503);
  expect(await response.text()).not.toContain("secret");
});
it("rejects malformed, HTML, oversized and unknown-contract bodies", async () => {
  for (const response of [new Response("bad", { headers: { "content-type": "application/json" } }), new Response("<b>secret</b>"), Response.json({ ...troughSpecimen(), may_trade: true }), Response.json({ ...troughSpecimen(), padding: "x".repeat(TROUGH_MAX_BYTES) })]) {
    vi.mocked(fetch).mockResolvedValue(response); const result = await GET(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain("secret");
  }
});
it("rejects unknown nested authority fields", async () => {
  const data = troughSpecimen(); Object.assign(data.tickers.ADP, { may_trade: true });
  vi.mocked(fetch).mockResolvedValue(Response.json(data)); expect((await GET(request())).status).toBe(503);
});
it("bounds a stalled transport and propagates cancellation", async () => {
  vi.useFakeTimers(); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const pending = GET(request()); await vi.advanceTimersByTimeAsync(TROUGH_DEADLINE_MS + 1);
  expect((await pending).status).toBe(503);
  const controller = new AbortController(); controller.abort(); expect((await GET(request("", controller.signal))).status).toBe(503);
});
it("serves the same decoded synthetic fixture only in development fixture mode", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  const response = await GET(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual(troughSpecimen()); expect(fetch).not.toHaveBeenCalled();
});
it("never selects synthetic fixture in production", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); state.auth = "denied";
  expect((await GET(request())).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
});
