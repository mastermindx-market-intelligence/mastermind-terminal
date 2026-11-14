import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bar6 } from "../intradayShared";
import type { IntradayAssemblyTrace } from "../intradayEvidence";

const state = vi.hoisted(() => ({
  standardCalls: 0, studyCalls: 0, storeCalls: 0, signals: [] as AbortSignal[],
  local: null as Bar6[] | null, localWait: null as Promise<Bar6[]> | null,
  providerWait: null as Promise<Bar6[]> | null, remote: [] as Bar6[],
}));
vi.mock("../intradaySources", () => ({
  fetchIntraday: async () => { state.standardCalls++; return state.remote; },
  fetchUsEquityDateStudyBars: async (_sym: string, _tf: string, _ext: boolean, _date: string, signal: AbortSignal) => {
    state.studyCalls++; state.signals.push(signal); return state.providerWait ?? state.remote;
  },
}));
vi.mock("../intradayStore", () => ({ withStoredHistory: async (
  _sym: string, _tf: string, _ext: boolean, live: Bar6[], capture: (trace: IntradayAssemblyTrace) => void,
  _overnight: boolean, date?: string,
) => {
  state.storeCalls++;
  const bars = await (state.localWait ?? (date && state.local ? state.local : live));
  capture({ origins: bars.map(b => [b[0], live.includes(b) ? "live_tail" : "stored_5m"]), storeReads: [] });
  return bars;
} }));
let read: typeof import("../intradayDaytimeCache").readOvernightDaytime;
let retained: Promise<void>[];
const date = "2026-10-14", key = "AAPL|30m|24h|2026-10-14|boats-live:1";
const bar = (close = 101): Bar6 => [Date.parse("2026-10-14T09:30:00Z") / 1000, 100, 102, 99, close, 10];
const retain = (work: Promise<void>) => { retained.push(work); };
const study = () => read(key, "AAPL", "30m", retain, date);
function deferred() {
  let resolve!: (bars: Bar6[]) => void;
  const promise = new Promise<Bar6[]>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  Object.assign(state, { standardCalls: 0, studyCalls: 0, storeCalls: 0, signals: [], local: null,
    localWait: null, providerWait: null, remote: [bar()] }); retained = [];
  read = (await import("../intradayDaytimeCache")).readOvernightDaytime;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("selected-date mode inside the existing daytime owner", () => {
  it("uses precise local history first and separates normal-chart cache/flight identity", async () => {
    state.local = [bar()];
    expect((await study()).assemblyComplete).toBe(true); expect(state.studyCalls).toBe(0);
    await read(key, "AAPL", "30m", retain);
    expect(state.standardCalls).toBe(1); expect(state.studyCalls).toBe(0); expect(retained).toHaveLength(2);
  });
  it("coalesces concurrent selected-date consumers on one retained provider flight", async () => {
    const wait = deferred(); state.providerWait = wait.promise;
    const a = study(), b = study(); await vi.advanceTimersByTimeAsync(0);
    expect(state.studyCalls).toBe(1); expect(state.standardCalls).toBe(0); expect(retained).toHaveLength(1);
    wait.resolve([bar()]);
    expect((await Promise.all([a, b])).every(result => result.assemblyComplete)).toBe(true);
  });
  it("waits for an expired warm study to refresh instead of returning its prior baseline immediately", async () => {
    await study(); await vi.advanceTimersByTimeAsync(45_001);
    const wait = deferred(); state.providerWait = wait.promise;
    let settled = false; const work = study().then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false); expect(state.studyCalls).toBe(2);
    wait.resolve([bar(102)]); expect((await work).snapshot.bars[0][4]).toBe(102);
  });
  it("rereads selected-day storage after expiry rather than restamping an old local baseline", async () => {
    state.local = [bar()]; await study();
    state.local = [bar(102)]; await vi.advanceTimersByTimeAsync(45_001);
    expect((await study()).snapshot.bars[0][4]).toBe(102);
    expect(state.studyCalls).toBe(0); expect(state.storeCalls).toBe(2);
  });
  it("bounds a hanging local read while keeping the same owned work for later consumers", async () => {
    const local = deferred(); state.localWait = local.promise;
    const first = study(); await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toMatchObject({ refreshPending: true, assemblyComplete: false, snapshot: { bars: [] } });
    const second = study(); await vi.advanceTimersByTimeAsync(10_000);
    expect((await second).refreshPending).toBe(true); expect(retained).toHaveLength(1); expect(state.studyCalls).toBe(0);
    local.resolve([bar()]); await Promise.all(retained);
    expect((await study()).assemblyComplete).toBe(true);
  });
  it("passes the shared owner's actual abort to the selected-date upstream request", async () => {
    const wait = deferred(); state.providerWait = wait.promise;
    const work = study(); await vi.advanceTimersByTimeAsync(8_000);
    const result = await work;
    expect(state.signals).toHaveLength(1); expect(state.signals[0].aborted).toBe(true);
    expect(result.assemblyComplete).toBe(false); expect(result.error).toContain("deadline");
    wait.resolve([]); await Promise.all(retained);
  });
});
