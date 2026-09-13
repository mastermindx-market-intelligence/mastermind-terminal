/**
 * D2 — `/api/quote` may enforce its batch cap, but never in silence.
 *
 * The cap is legitimate: it bounds one poll's upstream fan-out (the hub chunks at 100, Tencent at
 * 30). What was not legitimate was `slice(0, MAX_BATCH)` with no 413, no flag and no remainder — a
 * caller that asked for 300 symbols received 200 in a response shaped exactly like a complete one,
 * so it had no way to know its later rows were never requested.
 *
 * In-product callers now plan under the cap (lib/quoteDemand.ts), so a correct client never sees
 * `truncated`. These tests pin it anyway: it is the fail-loud backstop for a client that gets it
 * wrong, and the contract any future consumer relies on.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ fetched: [] as string[][] }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "reader" } } })) },
  })),
}));

// Every requested symbol resolves, so anything absent from the response was never ASKED for —
// which is exactly the condition the silent slice made invisible.
vi.mock("@/lib/intradaySources", () => ({
  fetchQuotes: vi.fn(async (syms: string[]) => {
    state.fetched.push(syms);
    return Object.fromEntries(syms.map((s) => [s, { last: 1, chg: 0, basis: "EOD" }]));
  }),
}));

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  tooMany: vi.fn(),
}));

import { GET } from "@/app/api/quote/route";

// The route's quote CACHE is module-level and survives between tests, so a shared symbol space
// would let a later request be served entirely from cache — making "was it fetched upstream?"
// vacuously true. Each test gets its own namespace so every assertion is about THIS request.
const sym = (ns: string, i: number) => `${ns}${String(i).padStart(4, "0")}`;
const list = (ns: string, n: number) => Array.from({ length: n }, (_, i) => sym(ns, i));
const call = (syms: string[]) =>
  GET(new Request(`https://app.mastermind-x.com/api/quote?syms=${encodeURIComponent(syms.join(","))}`));

beforeEach(() => { state.fetched = []; });

describe("D2 — the batch cap reports itself", () => {
  it("an over-cap request names exactly what it dropped", async () => {
    const asked = list("A", 300);
    const body = await (await call(asked)).json();

    expect(body.truncated).toBeTruthy();
    expect(body.truncated.requested).toBe(300);
    expect(body.truncated.served).toBe(200);
    expect(body.truncated.omitted).toHaveLength(100);
    // Named, not merely counted — a consumer can schedule precisely these.
    expect(body.truncated.omitted[0]).toBe(sym("A", 200));
    expect(body.truncated.omitted.at(-1)).toBe(sym("A", 299));
  });

  it("the omitted symbols really were never requested upstream (the defect itself)", async () => {
    const body = await (await call(list("B", 300))).json();
    const requestedUpstream = new Set(state.fetched.flat());
    for (const s of body.truncated.omitted) expect(requestedUpstream.has(s)).toBe(false);
    // …and the response carries no key for them, so "absent" cannot be read as "no live leg".
    for (const s of body.truncated.omitted) expect(s in body.quotes).toBe(false);
  });

  it("a within-cap request is not labelled truncated", async () => {
    const body = await (await call(list("C", 40))).json();
    expect(body.truncated).toBeUndefined();
    expect(Object.keys(body.quotes)).toHaveLength(40);
  });

  it("a request exactly at the cap is not labelled truncated", async () => {
    const body = await (await call(list("D", 200))).json();
    expect(body.truncated).toBeUndefined();
    expect(Object.keys(body.quotes)).toHaveLength(200);
  });

  it("the chart fast lane keeps its own tighter cap and reports it too", async () => {
    const asked = list("E", 20);
    const res = await GET(new Request(
      `https://app.mastermind-x.com/api/quote?cadence=chart&syms=${encodeURIComponent(asked.join(","))}`,
    ));
    const body = await res.json();
    expect(body.truncated.requested).toBe(20);
    expect(body.truncated.served).toBe(8);
  });
});
