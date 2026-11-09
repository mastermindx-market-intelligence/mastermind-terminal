import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

const m = vi.hoisted(() => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  entitlement: vi.fn(async () => "allowed"),
  fixture: vi.fn(async () => ({ root: "SPY", fixture: true })),
  upstream: vi.fn(async () => ({ status: "data", data: { root: "SPY", marker: "ordinary" } })),
  refresh: vi.fn(async () => ({ root: "SPY", marker: "refresh" })),
  subscribe: vi.fn(),
  grant: vi.fn(async () => ({ status: "denied" })),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: m.rateLimit, tooMany: () => new Response("rate limited", { status: 429 }) }));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: m.entitlement, openLiveOptionsGrantResult: m.grant, LIVE_OPTIONS_CACHE_TTL_MS: 45000 }));
vi.mock("@/lib/flowSource", () => ({
  isValidF: (f: string) => f === "feed" || /^matrix:[A-Z]{1,6}$/.test(f),
  fixtureFor: m.fixture, attachFlowScores: () => {}, tryFetchUpstream: m.refresh, tryFetchUpstreamResult: m.upstream,
}));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({ fetchOptionsAlphaCandidatePair: vi.fn() }));
vi.mock("@/lib/flowBroadcast", () => ({ subscribe: m.subscribe }));
const url = "http://localhost/api/flow?f=matrix:SPY";
const get = async () => (await import("@/app/api/flow/route")).GET;
beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); delete process.env.FLOW_FIXTURE; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete process.env.FLOW_FIXTURE; });

describe("explicit Matrix exact-byte contract cannot downgrade", () => {
  it.each([undefined, "1"])("refuses absent native bridge in fixture=%s before data/authority reads", async (fixture) => {
    if (fixture) process.env.FLOW_FIXTURE = fixture;
    const r = await (await get())(new Request(url + "&matrix_delivery=exact-v1"));
    expect(r.status).toBe(405);
    expect(await r.json()).toEqual({ error: "matrix_post_required" });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(m.entitlement).not.toHaveBeenCalled();
    expect(m.upstream).not.toHaveBeenCalled(); expect(m.fixture).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it.each(["", "unknown", "exact-v1&matrix_delivery=exact-v1"])("refuses malformed mode %s", async (mode) => {
    expect((await (await get())(new Request(url + "&matrix_delivery=" + mode))).status).toBe(400);
    expect(m.upstream).not.toHaveBeenCalled();
  });
  it.each(["feed", "matrix:../SPY", "matrix:SPY&f=matrix:QQQ"])("refuses wrong/ambiguous feed %s", async (f) => {
    const r = await (await get())(new Request("http://localhost/api/flow?f=" + f + "&matrix_delivery=exact-v1"));
    expect(r.status).toBe(400); expect(m.upstream).not.toHaveBeenCalled();
  });
  it("cannot consume a warm or expired ordinary Matrix cache", async () => {
    const GET = await get(); await GET(new Request(url));
    vi.advanceTimersByTime(31000);
    const r = await GET(new Request(url + "&matrix_delivery=exact-v1"));
    expect(r.status).toBe(405); expect(m.upstream).toHaveBeenCalledTimes(1);
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it.each(["exact-v1", "", "unknown"])("SSE refuses mode %s before grant/producer", async (mode) => {
    const GET = (await import("@/app/api/flow/stream/route")).GET;
    const r = await GET(new Request(url + "&matrix_delivery=" + mode));
    expect(r.status).toBe(400); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(m.grant).not.toHaveBeenCalled(); expect(m.subscribe).not.toHaveBeenCalled();
  });
  it("retains rate limiting before the held mode", async () => {
    m.rateLimit.mockReturnValueOnce({ ok: false });
    expect((await (await get())(new Request(url + "&matrix_delivery=exact-v1"))).status).toBe(429);
  });
});
describe("ordinary Matrix contract is retained", () => {
  it("retains product entitlement and cache reuse", async () => {
    const GET = await get();
    expect(await (await GET(new Request(url))).json()).toEqual({ root: "SPY", marker: "ordinary" });
    expect(await (await GET(new Request(url))).json()).toEqual({ root: "SPY", marker: "ordinary" });
    expect(m.entitlement).toHaveBeenCalledTimes(2); expect(m.upstream).toHaveBeenCalledTimes(1);
  });
  it("retains explicit stale augmentation after TTL", async () => {
    const GET = await get(); await GET(new Request(url)); vi.advanceTimersByTime(31000);
    const r = await GET(new Request(url));
    expect(await r.json()).toMatchObject({ root: "SPY", stale: true });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });
  it("retains fixture exemption only for ordinary reads", async () => {
    process.env.FLOW_FIXTURE = "1";
    const r = await (await get())(new Request(url));
    expect(await r.json()).toEqual({ root: "SPY", fixture: true });
    expect(m.entitlement).not.toHaveBeenCalled(); expect(m.fixture).toHaveBeenCalledTimes(1);
  });
  it("retains a denied entitlement with no source read", async () => {
    m.entitlement.mockResolvedValueOnce("denied");
    expect((await (await get())(new Request(url))).status).toBe(403);
    expect(m.upstream).not.toHaveBeenCalled();
  });
});
