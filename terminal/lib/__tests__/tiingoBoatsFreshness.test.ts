import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bar6 } from "../intradayShared";

const state = vi.hoisted(() => ({
  user: true, calls: 0, reads: 0, failStore: false,
  tasks: [] as Array<() => Promise<void>>,
  fetch: null as null | ((signal?: AbortSignal) => Promise<Bar6[]>),
  history: null as null | (() => Promise<Bar6[]>),
  bars: [[1792526400, 10, 12, 9, 11, 123]] as Bar6[],
}));
vi.mock("next/server", async original => ({
  ...await original<typeof import("next/server")>(),
  after: (work: () => Promise<void>) => { state.tasks.push(work); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: state.user ? { id: "reader" } : null } }),
} }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/tiingoBoatsLiveHistory", async original => ({ ...await original<typeof import("@/lib/tiingoBoatsLiveHistory")>(), requestBoatsLiveHistory: async () => ({ status: "recorded" }) }));
vi.mock("@/lib/intradaySources", async original => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async (_s: string, _tf: string, _e: boolean, _date: unknown, _overnight: boolean, signal?: AbortSignal) => {
    state.calls++;
    return state.fetch ? state.fetch(signal) : [];
  },
}));
vi.mock("@/lib/intradayStore", () => ({
  withStoredHistory: async (_s: string, _tf: string, _e: boolean, live: Bar6[], capture: (trace: unknown) => void) => {
    if (state.failStore) throw new Error("stored history malformed");
    capture({ origins: live.map(bar => [bar[0], "live_tail"]), storeReads: [] });
    return live;
  },
}));
vi.mock("@/lib/tiingoBoatsStore", async original => ({
  ...await original<typeof import("@/lib/tiingoBoatsStore")>(),
  readTiingoBoatsHistory: async () => {
    state.reads++;
    const bars = state.history ? await state.history() : [...state.bars];
    return { bars, evidence: {
      schema: "terminal.boats_history_evidence.v1", status: bars.length ? "available" : "empty",
      source: "tiingo-boats-rest", venue: "BOATS", complete: false, returned_bars: bars.length,
      receipt_ids: ["a".repeat(64)], observed_at_utc: ["2026-10-21T01:00:00Z"],
      content_sha256: "b".repeat(64), conflicts_excluded: 0,
    } };
  },
}));
import { GET } from "@/app/api/intraday/route";

const request = (symbol: string) => GET(new Request(`https://unit.test/api/intraday?sym=${symbol}&tf=5m&session=24h`));
const body = async (symbol: string) => (await request(symbol)).json();
beforeEach(() => {
  state.user = true; state.calls = 0; state.reads = 0; state.failStore = false;
  state.tasks = []; state.fetch = null; state.history = null;
  state.bars = [[1792526400, 10, 12, 9, 11, 123]];
  vi.stubEnv("FLOW_FIXTURE", "0");
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0");
  vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "");
});
afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  await Promise.all(state.tasks.map(work => work()));
  vi.useRealTimers(); vi.unstubAllEnvs();
});

it("composes new and authoritative-empty overnight snapshots inside the daytime TTL", async () => {
  const first = await body("FRESHOVERNIGHT");
  state.bars = [[1792526400, 20, 22, 19, 21, 456]];
  const revised = await body("FRESHOVERNIGHT");
  expect(revised.bars).toEqual(state.bars);
  expect(revised.bars).not.toEqual(first.bars);
  state.bars = [];
  const empty = await body("FRESHOVERNIGHT");
  expect(empty.bars).toEqual([]);
  expect(empty.boats_history.status).toBe("empty");
  expect(state.calls).toBe(1);
  expect(state.reads).toBe(3);
  expect(revised.source_evidence.assembly_clock.cache_state).toBe("new_assembly");
  expect(revised.daytime_cache.cache_state).toBe("cache");
});

