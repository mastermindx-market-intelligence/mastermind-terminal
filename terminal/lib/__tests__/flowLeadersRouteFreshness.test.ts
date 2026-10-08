import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Leaders uses the same production entitlement/route, but a nightly artifact
// needs blocking revalidation after the server TTL; all other flow f-params
// retain their existing SWR behavior.
const upstream = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true }),
  tooMany: () => new Response("rate limited", { status: 429 }),
}));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions: async () => true }));
vi.mock("@/lib/flowSource", () => ({
  isValidF: () => true,
  fixtureFor: async () => ({}),
  attachFlowScores: () => {},
  tryFetchUpstream: upstream,
}));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({
  fetchOptionsAlphaCandidatePair: async () => ({}),
}));

const URL = "http://localhost:3108/api/flow?f=leaders";
const FIXTURE = "2026-10-07T12:00:00.000Z";
const leader = (session: string, stale: boolean) => ({
  schema: "flow_leaders.v1",
  session_date: session,
  stale,
  board_a: [],
  board_b: [],
  coverage: { n_universe: 0, n_flow_sessions: 0, tape_names: [], n_etfs: 0 },
});
const loadGet = async () => (await import("@/app/api/flow/route")).GET;

beforeEach(() => {
  vi.resetModules();
  upstream.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXTURE));
  delete process.env.FLOW_FIXTURE;
});
afterEach(() => { vi.useRealTimers(); });

describe("GET /api/flow leaders source-session revalidation", () => {
  it("returns the new session synchronously after server TTL rather than a stale SWR response", async () => {
    const GET = await loadGet();
    upstream.mockResolvedValueOnce(leader("2026-08-12", true))
      .mockResolvedValueOnce(leader("2026-10-06", false));
    const old = await GET(new Request(URL));
    expect((await old.json()).session_date).toBe("2026-08-12");
    vi.setSystemTime(new Date(Date.parse(FIXTURE) + 31_000));
    const refreshed = await GET(new Request(URL));
    expect((await refreshed.json()).session_date).toBe("2026-10-06");
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(refreshed.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps old data explicitly stale if the upstream revalidation fails", async () => {
    const GET = await loadGet();
    upstream.mockResolvedValueOnce(leader("2026-08-12", false))
      .mockResolvedValueOnce(null);
    await GET(new Request(URL));
    vi.setSystemTime(new Date(Date.parse(FIXTURE) + 31_000));
    const response = await GET(new Request(URL));
    expect((await response.json())).toMatchObject({
      session_date: "2026-08-12",
      stale: true,
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("deduplicates two concurrent source checks into one producer refresh", async () => {
    const GET = await loadGet();
    upstream.mockResolvedValueOnce(leader("2026-08-12", true));
    await GET(new Request(URL));
    vi.setSystemTime(new Date(Date.parse(FIXTURE) + 31_000));
    let resolve!: (v: ReturnType<typeof leader>) => void;
    const pending = new Promise<ReturnType<typeof leader>>((r) => { resolve = r; });
    upstream.mockReturnValueOnce(pending);
    const p1 = GET(new Request(URL));
    const p2 = GET(new Request(URL));
    resolve(leader("2026-10-06", false));
    const [a, b] = await Promise.all([p1, p2]);
    expect((await a.json()).session_date).toBe("2026-10-06");
    expect((await b.json()).session_date).toBe("2026-10-06");
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
