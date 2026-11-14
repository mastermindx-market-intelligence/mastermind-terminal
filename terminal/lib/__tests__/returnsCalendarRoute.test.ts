import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bar6 } from "../intradayShared";

const state = vi.hoisted(() => ({
  user: true, authCalls: 0, demandCalls: 0, standardCalls: 0, daytimeCalls: 0, boatsCalls: 0,
  keys: [] as string[], dates: [] as Array<string | undefined>, access: [] as boolean[],
  daytime: [] as Bar6[], overnight: [] as Bar6[], pending: false, error: null as string | null,
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => {
  state.authCalls++; return { data: { user: state.user ? { id: "synthetic-reader" } : null }, error: null };
} } }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/intradaySources", async original => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async () => { state.standardCalls++; return [] as Bar6[]; },
}));
vi.mock("@/lib/intradayStore", () => ({ withStoredHistory: async () => [] as Bar6[] }));
vi.mock("@/lib/intradayDaytimeCache", () => ({ readOvernightDaytime: async (
  key: string, _symbol: string, _tf: string, _retain: unknown, date?: string,
) => {
  state.daytimeCalls++; state.keys.push(key); state.dates.push(date);
  return { snapshot: { bars: state.daytime, trace: { origins: state.daytime.map(b => [b[0], "stored_5m"]), storeReads: [] },
    assembledAtMs: Date.now(), storeError: null, assemblyComplete: !state.error },
    cacheState: "new_assembly", checkedAtMs: Date.now(), error: state.error,
    refreshPending: state.pending, assemblyComplete: !state.error };
} }));
vi.mock("@/lib/tiingoBoatsLiveHistory", async original => ({
  ...await original<typeof import("@/lib/tiingoBoatsLiveHistory")>(), requestBoatsLiveHistory: async () => {
  state.demandCalls++; return { status: "recorded", reason: null };
} }));
vi.mock("@/lib/tiingoBoatsStore", async original => ({
  ...await original<typeof import("@/lib/tiingoBoatsStore")>(),
  readTiingoBoatsHistory: async (symbol: string, _tf: string, _date: string, access: { live: boolean }) => {
    state.boatsCalls++; state.access.push(access.live);
    return { bars: state.overnight, evidence: { schema: "terminal.tiingo_boats_history_evidence.v1",
      source: "tiingo-boats-rest", venue: "BOATS", requested_symbol: symbol.toUpperCase(), status: "available",
      complete: false, coverage: "captured_vendor_bars_only", price_basis: "vendor_reported_unqualified" } };
  },
}));
import { GET } from "@/app/api/intraday/route";
import { parseReturnsStudy } from "../returnsCalendarStudy";

const day = Date.parse("2026-10-14T00:00:00Z") / 1000;
const bar = (minute: number): Bar6 => [day + minute * 60, 100, 102, 99, 101, 10];
const query = "sym=AAPL&tf=30m&ext=1&session=24h&study=returns&date=2026-10-14";
const call = (params = query) => GET(new Request("https://unit.test/api/intraday?" + params));
beforeEach(() => {
  Object.assign(state, { user: true, authCalls: 0, demandCalls: 0, standardCalls: 0, daytimeCalls: 0, boatsCalls: 0,
    keys: [], dates: [], access: [], daytime: [bar(570)], overnight: [bar(-240)], pending: false, error: null });
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0"); vi.stubEnv("TIINGO_BOATS_LIVE_DIR", ""); vi.stubEnv("FLOW_FIXTURE", "0");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Returns study on the existing24H route", () => {
  it("makes one selected-date acquisition and preserves both source origins", async () => {
    const response = await call(), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.daytimeCalls).toBe(1); expect(state.boatsCalls).toBe(1); expect(state.standardCalls).toBe(0);
    expect(state.dates).toEqual(["2026-10-14"]);
    expect(body.source_evidence.source_counts).toMatchObject({ stored_5m: 1, tiingo_boats_rest: 1 });
    expect(body.session_study_evidence).toMatchObject({ source: "canonical-daytime", status: "available", bars: 1 });
    const study = parseReturnsStudy(body, "AAPL", "2026-10-14");
    expect(study.daytimeStatus).toBe("available"); expect(study.overnightStatus).toBe("partial");
    expect(study.sessions.find(s => s.key === "overnight")).toMatchObject({ barCount: 1, ret: null });
  });
  it("rejects unknown, duplicate and conflicting study parameters before any provider IO", async () => {
    for (const params of [query.replace("study=returns", "study=other"), query + "&study=returns",
      query + "&date=2026-10-15", query + "&overnight=only", query.replace("tf=30m", "tf=5m"),
      query.replace("sym=AAPL", "sym=BTC-USD"), query.replace("sym=AAPL", "sym=DFII10"), query.replace("2026-10-14", "2026-02-30")]) {
      expect((await call(params)).status).toBe(400);
    }
    expect(state.daytimeCalls + state.boatsCalls + state.demandCalls + state.authCalls).toBe(0);
  });
  it("keeps verification before private demand or cache access", async () => {
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1"); vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "/synthetic/private"); state.user = false;
    expect((await call()).status).toBe(401);
    expect(state.authCalls).toBe(1); expect(state.daytimeCalls + state.boatsCalls + state.demandCalls).toBe(0);
  });
  it("keeps signed-in and signed-out private-history scope separate on repeated calls", async () => {
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "/synthetic/private");
    await call(); state.user = false; await call();
    expect(state.authCalls).toBe(2); expect(state.demandCalls).toBe(1);
    expect(state.access).toEqual([true, false]);
    expect(state.keys[0]).toContain("boats-live:1"); expect(state.keys[1]).toContain("boats-live:0");
  });
  it("returns known-closed and unavailable-calendar states without data demand", async () => {
    const closed = await (await call(query.replace("2026-10-14", "2026-10-17"))).json();
    expect(closed.regular_session_window).toBeNull(); expect(closed.session_study_evidence.status).toBe("closed");
    const unknown = await (await call(query.replace("2026-10-14", "1900-01-01"))).json();
    expect(unknown.session_study_evidence.status).toBe("unavailable");
    expect(state.daytimeCalls + state.boatsCalls + state.demandCalls).toBe(0);
  });
  it("gets early-close post hours from the canonical phase owner", async () => {
    state.daytime = []; state.overnight = [];
    const body = await (await call(query.replace("2026-10-14", "2026-11-27"))).json();
    expect(body.regular_session_window).toEqual({ start_minute: 570, end_minute: 780, post_end_minute: 1020 });
  });
  it("retains independent overnight OHLC while withholding pending or failed daytime returns", async () => {
    for (const pending of [false, true]) {
      state.pending = pending; state.error = pending ? null : "synthetic unavailable";
      const body = await (await call()).json(), study = parseReturnsStudy(body, "AAPL", "2026-10-14");
      expect(study.sessions.find(s => s.key === "overnight")?.barCount).toBe(1);
      expect(study.sessions.find(s => s.key === "regular")?.ret).toBeNull();
    }
  });
  it("does not change ordinary24H or standard chart acquisition", async () => {
    const body = await (await call(query.replace("&study=returns", ""))).json();
    expect(body.session_study_evidence).toBeUndefined(); expect(body.regular_session_window).toBeUndefined();
    expect(state.dates).toEqual([undefined]);
    await call("sym=STANDARD&tf=30m&ext=1&date=2026-10-14"); expect(state.standardCalls).toBe(1);
  });
});