it("collapses concurrent cold daytime requests without caching an older overnight read", async () => {
  let releaseProvider!: (bars: Bar6[]) => void;
  state.fetch = () => new Promise(resolve => { releaseProvider = resolve; });
  let releaseOld!: (bars: Bar6[]) => void;
  state.history = () => state.reads === 1
    ? new Promise(resolve => { releaseOld = resolve; }) : Promise.resolve(state.bars);
  const old = body("RACEOVERNIGHT");
  await vi.waitFor(() => expect(state.calls).toBe(1));
  state.bars = [[1792526400, 30, 32, 29, 31, 789]];
  const newer = body("RACEOVERNIGHT");
  await vi.waitFor(() => expect(state.reads).toBe(2));
  releaseProvider([]);
  expect((await newer).bars).toEqual(state.bars);
  releaseOld([[1792526400, 10, 12, 9, 11, 123]]);
  await old;
  expect((await body("RACEOVERNIGHT")).bars).toEqual(state.bars);
  expect(state.calls).toBe(1);
});

it("returns local overnight bars within the foreground budget and warms daytime after the response", async () => {
  vi.useFakeTimers();
  let releaseProvider!: (bars: Bar6[]) => void;
  let signal: AbortSignal | undefined;
  state.fetch = input => { signal = input; return new Promise(resolve => { releaseProvider = resolve; }); };
  const response = body("SLOWOVERNIGHT");
  await vi.advanceTimersByTimeAsync(1_200);
  const first = await response;
  expect(first.bars).toEqual(state.bars);
  expect(first.daytime_cache.refresh_pending).toBe(true);
  expect(first.daytime_cache.assembly_complete).toBe(false);
  expect(first.note).toContain("daytime refresh pending");
  expect(signal?.aborted).toBe(false);
  expect(state.tasks).toHaveLength(1);
  const day: Bar6 = [1792562400, 40, 42, 39, 41, 321];
  releaseProvider([day]);
  await Promise.all(state.tasks.map(work => work()));
  const warmed = await body("SLOWOVERNIGHT");
  expect(warmed.bars).toEqual([...state.bars, day]);
  expect(warmed.daytime_cache.refresh_pending).toBe(false);
  expect(warmed.daytime_cache.assembly_complete).toBe(true);
  expect(warmed.daytime_cache.refresh_error).toBeNull();
  expect(state.calls).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts a hung daytime fetch at its actual deadline without losing local overnight bars", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  state.fetch = input => {
    signal = input;
    return new Promise((_resolve, reject) => input?.addEventListener("abort", () => reject(input.reason), { once: true }));
  };
  const response = body("ABORTOVERNIGHT");
  await vi.advanceTimersByTimeAsync(1_200);
  expect((await response).bars).toEqual(state.bars);
  await vi.advanceTimersByTimeAsync(6_800);
  await Promise.all(state.tasks.map(work => work()));
  expect(signal?.aborted).toBe(true);
  // An incomplete failed first assembly must be retried immediately, not
  // called a warm 45-second cache entry. The next waiter gets a provisional
  // response with the prior error while the new flight remains pending.
  const retry = body("ABORTOVERNIGHT");
  await vi.advanceTimersByTimeAsync(1_200);
  const cached = await retry;
  expect(cached.bars).toEqual(state.bars);
  expect(cached.daytime_cache.refresh_error).toContain("deadline");
  expect(cached.daytime_cache).toMatchObject({ assembly_complete: false, refresh_pending: true });
  expect(state.calls).toBe(2);
  await vi.advanceTimersByTimeAsync(6_800);
  await Promise.all(state.tasks.map(work => work()));
  expect(vi.getTimerCount()).toBe(0);
});

it("does not call an unsuccessful cold upstream fetch a completed daytime assembly, and retries it", async () => {
  state.fetch = async () => { throw new Error("daytime feed offline"); };
  const failed = await body("COLDFAILEDOVERNIGHT");
  expect(failed.bars).toEqual(state.bars); // Return independently captured BOATS data, not fake daily history.
  expect(failed.daytime_cache).toMatchObject({
    assembly_complete: false, refresh_pending: false, refresh_error: "daytime feed offline",
  });
  expect(state.calls).toBe(1);
  // Failed first assemblies must not poison the warm cache for 45 seconds.
  const day: Bar6 = [1792562400, 40, 42, 39, 41, 321];
  state.fetch = async () => [day];
  const recovered = await body("COLDFAILEDOVERNIGHT");
  expect(recovered.bars).toEqual([...state.bars, day]);
  expect(recovered.daytime_cache).toMatchObject({
    assembly_complete: true, refresh_pending: false, refresh_error: null,
  });
  expect(state.calls).toBe(2);
});

