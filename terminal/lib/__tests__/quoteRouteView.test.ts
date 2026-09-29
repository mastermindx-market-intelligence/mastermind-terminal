/**
 * The main quote plane is regular-session data. Extended-hours data has its own
 * /api/ext-quote lane, so high-frequency watchlist/chart polls must be able to ask
 * Quote Hub for view=regular without spending or churning its 30-slot ExtFeed LRU.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ syms: string[]; view?: string }>,
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
      sym, last: 100, prevClose: 99, chg: 1.0101, basis: "DELAYED_15M",
    }]));
  }),
}));

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  tooMany: vi.fn(),
}));

import { GET } from "@/app/api/quote/route";

const call = (query: string) => GET(new Request(`https://app.mastermind-x.com/api/quote?${query}`));

beforeEach(() => { state.calls = []; });

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
