/**
 * The main quote plane is regular-session data. Extended-hours data has its own
 * /api/ext-quote lane, so high-frequency watchlist/chart polls must be able to ask
 * Quote Hub for view=regular without spending or churning its 30-slot ExtFeed LRU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ syms: string[]; view?: string }>,
  extra: {} as Record<string,unknown>,
  user: { id: "reader" } as { id: string } | null,
  authCalls: 0,
  authError: null as Error | null,
  authThrows: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => {
      state.authCalls++;
      if (state.authThrows) throw new Error("verification unavailable");
      return { data: { user: state.user }, error: state.authError };
    }) },
  })),
}));

vi.mock("@/lib/intradaySources", () => ({
  fetchQuotes: vi.fn(async (syms: string[], options?: { view?: string }) => {
    state.calls.push({ syms: [...syms], view: options?.view });
    return Object.fromEntries(syms.map((sym) => [sym, {
      sym, last: 100, prevClose: 99, chg: 1.0101, basis: "DELAYED_15M", ...state.extra,
    }]));
  }),
}));

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  tooMany: vi.fn(),
}));

import { GET } from "@/app/api/quote/route";

const call = (query: string) => GET(new Request(`https://app.mastermind-x.com/api/quote?${query}`));

beforeEach(() => {
  state.calls = []; state.extra = {}; state.user = { id: "reader" }; state.authCalls = 0;
  state.authError = null; state.authThrows = false;
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", ""); vi.stubEnv("HUB_REALTIME_QUOTES", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("/api/quote view routing", () => {
  it("forwards view=regular to the hub quote fetch", async () => {
    const response = await call("view=regular&syms=VIEWREGULAR1");
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ syms: ["VIEWREGULAR1"], view: "regular" }]);
  });

  it("keeps the absent/default view backward-compatible as full", async () => {
    const response = await call("syms=VIEWFULL1");
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ syms: ["VIEWFULL1"], view: "full" }]);
  });

  it("rejects unknown, blank, or repeated view values", async () => {
    for (const query of [
      "view=all&syms=VIEWBAD1",
      "view=&syms=VIEWBAD2",
      "view=regular&view=regular&syms=VIEWBAD3",
      "view=regular&view=full&syms=VIEWBAD4",
    ]) {
      const response = await call(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad view" });
    }
    expect(state.calls).toEqual([]);
  });

  it("partitions cache entries by view so a regular hit cannot starve a full ext read", async () => {
    const sym = "VIEWCACHE1";
    await call(`view=regular&syms=${sym}`);
    await call(`view=full&syms=${sym}`);
    expect(state.calls).toEqual([
      { syms: [sym], view: "regular" },
      { syms: [sym], view: "full" },
    ]);
  });
});

describe("BOATS cannot bypass its public API through the mixed quote cache",()=>{
 it("strips every BOATS ext field on both fresh and cached responses and retains regular prices",async()=>{
  state.extra={extSource:"tiingo_boats",extPrice:105,extTs:1800000000,extVenue:"BOATS",extUnknown:"poison"};
  for(let i=0;i<2;i++){
   const r=await call("syms=BOATSPUBLICBOUNDARY1");const q=(await r.json()).quotes.BOATSPUBLICBOUNDARY1;
   expect(q.last).toBe(100);expect(q.regularPrice).toBe(100);expect(Object.keys(q).some(k=>k.startsWith("ext"))).toBe(false);
  }
  expect(state.calls).toHaveLength(1);
 });
 it("keeps the existing unrelated provider behavior",async()=>{
  state.extra={extSource:"webull",extPrice:101};const r=await call("syms=LEGACYQUOTEBOUNDARY1");
  expect((await r.json()).quotes.LEGACYQUOTEBOUNDARY1.extSource).toBe("webull");
 });
});


describe("chart forming contract",()=>{
  it("separates selected timeframes and strips raw snapshots from ordinary quotes",async()=>{
    const t=Date.parse("2026-10-21T13:30:00Z");
    vi.spyOn(Date,"now").mockReturnValue(t+65000);
    state.extra={basis:"REALTIME",source:"polygon-live-second",asOfMs:t+64999,forming:{
      version:1,source:"polygon-live-second",generation:"d4606eb2-61c0-43a9-b89e-ff8da926ebf4",
      generationStartedMs:t,revision:2,sessionDate:"2026-10-21",asOfMs:t+64999,
      streamFromMs:t+60000,prefixThroughMs:t+60000,dirtyPrefix:false,
      minutes:[[t,100,105,99,102,100],[t+60000,102,103,101,102,20]],seconds:[]}};
    const one=await (await call("sym=FORMROUTE1&view=regular&cadence=chart&timeframes=1m")).json();
    expect(one.quote.forming).toBeUndefined();
    expect(one.quote.formingCandles.series["regular:1m"]).toHaveLength(2);
    const five=await (await call("sym=FORMROUTE1&view=regular&cadence=chart&timeframes=5m")).json();
    expect(five.quote.formingCandles.series["regular:5m"]).toHaveLength(1);
    const wide=await (await call("sym=FORMROUTE1&view=regular")).json();
    expect(wide.quote.forming).toBeUndefined();
    expect(wide.quote.formingCandles).toBeUndefined();
    await call("sym=FORMROUTE1&view=regular&cadence=chart&timeframes=1m");
    expect(state.calls).toHaveLength(3);
  });
  it("evicts old selected-timeframe entries even before TTL expires",async()=>{
    vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-10-21T14:00:00Z"));
    for(let i=0;i<130;i++) await call(`sym=FORMCAP${i}&cadence=chart&timeframes=1m`);
    const calls=state.calls.length;
    await call("sym=FORMCAP0&cadence=chart&timeframes=1m");
    expect(state.calls).toHaveLength(calls+1);
  });
  it("rejects malformed or non-chart timeframe requests",async()=>{
    for(const query of ["cadence=chart&timeframes=D","timeframes=1m","cadence=chart&timeframes=1m&timeframes=5m"])
      expect((await call(`sym=FORMBAD1&${query}`)).status).toBe(400);
  });
});

describe("quote access guards precede every cache read", () => {
  const disabledNote = "second-resolution bars are not enabled";

  function formingFixture() {
    const t = Date.parse("2026-10-21T13:30:00Z");
    vi.spyOn(Date, "now").mockReturnValue(t + 65000);
    state.extra = { basis: "REALTIME", source: "polygon-live-second", asOfMs: t + 64999, forming: {
      version: 1, source: "polygon-live-second", generation: "4168b492-3fee-45f6-a1d1-b2d3183b24fa",
      generationStartedMs: t, revision: 2, sessionDate: "2026-10-21", asOfMs: t + 64999,
      streamFromMs: t + 60000, prefixThroughMs: t + 60000, dirtyPrefix: false,
      minutes: [[t, 100, 105, 99, 102, 100], [t + 60000, 102, 103, 101, 102, 5]],
      seconds: [[t + 64000, 102, 103, 101, 102, 5]],
    } };
  }

  it.each(["sym", "syms"])("refuses disabled seconds and mixed %s selections without upstream demand", async (param) => {
    for (const tf of ["1s", "5s", "15s", "30s", "1s,1m", "1s,1m,5s"]) {
      const response = await call(param + "=SECONDCOLD&cadence=chart&timeframes=" + tf);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        ...(param === "sym" ? { sym: "SECONDCOLD", quote: null } : { quotes: {} }),
        note: disabledNote, disabledTimeframes: tf.split(",").filter(t => t.endsWith("s")).sort(),
      });
    }
    expect(state.calls).toHaveLength(0);
  });

  it.each(["sym", "syms"])("takes a disabled seconds lever ahead of a warm %s payload", async (param) => {
    formingFixture();
    vi.stubEnv("HUB_REALTIME_QUOTES", "1");
    const sym = "SECONDWARM" + param;
    const query = param + "=" + sym + "&view=regular&cadence=chart&timeframes=1s,1m";
    const first = await (await call(query)).json();
    const quote = param === "sym" ? first.quote : first.quotes[sym];
    expect(quote.formingCandles.series["regular:1s"]).toHaveLength(1);
    expect(quote.formingCandles.series["regular:1m"]).toHaveLength(2);
    vi.stubEnv("HUB_REALTIME_QUOTES", "");
    const denied = await (await call(query)).json();
    expect(denied).toEqual(param === "sym"
      ? { sym, quote: null, note: disabledNote, disabledTimeframes: ["1s"] }
      : { quotes: {}, note: disabledNote, disabledTimeframes: ["1s"] });
    expect(state.calls).toHaveLength(1);
    vi.stubEnv("HUB_REALTIME_QUOTES", "1");
    const enabled = await (await call(query)).json();
    expect(param === "sym" ? enabled.quote : enabled.quotes[sym]).toEqual(quote);
    expect(state.calls).toHaveLength(1);
  });

  it.each(["sym", "syms"])("does not let a signed-out caller reuse a warm %s forming payload", async (param) => {
    formingFixture();
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
    const sym = "AUTHWARM" + param;
    const query = param + "=" + sym + "&view=regular&cadence=chart&timeframes=1m";
    state.user = null;
    expect((await call(query)).status).toBe(401);
    expect(state.calls).toHaveLength(0);
    state.user = { id: "reader" };
    const first = await (await call(query)).json();
    expect((param === "sym" ? first.quote : first.quotes[sym]).formingCandles).toBeDefined();
    state.user = null;
    const denied = await call(query);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(await denied.json()).toEqual({ error: "unauthenticated" });
    expect(state.calls).toHaveLength(1);
    expect(state.authCalls).toBe(3);
  });

  it("does not cache a disabled response when the seconds lever is enabled later", async () => {
    formingFixture();
    const query = "sym=SECONDLATER&cadence=chart&timeframes=1s";
    expect((await (await call(query)).json()).quote).toBeNull();
    expect(state.calls).toHaveLength(0);
    vi.stubEnv("HUB_REALTIME_QUOTES", "1");
    expect((await (await call(query)).json()).quote.formingCandles.series["regular:1s"]).toHaveLength(1);
    expect(state.calls).toHaveLength(1);
  });

  it.each(["error", "throw"])("fails closed on an auth %s even when a quote is warm", async (failure) => {
    const query = "sym=AUTHFAIL" + failure;
    await call(query);
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
    if (failure === "error") state.authError = new Error("verification rejected");
    else state.authThrows = true;
    const response = await call(query);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(state.calls).toHaveLength(1);
  });

  it("authenticates before a disabled seconds response when auth is required", async () => {
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
    state.user = null;
    expect((await call("syms=AUTHSECOND&cadence=chart&timeframes=1s")).status).toBe(401);
    expect(state.authCalls).toBe(1);
    expect(state.calls).toHaveLength(0);
  });

  it("applies a newly enabled auth requirement to an already warm ordinary quote", async () => {
    await call("syms=AUTHFLAGWARM");
    expect(state.authCalls).toBe(0);
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "1");
    state.user = null;
    expect((await call("syms=AUTHFLAGWARM")).status).toBe(401);
    expect(state.calls).toHaveLength(1);
  });

  it("keeps minute forming quotes and ordinary quotes available with the seconds lever off", async () => {
    formingFixture();
    const minute = await (await call("sym=MINUTEFLAGOFF&cadence=chart&timeframes=1m")).json();
    expect(minute.quote.formingCandles.series["regular:1m"]).toHaveLength(2);
    const ordinary = await (await call("sym=ORDINARYFLAGOFF")).json();
    expect(ordinary.quote.last).toBe(100);
    expect(ordinary.quote.formingCandles).toBeUndefined();
    expect(state.authCalls).toBe(0);
  });
});
