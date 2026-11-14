import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateFixture } from "./prophetCandidatesFixture";
const state = vi.hoisted(() => ({ auth: "ok", limited: false }));
vi.mock("@/app/api/billing/gateway", () => ({ BILLING_BASE: "https://macro.test", billingAuthResult: vi.fn(async () => state.auth === "ok" ? { status: "ok", token: "verified-test-token" } : { status: state.auth }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: !state.limited }) }));
import { GET } from "@/app/api/prophet/candidates/route";
const request = (query = "", signal?: AbortSignal) => new Request(`https://terminal.test/api/prophet/candidates${query}`, { signal });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { state.auth = "ok"; state.limited = false; vi.stubGlobal("fetch", vi.fn(async () => json(candidateFixture()))); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("native candidate read through the actual route", () => {
  it("authenticates before query validation or any private source read", async () => {
    state.auth = "denied";
    const response = await GET(request("?source=other")); expect(response.status).toBe(401); expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });
  it("keeps a failed verifier distinct from denial", async () => {
    state.auth = "unavailable"; expect((await GET(request())).status).toBe(502); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["?ticker=DEMOA", "?market=US", "?source=https://other.test", "?q=technology"])("rejects query overrides: %s", async query => {
    expect((await GET(request(query))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("reads the fixed owner once with verified auth and keeps all candidates", async () => {
    const response = await GET(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body.projection.rows).toHaveLength(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]).toEqual(["https://macro.test/api/prophet/candidates/v1", expect.objectContaining({ cache: "no-store", redirect: "error", headers: { Accept: "application/json", Authorization: "Bearer verified-test-token" } })]);
  });
  it.each([401, 403, 429, 503])("preserves owner status %i and hides its raw error", async status => {
    vi.mocked(fetch).mockResolvedValue(json({ private_detail: "secret" }, status));
    const response = await GET(request()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("secret");
  });
  it("rate-limits before reaching the owner", async () => {
    state.limited = true; expect((await GET(request())).status).toBe(429); expect(fetch).not.toHaveBeenCalled();
  });
  it("withdraws invalid or partial publications instead of showing truncated success", async () => {
    const raw = candidateFixture(); raw.projection.rows.pop();
    for (const invalid of [json(raw), new Response("<html>private detail</html>", { headers: { "Content-Type": "text/html" } }), new Response("broken", { headers: { "Content-Type": "application/json" } })]) {
      vi.mocked(fetch).mockResolvedValue(invalid); const response = await GET(request()); expect(response.status).toBe(502); expect(await response.text()).not.toContain("private detail");
    }
  });
  it("bounds actual bytes even if content length lies", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(" ".repeat(8 * 1024 * 1024 + 1), { headers: { "Content-Type": "application/json", "Content-Length": "1" } }));
    expect((await GET(request())).status).toBe(502);
  });
  it("bounds a hanging read and body cleanup by the same deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }), { headers: { "Content-Type": "application/json" } }));
    const pending = GET(request()); await vi.advanceTimersByTimeAsync(10_001); expect((await pending).status).toBe(503);
  });
  it("honors an already-cancelled caller without starting a source read", async () => {
    const controller = new AbortController(); controller.abort(); expect((await GET(request("", controller.signal))).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
});
