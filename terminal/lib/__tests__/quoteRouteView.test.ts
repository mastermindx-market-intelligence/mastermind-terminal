/**
 * The main quote plane is regular-session data. Extended-hours data has its own
 * /api/ext-quote lane, so high-frequency watchlist/chart polls must be able to ask
 * Quote Hub for view=regular without spending or churning its 30-slot ExtFeed LRU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ syms: string[]; view?: string }>,
  extra: {} as Record<string,unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "reader" } } })) },
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

beforeEach(() => { state.calls = []; state.extra={}; });
afterEach(() => { vi.restoreAllMocks(); });

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
