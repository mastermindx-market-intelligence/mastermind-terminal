import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const m = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ status: "ok", token: "actual-session-token" })),
  origin: "https://www.mastermind-x.com",
  rate: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/app/api/billing/gateway", () => ({ billingAuthResult: m.auth, get BILLING_BASE() { return m.origin; } }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: m.rate, tooMany: () => new Response("rate limited", { status: 429 }) }));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ isValidF: vi.fn(), fixtureFor: vi.fn(), attachFlowScores: vi.fn(), tryFetchUpstream: vi.fn(), tryFetchUpstreamResult: vi.fn() }));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({ fetchOptionsAlphaCandidatePair: vi.fn() }));
const raw = new TextEncoder().encode(' {"root":"SPY", "matrix":"精确"}\n');
const selection = new TextEncoder().encode('{ "primary": "native-checks-this" }');
const digest = createHash("sha256").update(raw).digest("hex");
const version = `sha256:${digest}:bytes:${raw.length}:session:2026-10-12`;
const query = new URLSearchParams({ f: "matrix:SPY", matrix_delivery: "exact-v1", version_ref: version, fingerprint: digest });
const fetcher = vi.fn();
function request(extra: RequestInit = {}, params = query): Request {
  return new Request("http://localhost/api/flow?"+params, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: selection, ...extra });
}
async function post(req = request()) { return (await import("@/app/api/flow/route")).POST(req); }
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher); m.origin = "https://www.mastermind-x.com"; fetcher.mockReset(); delete process.env.FLOW_FIXTURE; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.FLOW_FIXTURE; });
describe("actual Next POST source path", () => {
  it("authenticates before capture, posts exact selection to fixed Macro authority and returns exact bytes", async () => {
    const order: string[] = [];
    m.auth.mockImplementationOnce(async () => { order.push("auth"); return { status: "ok", token: "actual-session-token" }; });
    fetcher.mockImplementationOnce(async () => { order.push("r2"); return new Response(raw); })
      .mockImplementationOnce(async () => { order.push("macro"); return new Response(raw, { headers: { "Content-Type": "application/json" } }); });
    const response = await post(); expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(raw);
    expect(order).toEqual(["auth", "r2", "macro"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [r2, macro] = fetcher.mock.calls;
    expect(r2[0]).toContain(`/options_structure/matrix/history/SPY/${digest}.json`);
    expect(r2[1].headers).not.toHaveProperty("Authorization");
    expect(new URL(macro[0]).origin).toBe("https://www.mastermind-x.com");
    expect(new URL(macro[0]).pathname).toBe("/api/options/matrix/display/SPY");
    expect([...new URL(macro[0]).searchParams.keys()].sort()).toEqual(["fingerprint", "version_ref"]);
    expect(macro[1]).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
    expect(macro[1].headers.Authorization).toBe("Bearer actual-session-token");
    expect(macro[1].body).toEqual(selection);
  });
  it.each(["denied", "unavailable"])("%s session never captures or calls Macro", async status => {
    m.auth.mockResolvedValueOnce({ status, token: "" });
    const r = await post(); expect(r.status).toBe(status === "denied" ? 401 : 503); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["https://evil.invalid", "http://127.0.0.1:8000", "https://www.mastermind-x.com/other", "https://user:pass@www.mastermind-x.com"])("rejects unqualified origin %s", async origin => {
    m.origin = origin; expect((await post()).status).toBe(503); expect(m.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["policy", "vendor", "duplicate"])("rejects browser authority/ambiguity %s", async key => {
    const params = new URLSearchParams(query); params.append(key === "duplicate" ? "fingerprint" : key, digest);
    expect((await post(request({}, params))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not grant fixture fallback or skip authentication", async () => {
    process.env.FLOW_FIXTURE = "1"; fetcher.mockRejectedValue(Error("no retained source"));
    expect((await post()).status).toBe(503); expect(m.auth).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["body", "length", "encoding", "type", "redirect", "refusal"])("cannot emit altered/mismatched Macro response: %s", async defect => {
    fetcher.mockResolvedValueOnce(new Response(raw));
    const changed = Uint8Array.from(raw); changed[0] = 10;
    const response = new Response(defect === "body" ? changed : raw, { status: defect === "refusal" ? 503 : 200,
      headers: { "Content-Type": defect === "type" ? "text/html" : "application/json", ...(defect === "length" ? { "Content-Length": "1" } : {}), ...(defect === "encoding" ? { "Content-Encoding": "gzip" } : {}) } });
    if (defect === "redirect") Object.defineProperty(response, "redirected", { value: true });
    fetcher.mockResolvedValueOnce(response); const result = await post();
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: "matrix_display_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("pre-aborted request performs no auth/capture", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await post(request({ signal: controller.signal }))).status).toBe(503); expect(m.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("a stalled auth reader respects the finite request deadline", async () => {
    const { handleMatrixDisplayRequest } = await import("@/lib/matrixDisplayTransport");
    vi.useFakeTimers(); m.auth.mockReturnValueOnce(new Promise(() => {}));
    const pending = handleMatrixDisplayRequest(request()); await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborted stalled upstream read returns even when cancellation never settles", async () => {
    const controller = new AbortController();
    fetcher.mockResolvedValueOnce(new Response(raw));
    let cancelled = false;
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }), { headers: { "Content-Type": "application/json" } }));
    const pending = post(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); controller.abort();
    expect((await pending).status).toBe(503); expect(cancelled).toBe(true);
  });
  it("a declared body mismatch cannot reach capture", async () => {
    expect((await post(request({ headers: { "Content-Type": "application/octet-stream", "Content-Length": "1" } }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("a stalled incoming selection body respects the deadline with nonblocking cleanup", async () => {
    const { handleMatrixDisplayRequest } = await import("@/lib/matrixDisplayTransport");
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
    const req = request({ body, duplex: "half" } as RequestInit);
    const pending = handleMatrixDisplayRequest(req); await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });

  it("consumes exact bytes captured from the real native ASGI/helper response", async () => {
    const wire = JSON.parse(readFileSync(new URL("./fixtures/matrixDisplayASGIWire.json", import.meta.url), "utf8"));
    expect(wire.provenance).toContain("SYNTHETIC");
    const nativeBytes = Uint8Array.from(Buffer.from(wire.matrix_base64, "base64"));
    const nativeSelection = Uint8Array.from(Buffer.from(wire.selection_base64, "base64"));
    const params = new URLSearchParams({ f: "matrix:"+wire.root, matrix_delivery: "exact-v1", version_ref: wire.version_ref, fingerprint: wire.fingerprint });
    fetcher.mockResolvedValueOnce(new Response(nativeBytes))
      .mockResolvedValueOnce(new Response(nativeBytes, { headers: { "Content-Type": "application/json" } }));
    const response = await post(request({ body: nativeSelection }, params));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(nativeBytes);
    expect(fetcher.mock.calls[1][1].body).toEqual(nativeSelection);
  });

});
