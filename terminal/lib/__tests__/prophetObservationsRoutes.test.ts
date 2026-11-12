import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prophetFixture } from "./prophetObservationsFixture";
const state = vi.hoisted(() => ({ auth: "ok", token: "verified-test-token" }));
vi.mock("@/app/api/billing/gateway", () => ({ BILLING_BASE: "https://macro.test", billingAuthResult: vi.fn(async () => state.auth === "ok" ? { status: "ok", token: state.token } : { status: state.auth }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }) }));
import { GET } from "@/app/api/prophet/observations/route";
const request = (query = "ticker=KO", signal?: AbortSignal) => new Request(`https://terminal.test/api/prophet/observations?${query}`, { signal });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { state.auth = "ok"; vi.stubGlobal("fetch", vi.fn(async () => json(prophetFixture()))); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("the actual single-symbol Prophet private proxy", () => {
  it("verifies authentication before any upstream call", async () => {
    state.auth = "denied"; const result = await GET(request());
    expect(result.status).toBe(401); expect(fetch).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toContain("Cookie");
  });
  it("keeps verifier unavailability distinct from a denied session", async () => {
    state.auth = "unavailable"; expect((await GET(request())).status).toBe(502); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["", "ticker=KO&ticker=WM", "ticker=KO&upstream=https://bad.test", "ticker=../KO", "ticker=ko", "ticker=BTC-USD", "ticker=^GSPC"])("rejects noncanonical query without reaching Macro: %s", async query => {
    expect((await GET(request(query))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the existing owner with the verified token and preserves its source observations", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://macro.test/api/prophet/observations/v1?ticker=KO&limit=50");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer verified-test-token" } });
    const body = await response.json(); expect(body.rows[0].source_visibility).toBe("BEYOND_CAP"); expect(body.authority.buy).toBe(false);
  });
  it("lets the canonical owner enforce entitlement and does not leak its raw refusal", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ detail: "private operator or billing data" }, 403));
    const response = await GET(request()); expect(response.status).toBe(403); expect(await response.text()).not.toContain("private operator");
  });
  it("does not rehost HTML, malformed JSON or wrong-ticker payloads", async () => {
    for (const bad of [new Response("<script>secret()</script>", { headers: { "Content-Type": "text/html" } }), new Response("not json", { headers: { "Content-Type": "application/json" } }), json(prophetFixture("WM"))]) {
      vi.mocked(fetch).mockResolvedValue(bad); const response = await GET(request()); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret");
    }
  });
  it("refuses any observational source that has acquired action authority", async () => {
    const raw = prophetFixture(); raw.authority.buy = true; vi.mocked(fetch).mockResolvedValue(json(raw));
    expect((await GET(request())).status).toBe(502);
  });
  it("bounds actual bytes even when content length is absent or false", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(" ".repeat(128 * 1024 + 1), { headers: { "Content-Type": "application/json", "Content-Length": "1" } }));
    expect((await GET(request())).status).toBe(502);
  });
  it("returns unavailable rather than an empty successful source", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ ...prophetFixture(), status: "UNAVAILABLE", rows: [] }));
    expect((await GET(request())).status).toBe(503);
  });
  it("cancels a hanging owner request within one bounded deadline", async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const pending = GET(request()); await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(503);
  });
  it("honors caller cancellation without exposing any saved private source", async () => {
    const controller = new AbortController(); controller.abort();
    const response = await GET(request("ticker=KO", controller.signal)); expect(response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
});
