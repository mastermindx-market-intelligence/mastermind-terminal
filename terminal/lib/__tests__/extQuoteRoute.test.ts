// /api/ext-quote — the thin proxy over the Quote Hub's extended-hours fields.
//
// The route stripped `extSession`, so the UI had no way to know WHICH out-of-hours window a
// print came from and labelled everything "Overnight" — including an 08:15 ET pre-market
// print. This locks the passthrough, and the two things that must not change with it: the
// route never fetches an upstream of its own (the hub owns all ext data), and a symbol with
// no ext print stays `null` rather than acquiring a fabricated shape.
//
// LOCATION NOTE: this file lives in lib/__tests__/ — terminal/vitest.config.ts includes ONLY
// "lib/__tests__/**/*.test.ts", so a colocated app/api/.../route.test.ts would never be
// collected (same constraint documented in lib/__tests__/brainProxy.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/ext-quote/route";

let calls: string[];
let realFetch: typeof globalThis.fetch;

/** Fake Quote Hub returning `body` for /quotes. */
function installHub(body: Record<string, unknown>, status = 200) {
  globalThis.fetch = vi.fn(async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as any;
}

/** Each case uses a DISTINCT client IP so the module-global rate-limit buckets never bleed. */
let ipSeq = 0;
const req = (syms: string) =>
  new Request(`http://localhost/api/ext-quote?syms=${encodeURIComponent(syms)}`, {
    headers: { "cf-connecting-ip": `203.0.113.${++ipSeq}` },
  });

const quotes = async (syms: string) => (await (await GET(req(syms))).json()).quotes;

const extRow = (extra: Record<string, unknown> = {}) => ({
  sym: "NVDA", last: 180, extPrice: 181.5, extChg: 0.83, extTs: 1_800_000_000, ...extra,
});

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("/api/ext-quote — extSession passthrough", () => {
  it("relays each of the hub's three session values", async () => {
    for (const session of ["pre", "post", "overnight"]) {
      installHub({ NVDA: extRow({ extSession: session }) });
      const q = await quotes("NVDA");
      expect(q.NVDA.extSession, session).toBe(session);
      expect(q.NVDA.extPrice).toBe(181.5);
      expect(q.NVDA.extChg).toBe(0.83);
      expect(q.NVDA.extTs).toBe(1_800_000_000);
    }
  });

  it("omits the field entirely when the hub does not classify the print", async () => {
    installHub({ NVDA: extRow() });
    const q = await quotes("NVDA");
    expect(q.NVDA).toEqual({ extPrice: 181.5, extChg: 0.83, extTs: 1_800_000_000 });
    expect("extSession" in q.NVDA).toBe(false);
  });

  it("drops a session value it does not recognise instead of relaying it into a label", async () => {
    // The UI maps this straight onto a plain-word label; an unknown string would surface raw.
    installHub({ NVDA: extRow({ extSession: "weekend-crossing" }) });
    const q = await quotes("NVDA");
    expect("extSession" in q.NVDA).toBe(false);
    expect(q.NVDA.extPrice).toBe(181.5);
  });

  it("keeps the null shape for a symbol the hub has no ext print for", async () => {
    installHub({ NVDA: extRow({ extSession: "post" }), AAPL: { sym: "AAPL", last: 220 } });
    const q = await quotes("NVDA,AAPL");
    expect(q.AAPL).toBeNull();
    expect(q.NVDA.extSession).toBe("post");
  });

  it("returns 503 when the hub is unreachable so clients retain their last-good ext quote", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as any;
    const response = await GET(req("NVDA,AAPL"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "quote_hub_unavailable" });
  });

  it("returns 503 when the hub rejects the request instead of fabricating an all-null snapshot", async () => {
    installHub({ error: "overloaded" }, 500);
    const response = await GET(req("NVDA,AAPL"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "quote_hub_unavailable" });
  });

  it("only ever talks to the hub — no upstream feed of its own", async () => {
    installHub({ NVDA: extRow({ extSession: "pre" }) });
    await quotes("NVDA");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("127.0.0.1");
    expect(calls[0]).toContain("/quotes?syms=NVDA");
  });

  it("falls back to the quote timestamp when extTs is absent", async () => {
    installHub({ NVDA: { sym: "NVDA", extPrice: 181.5, extChg: 0.83, ts: 1_799_999_000, extSession: "post" } });
    expect((await quotes("NVDA")).NVDA.extTs).toBe(1_799_999_000);
  });
});