it("does not call a cold upstream-only tail complete when stored-history assembly fails", async () => {
  state.failStore = true;
  const day: Bar6 = [1792562400, 40, 42, 39, 41, 321];
  state.fetch = async () => [day];
  const failed = await body("COLDSTOREOVERNIGHT");
  expect(failed.bars).toEqual([...state.bars, day]);
  expect(failed.daytime_cache).toMatchObject({
    assembly_complete: false, refresh_pending: false, refresh_error: "stored history malformed",
  });
  state.failStore = false;
  const recovered = await body("COLDSTOREOVERNIGHT");
  expect(recovered.bars).toEqual([...state.bars, day]);
  expect(recovered.daytime_cache).toMatchObject({ assembly_complete: true, refresh_error: null });
  expect(state.calls).toBe(2);
});

it("checks auth before fresh overnight reads and daytime cache reuse", async () => {
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
  await body("FRESHAUTH");
  state.user = false;
  const denied = await request("FRESHAUTH");
  expect(denied.status).toBe(401);
  expect(state.reads).toBe(1);
  expect(state.calls).toBe(1);
});

it("preserves the daytime baseline clock on refresh failure while accepting fresh overnight corrections", async () => {
  vi.useFakeTimers();
  const day: Bar6 = [1792562400, 40, 42, 39, 41, 321];
  state.fetch = async () => [day];
  const first = await body("RECOVEROVERNIGHT");
  const assembly = first.daytime_cache.assembled_at;
  await vi.advanceTimersByTimeAsync(45_001);
  state.fetch = async () => { throw new Error("provider unavailable"); };
  state.bars = [[1792526400, 20, 22, 19, 21, 456]];
  const during = await body("RECOVEROVERNIGHT");
  expect(during.bars).toEqual([...state.bars, day]);
  await Promise.all(state.tasks.map(work => work()));
  const failed = await body("RECOVEROVERNIGHT");
  expect(failed.bars).toEqual([...state.bars, day]);
  expect(failed.daytime_cache).toMatchObject({ cache_state: "stale_cache",
    assembled_at: assembly, refresh_error: "provider unavailable", refresh_pending: false });
  expect(state.calls).toBe(2);
  await vi.advanceTimersByTimeAsync(45_001);
  const revisedDay: Bar6 = [1792562400, 50, 52, 49, 51, 654];
  state.fetch = async () => [revisedDay];
  await body("RECOVEROVERNIGHT");
  await Promise.all(state.tasks.map(work => work()));
  const recovered = await body("RECOVEROVERNIGHT");
  expect(recovered.bars).toEqual([...state.bars, revisedDay]);
  expect(recovered.daytime_cache.refresh_error).toBeNull();
  expect(recovered.daytime_cache.assembled_at).not.toBe(assembly);
  expect(state.calls).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("retains the deep baseline on a store-assembly exception instead of caching only the short provider tail", async () => {
  vi.useFakeTimers();
  const older: Bar6 = [1792476000, 40, 42, 39, 41, 100];
  const day: Bar6 = [1792562400, 40, 42, 39, 41, 321];
  state.fetch = async () => [older, day];
  const first = await body("STOREFAILOVERNIGHT");
  await vi.advanceTimersByTimeAsync(45_001);
  state.failStore = true;
  state.fetch = async () => [[1792562400, 50, 52, 49, 51, 654]];
  state.bars = [[1792526400, 20, 22, 19, 21, 456]];
  await body("STOREFAILOVERNIGHT");
  await Promise.all(state.tasks.map(work => work()));
  const failed = await body("STOREFAILOVERNIGHT");
  expect(failed.bars).toEqual([older, ...state.bars, day]);
  expect(failed.daytime_cache).toMatchObject({ cache_state: "stale_cache",
    assembled_at: first.daytime_cache.assembled_at,
    refresh_error: "stored history malformed", refresh_pending: false });
});
