import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flowGet, flowGetFresh, flowInvalidate } from "@/lib/flowClientCache";

// Same fetch-mock idiom as flowClientCacheOutcome.test.ts: real Response objects, not
// { ok, json } stubs, so 404/503/malformed/reject classification matches production.
const reply = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

beforeEach(() => flowInvalidate());
afterEach(() => {
  flowInvalidate();
  vi.unstubAllGlobals();
});

const CALLS: Array<{ label: string; invoke: () => Promise<unknown> }> = [
  { label: 'flowGetFresh("gex:SPY", true)', invoke: () => flowGetFresh("gex:SPY", true) },
  { label: 'flowGetFresh("leaders", { forceUpstream: true })', invoke: () => flowGetFresh("leaders", { forceUpstream: true }) },
];

describe("flowGetFresh call forms", () => {
  it.each(CALLS)("$label: 404 resolves null", async ({ invoke }) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(JSON.stringify({ error: "not published" }), 404)));
    expect(await invoke()).toBeNull();
  });

  it.each(CALLS)("$label: 503 resolves null", async ({ invoke }) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply("{}", 503)));
    expect(await invoke()).toBeNull();
  });

  it.each(CALLS)("$label: a rejected fetch resolves null", async ({ invoke }) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await invoke()).toBeNull();
  });

  it.each(CALLS)("$label: 200 JSON resolves exactly that JSON", async ({ invoke }) => {
    const payload = { root: "SPY", session: "2026-10-02" };
    vi.stubGlobal("fetch", vi.fn(async () => reply(JSON.stringify(payload))));
    expect(await invoke()).toEqual(payload);
  });

  it("forceUpstream request URL contains refresh=1", async () => {
    const transport = vi.fn(async () => reply(JSON.stringify({ session_date: "2026-10-08" })));
    vi.stubGlobal("fetch", transport);
    expect(await flowGetFresh("leaders", { forceUpstream: true })).toEqual({ session_date: "2026-10-08" });
    expect(String(transport.mock.calls[0]?.[0])).toContain("refresh=1");
  });

  it("a warm cache entry inside TTL is bypassed by true (a second fetch happens)", async () => {
    const payload = { asof: "2026-10-02" };
    const transport = vi.fn(async () => reply(JSON.stringify(payload)));
    vi.stubGlobal("fetch", transport);
    expect(await flowGet("gex:SPY")).toEqual(payload);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await flowGetFresh("gex:SPY", true)).toEqual(payload);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
