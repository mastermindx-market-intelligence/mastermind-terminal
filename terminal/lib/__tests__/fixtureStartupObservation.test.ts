import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { observeResponse, warmFixtureRoutes, ROUTES, MAX_BODY_BYTES } = require("../../e2e/fixtureWarmup.cjs");
function response(status = 200, chunks = [new Uint8Array([1, 2])]) {
  let index = 0;
  const reader = { read: vi.fn(async () => index < chunks.length ? { value: chunks[index++], done: false } : { done: true }), cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
  return { reply: { status, body: { getReader: () => reader } }, reader };
}
const nativeProbe = vi.fn(async (url: string) => {
  if (url !== "http://127.0.0.1:3108/api/flow?f=prophet_idx") throw new Error("unexpected global transport");
  return new Response(JSON.stringify({ schema: "prophet.index/v1", plans: [] }), { status: 200, headers: { "X-Flow-Source": "fixture" } });
});
beforeEach(() => { nativeProbe.mockClear(); vi.stubGlobal("fetch", nativeProbe); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("incumbent fixture response completion", () => {
  it("does not call headers200 complete while the body is blocked; same deadline aborts", async () => {
    vi.useFakeTimers();
    const fixture = response();
    fixture.reader.read.mockImplementation(() => new Promise(() => {}));
    let signal: AbortSignal | undefined;
    const task = observeResponse("http://127.0.0.1:3108/analysis", 90_000, { fetch: async (_url: string, init: { signal: AbortSignal }) => { signal = init.signal; return fixture.reply; } });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await task;
    expect(result).toMatchObject({ status: 200, headersReceived: true, bodyComplete: false, timedOut: true, errorName: "TimeoutError", cancelRequested: true, elapsedMs: 90_000 });
    expect(signal?.aborted).toBe(true);
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("records a body error without retaining its message", async () => {
    const fixture = response();
    fixture.reader.read.mockRejectedValue(new TypeError("private-body-value"));
    const result = await observeResponse("http://127.0.0.1/analysis", 90_000, { fetch: async () => fixture.reply });
    expect(result).toMatchObject({ status: 200, bodyComplete: false, errorName: "TypeError", cancelRequested: true });
    expect(JSON.stringify(result)).not.toContain("private-body-value");
  });
  it("bounds streamed bytes and cancels its own oversized response", async () => {
    const fixture = response(200, [new Uint8Array(MAX_BODY_BYTES + 1)]);
    const result = await observeResponse("http://127.0.0.1/analysis", 90_000, { fetch: async () => fixture.reply });
    expect(result).toMatchObject({ bodyComplete: false, errorName: "FixtureBodyLimit", cancelRequested: true });
    expect(fixture.reader.cancel).toHaveBeenCalledOnce();
  });
  it("distinguishes a completed401 response from successful selected HTML", async () => {
    const fixture = response(401);
    const result = await observeResponse("http://127.0.0.1/analysis", 90_000, { fetch: async () => fixture.reply });
    expect(result).toMatchObject({ status: 401, headersReceived: true, bodyComplete: true, bodyBytes: 2, timedOut: false, errorName: null });
    expect(fixture.reader.cancel).not.toHaveBeenCalled();
  });
  it("handles a genuine empty response without inventing body bytes", async () => {
    const result = await observeResponse("http://127.0.0.1/login", 5_000, { fetch: async () => ({ status: 204, body: null }) });
    expect(result).toMatchObject({ status: 204, bodyComplete: true, bodyBytes: 0, errorName: null });
  });
});
describe("incumbent serial warm-up readiness", () => {
  it("fails at the unchanged readiness ceiling without requesting the14 routes", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (_url: string) => { void _url; throw new TypeError("unreachable"); });
    const events: Array<Record<string, unknown>> = [];
    const task = warmFixtureRoutes("http://127.0.0.1:3108", { deps: { fetch }, onOutcome: (row: Record<string, unknown>) => events.push(row), log: vi.fn() });
    const rejected = expect(task).rejects.toMatchObject({ name: "FixtureReadinessUnavailable" });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(fetch.mock.calls.every((row) => row[0] === "http://127.0.0.1:3108/login")).toBe(true);
    expect(events.at(-1)).toEqual({ phase: "readiness_failed" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves14 configured requests and reports409 honestly without allcompiled", async () => {
    const events: Array<Record<string, unknown>> = [];
    const log = vi.fn();
    const fetch = vi.fn(async (url: string) => response(url.endsWith("annotations") ? 409 : 200).reply);
    const result = await warmFixtureRoutes("http://127.0.0.1:3108", { deps: { fetch }, requiredHtmlRoutes: ["/analysis"], onOutcome: (row: Record<string, unknown>) => events.push(row), log });
    expect(fetch.mock.calls.map((row) => row[0])).toEqual(["http://127.0.0.1:3108/login", ...ROUTES.map((route: string) => "http://127.0.0.1:3108" + route)]);
    expect(result.summary).toMatchObject({ routes: 14, headersReceived: 14, bodiesComplete: 14, non2xx: 1, timedOut: 0, failed: 0, selectedHtmlReady: true });
    expect(events.at(-1)).toEqual(result.summary);
    expect(nativeProbe).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/routes compiled/);
  });
  it("selected HTML failure is explicit while nonselected error statuses remain observations", async () => {
    const events: Array<Record<string, unknown>> = [];
    const fetch = async (url: string) => response(url.endsWith("/analysis") ? 401 : 200).reply;
    await expect(warmFixtureRoutes("http://127.0.0.1:3108", { deps: { fetch }, requiredHtmlRoutes: ["/analysis"], onOutcome: (row: Record<string, unknown>) => events.push(row), log: vi.fn() })).rejects.toMatchObject({ name: "FixtureHtmlReadinessUnavailable" });
    expect(events.at(-1)).toMatchObject({ bodiesComplete: 14, non2xx: 1, selectedHtmlReady: false });
  });
  it("requires the protected Prophet predicate in addition to completed Analysis HTML", async () => {
    nativeProbe.mockResolvedValueOnce(new Response(JSON.stringify({ schema: "wrong", plans: [] }), { status: 200, headers: { "X-Flow-Source": "fixture" } }));
    const events: Array<Record<string, unknown>> = [];
    const fetch = async () => response(200).reply;
    await expect(warmFixtureRoutes("http://127.0.0.1:3108", { deps: { fetch }, requiredHtmlRoutes: ["/analysis"], onOutcome: (row: Record<string, unknown>) => events.push(row), log: vi.fn() })).rejects.toThrow("[fixture-ready] prophet_idx body_shape");
    expect(events.at(-1)).toMatchObject({ bodiesComplete: 14, selectedHtmlReady: true });
    expect(nativeProbe).toHaveBeenCalledOnce();
  });

});
