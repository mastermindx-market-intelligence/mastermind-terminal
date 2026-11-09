"use strict";
// Unit tests for the Webull leg of lib/extfeed.js — the session-window gate,
// staleness rejection, ticker-id resolution, LRU, and serve priority.
// Run with: node --test "tests/*.test.js"   (Node ≥ 18 built-in test runner)
// Or via:   npm test  (from hub/ directory)
//
// Fully offline: the HTTP transport is injected. No network calls.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  ExtFeed,
  WebullFeed,
  webullExtractPrint,
  classifySession,
  WEBULL_LRU_CAP,
  EXT_CACHE_CAP,
  boundedCacheSet,
} = require("../lib/extfeed");

// ── Helpers ──────────────────────────────────────────────────────────────────

// ET in July = EDT = UTC-4.  etMs(2026, 7, 26, 21, 0) → Sunday 21:00 ET.
// Date.UTC normalises an hour ≥ 24 into the next day, so hh+4 is safe.
function etMs(y, mon, d, hh, mm = 0) {
  return Date.UTC(y, mon - 1, d, hh + 4, mm);
}

// Webull stamps tradeTime as ISO-8601 with a colon-less "+0000" offset.
function wbTime(ms) {
  return new Date(ms).toISOString().replace("Z", "+0000");
}

// Calendar anchors — 2026-07-24 is a Friday, 07-26 a Sunday, 07-27 a Monday.
const FRI_POST = etMs(2026, 7, 24, 17, 0);      // Friday 17:00 ET → post
const SUN_ON_2100 = etMs(2026, 7, 26, 21, 0);   // Sunday 21:00 ET → overnight
const SUN_ON_2230 = etMs(2026, 7, 26, 22, 30);  // Sunday 22:30 ET → overnight
const SUN_ON_2300 = etMs(2026, 7, 26, 23, 0);   // Sunday 23:00 ET → overnight
const MON_PRE_0545 = etMs(2026, 7, 27, 5, 45);  // Monday 05:45 ET → pre
const MON_RTH_1100 = etMs(2026, 7, 27, 11, 0);  // Monday 11:00 ET → rth

// The exact getQuote payload observed live from the VPS on 2026-07-27 (pre-market).
// tradeTime 09:31:39.474Z = 05:31:39 ET. Every numeric field is a STRING.
const SOFI_LIVE_PAYLOAD = {
  tickerId: 950178653,
  tradeTime: "2026-07-27T09:31:39.474+0000",
  status: "F",
  close: "16.46",
  preClose: "16.65",
  pPrice: "16.74",
  pChange: "0.28",
  pChRatio: "0.0170",
  pHigh: "16.80",
  pLow: "16.64",
  pVolume: "55511",
  overnight: 0,
  timeZone: "America/New_York",
};

// ── Calendar sanity (the gate tests are meaningless if these drift) ──────────

describe("webull test calendar anchors", () => {
  it("classify the sessions the gate tests depend on", () => {
    assert.equal(classifySession(FRI_POST), "post", "Friday 17:00 ET");
    assert.equal(classifySession(SUN_ON_2100), "overnight", "Sunday 21:00 ET");
    assert.equal(classifySession(SUN_ON_2230), "overnight", "Sunday 22:30 ET");
    assert.equal(classifySession(SUN_ON_2300), "overnight", "Sunday 23:00 ET");
    assert.equal(classifySession(MON_PRE_0545), "pre", "Monday 05:45 ET");
    assert.equal(classifySession(MON_RTH_1100), "rth", "Monday 11:00 ET");
  });
});

// ── webullExtractPrint — the honesty gate ────────────────────────────────────

describe("webullExtractPrint — session-window gate", () => {
  it("REJECTS a Friday post print when the current session is Sunday overnight", () => {
    // The load-bearing rule: Webull keeps serving Friday's last extended print all
    // weekend. Without the session check, that stale number would be published as
    // live Sunday-overnight data.
    const json = { pPrice: "16.74", tradeTime: wbTime(FRI_POST) };
    assert.equal(webullExtractPrint(json, SUN_ON_2100), null);
  });

  it("ACCEPTS a print whose own session matches the current session", () => {
    const json = { pPrice: "16.74", tradeTime: wbTime(SUN_ON_2230) };
    const print = webullExtractPrint(json, SUN_ON_2300);
    assert.ok(print, "a same-session, 30-min-old print is servable");
    assert.equal(print.price, 16.74);
    assert.equal(print.ts, Math.floor(SUN_ON_2230 / 1000));
    assert.equal(print.session, "overnight");
    assert.equal(print.source, "webull");
  });

  it("REJECTS a pre-market print when the current session is overnight", () => {
    const json = { pPrice: "16.74", tradeTime: wbTime(etMs(2026, 7, 27, 6, 0)) };
    // Monday 06:00 ET print, read during Sunday overnight (future + wrong session).
    assert.equal(webullExtractPrint(json, SUN_ON_2300), null);
  });

  it("returns null during RTH regardless of the payload", () => {
    const json = { pPrice: "16.74", tradeTime: wbTime(MON_RTH_1100) };
    assert.equal(webullExtractPrint(json, MON_RTH_1100), null,
      "ext fields never exist in RTH — this is what makes the display vanish at 09:30 ET");
  });
});

describe("webullExtractPrint — staleness gate", () => {
  it("REJECTS a same-session print older than 90 minutes", () => {
    // Sunday 21:00 → Sunday 23:00 is 120 min; both classify as overnight, so only
    // the age gate can catch it.
    const json = { pPrice: "16.74", tradeTime: wbTime(SUN_ON_2100) };
    assert.equal(webullExtractPrint(json, SUN_ON_2300), null);
  });

  it("accepts at 89 minutes, rejects at 91 minutes", () => {
    const ok = { pPrice: "16.74", tradeTime: wbTime(SUN_ON_2300 - 89 * 60 * 1000) };
    const stale = { pPrice: "16.74", tradeTime: wbTime(SUN_ON_2300 - 91 * 60 * 1000) };
    assert.ok(webullExtractPrint(ok, SUN_ON_2300), "89 min is inside the window");
    assert.equal(webullExtractPrint(stale, SUN_ON_2300), null, "91 min is outside it");
  });

  it("REJECTS a future-dated print (clock-skew / parse defect, not data)", () => {
    const json = { pPrice: "16.74", tradeTime: wbTime(SUN_ON_2300 + 10 * 60 * 1000) };
    assert.equal(webullExtractPrint(json, SUN_ON_2300), null);
  });
});

describe("webullExtractPrint — field extraction", () => {
  it("coerces the live SOFI payload's string fields to numbers", () => {
    const print = webullExtractPrint(SOFI_LIVE_PAYLOAD, MON_PRE_0545);
    assert.ok(print, "the live pre-market payload must be accepted");
    assert.equal(print.price, 16.74);
    assert.equal(typeof print.price, "number", "pPrice arrives as a STRING and must be Number()d");
    assert.equal(typeof print.ts, "number");
    assert.equal(print.ts, Math.floor(Date.UTC(2026, 6, 27, 9, 31, 39, 474) / 1000));
    assert.equal(print.session, "pre");
    assert.equal(print.key, "pPrice");
  });

  it("NEVER serves a speculative overnight field — pPrice wins even when one is present", () => {
    // ovnPrice / overnightPrice / ovPrice / overnightPx were guesses: Webull has never been
    // observed emitting any of them from this VPS. Preferring a guessed key means the first
    // time an unrelated field happens to match one of those names, an unvalidated number
    // silently becomes the price on the tape. They are discovery telemetry, nothing more.
    for (const key of ["ovnPrice", "overnightPrice", "ovPrice", "overnightPx"]) {
      const json = { [key]: "17.10", pPrice: "16.74", tradeTime: wbTime(SUN_ON_2230) };
      const print = webullExtractPrint(json, SUN_ON_2300);
      assert.ok(print, key);
      assert.equal(print.price, 16.74, `${key} must not displace the verified pPrice`);
      assert.equal(print.key, "pPrice", "the served key is always pPrice");
    }
  });

  it("a speculative field alone is NOT a print — no pPrice means no quote", () => {
    for (const key of ["ovnPrice", "overnightPrice", "ovPrice", "overnightPx"]) {
      const json = { [key]: "17.10", tradeTime: wbTime(SUN_ON_2230) };
      assert.equal(webullExtractPrint(json, SUN_ON_2300), null,
        `${key} must not be able to originate a price on its own`);
    }
  });

  it("serves pPrice regardless of what the speculative keys contain", () => {
    for (const bad of [null, undefined, "", "0", "-1", "n/a", "17.10"]) {
      const json = { ovnPrice: bad, pPrice: "16.74", tradeTime: wbTime(SUN_ON_2230) };
      const print = webullExtractPrint(json, SUN_ON_2300);
      assert.ok(print, `ovnPrice=${JSON.stringify(bad)} must not change the outcome`);
      assert.equal(print.price, 16.74);
      assert.equal(print.key, "pPrice");
    }
  });

  it("returns null when there is no usable price", () => {
    const t = wbTime(SUN_ON_2230);
    assert.equal(webullExtractPrint({ tradeTime: t }, SUN_ON_2300), null, "no pPrice at all");
    assert.equal(webullExtractPrint({ pPrice: null, tradeTime: t }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "", tradeTime: t }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "0", tradeTime: t }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "-3.2", tradeTime: t }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "halted", tradeTime: t }, SUN_ON_2300), null);
  });

  it("returns null when tradeTime is missing or unparseable", () => {
    assert.equal(webullExtractPrint({ pPrice: "16.74" }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "16.74", tradeTime: "" }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "16.74", tradeTime: "not-a-date" }, SUN_ON_2300), null);
    assert.equal(webullExtractPrint({ pPrice: "16.74", tradeTime: null }, SUN_ON_2300), null);
  });

  it("REJECTS a tradeTime with no explicit UTC offset — the offset IS the difference", () => {
    // Date.parse on an offset-less timestamp applies the SERVER's local zone. The same payload
    // then yields a different instant on a UTC box than on an ET one, and the session and
    // staleness gates below compare it against the wrong window — silently, with no error.
    //
    // The naive stamp is built from the HOST's local wall clock for a known-good instant, so
    // the unguarded Date.parse resolves it back to exactly that instant on every machine and
    // the print would sail through all four gates. Only the offset check can reject it — which
    // makes this test discriminating under any TZ, not just the UTC runner. A fixed-digit
    // string would instead be rejected for an accidental reason (wrong session / future-dated)
    // on most zones, and would sit green against the unfixed code on an ET host.
    const p = (n) => String(n).padStart(2, "0");
    const d = new Date(SUN_ON_2230);
    const localNaive =
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
      `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;

    assert.equal(webullExtractPrint({ pPrice: "16.74", tradeTime: localNaive }, SUN_ON_2300), null,
      "an offset-less stamp must be rejected, not guessed at with the server's zone");
    // The identical instant WITH an offset is accepted — the offset is the whole difference.
    const withOffset = new Date(SUN_ON_2230).toISOString();
    const ok = webullExtractPrint({ pPrice: "16.74", tradeTime: withOffset }, SUN_ON_2300);
    assert.ok(ok, "the same print with an explicit Z must still be served");
    assert.equal(ok.ts, Math.floor(SUN_ON_2230 / 1000));

    for (const bad of [localNaive.replace("T", " "), "2026-07-27 09:31:39", "2026/07/27 09:31:39"]) {
      assert.equal(webullExtractPrint({ pPrice: "16.74", tradeTime: bad }, SUN_ON_2300), null,
        `offset-less "${bad}" must not be guessed at`);
    }
  });

  it("ACCEPTS both offset forms Webull is known to send", () => {
    const iso = new Date(SUN_ON_2230).toISOString();
    for (const good of [
      iso,                                  // "…T02:30:00.000Z"
      iso.replace("Z", "+0000"),            // colon-less offset — the live payload's form
      iso.replace("Z", "+00:00"),           // colon'd offset
      iso.replace("Z", "-04:00"),           // a non-zero offset still parses to a real instant
    ]) {
      const print = webullExtractPrint({ pPrice: "16.74", tradeTime: good }, SUN_ON_2300);
      assert.ok(print !== undefined, good);
      // The -04:00 form is a DIFFERENT instant (4 h later) and legitimately fails the freshness
      // gate; the other three are the same instant and must be accepted.
      if (!good.endsWith("-04:00")) {
        assert.ok(print, `"${good}" carries an explicit offset and must be accepted`);
        assert.equal(print.ts, Math.floor(SUN_ON_2230 / 1000));
      }
    }
  });

  it("returns null for a non-object payload", () => {
    for (const bad of [null, undefined, "", 0, "string", []]) {
      assert.equal(webullExtractPrint(bad, SUN_ON_2300), null);
    }
  });
});

// ── WebullFeed — ticker-id resolution ────────────────────────────────────────

describe("WebullFeed.resolveTickerId", () => {
  function searchResponse(rows) {
    return { data: rows };
  }

  it("matches on exact disSymbol + regionCode US + template stock", async () => {
    const feed = new WebullFeed({
      fetchJson: async () => searchResponse([
        { tickerId: 950178653, type: 2, template: "stock", disSymbol: "SOFI", regionCode: "US" },
      ]),
    });
    assert.equal(await feed.resolveTickerId("SOFI"), 950178653);
  });

  it("rejects near-miss rows (different symbol, region, or template)", async () => {
    const feed = new WebullFeed({
      fetchJson: async () => searchResponse([
        { tickerId: 1, template: "stock", disSymbol: "SOFIX", regionCode: "US" },   // prefix match
        { tickerId: 2, template: "stock", disSymbol: "SOFI", regionCode: "HK" },    // wrong region
        { tickerId: 3, template: "index", disSymbol: "SOFI", regionCode: "US" },    // wrong template
      ]),
    });
    assert.equal(await feed.resolveTickerId("SOFI"), null);
  });

  it("picks the qualifying row even when it is not first", async () => {
    const feed = new WebullFeed({
      fetchJson: async () => searchResponse([
        { tickerId: 1, template: "etf", disSymbol: "SOFI", regionCode: "US" },
        { tickerId: 950178653, template: "stock", disSymbol: "SOFI", regionCode: "US" },
      ]),
    });
    assert.equal(await feed.resolveTickerId("SOFI"), 950178653);
  });

  it("caches a positive result — no second search request", async () => {
    let calls = 0;
    const feed = new WebullFeed({
      fetchJson: async () => {
        calls++;
        return searchResponse([{ tickerId: 950178653, template: "stock", disSymbol: "SOFI", regionCode: "US" }]);
      },
    });
    await feed.resolveTickerId("SOFI");
    await feed.resolveTickerId("SOFI");
    await feed.resolveTickerId("SOFI");
    assert.equal(calls, 1, "tickerId is cached for the process lifetime");
  });

  it("caches a miss so an unlisted ticker cannot hammer the search endpoint", async () => {
    let calls = 0;
    const feed = new WebullFeed({
      fetchJson: async () => { calls++; return searchResponse([]); },
    });
    assert.equal(await feed.resolveTickerId("NOPE"), null);
    assert.equal(await feed.resolveTickerId("NOPE"), null);
    assert.equal(calls, 1, "the negative result is cached (1 h TTL)");
  });

  it("re-searches once the negative TTL has expired", async () => {
    let calls = 0;
    const feed = new WebullFeed({
      fetchJson: async () => { calls++; return searchResponse([]); },
    });
    await feed.resolveTickerId("NOPE");
    // Age the miss past the 1 h TTL.
    feed.misses.set("NOPE", Date.now() - 61 * 60 * 1000);
    await feed.resolveTickerId("NOPE");
    assert.equal(calls, 2);
  });

  it("survives a null / malformed search response", async () => {
    const feed = new WebullFeed({ fetchJson: async () => null });
    assert.equal(await feed.resolveTickerId("SOFI"), null);
    const feed2 = new WebullFeed({ fetchJson: async () => ({ data: "nope" }) });
    assert.equal(await feed2.resolveTickerId("SOFI"), null);
  });
});

// ── WebullFeed — LRU + poll ──────────────────────────────────────────────────

describe("bounded last-good ext cache", () => {
  it(`retains more symbols than the ${WEBULL_LRU_CAP}-subscription feed while staying capped`, () => {
    const cache = new Map();
    for (let i = 0; i <= EXT_CACHE_CAP; i++) {
      boundedCacheSet(cache, `S${i}`, { price: i, ts: i, session: "pre", source: "test" });
    }
    assert.equal(cache.size, EXT_CACHE_CAP);
    assert.ok(!cache.has("S0"), "only the oldest retained print is evicted at the independent cache cap");
    assert.ok(cache.has(`S${EXT_CACHE_CAP}`));
  });
});

describe("WebullFeed LRU demand management", () => {
  it(`evicts the LRU subscription at cap (${WEBULL_LRU_CAP}) without erasing its last-good print`, () => {
    const feed = new WebullFeed({ fetchJson: async () => null });
    feed.demand("FIRST");
    const lastGood = { price: 1, ts: 1, session: "pre", source: "webull" };
    feed.cache.set("FIRST", lastGood);
    for (let i = 1; i < WEBULL_LRU_CAP; i++) feed.demand(`S${i}`);
    assert.equal(feed.subs.size, WEBULL_LRU_CAP);
    feed.demand("NEWCOMER");
    assert.equal(feed.subs.size, WEBULL_LRU_CAP, "size stays at cap");
    assert.ok(!feed.subs.has("FIRST"), "LRU subscription is evicted");
    assert.deepEqual(feed.get("FIRST"), lastGood,
      "eviction stops future refresh; serve-time session/age gates decide when the prior print expires");
  });

  it("does not start a timer without an explicit start()", () => {
    const feed = new WebullFeed({ fetchJson: async () => null });
    assert.equal(feed.timer, null);
  });
});

describe("WebullFeed.runPoll", () => {
  it("makes no request during RTH", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: MON_RTH_1100 });
    let calls = 0;
    const feed = new WebullFeed({ fetchJson: async () => { calls++; return null; } });
    feed.demand("SOFI");
    await feed.runPoll();
    assert.equal(calls, 0, "ext data is suppressed in RTH — do not even ask");
  });

  it("caches an accepted print", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: MON_PRE_0545 });
    const feed = new WebullFeed({
      fetchJson: async (url) => {
        if (url.includes("/search/")) {
          return { data: [{ tickerId: 950178653, template: "stock", disSymbol: "SOFI", regionCode: "US" }] };
        }
        return SOFI_LIVE_PAYLOAD;
      },
    });
    feed.demand("SOFI");
    await feed.runPoll();
    const entry = feed.get("SOFI");
    assert.ok(entry, "an accepted print must be cached");
    assert.equal(entry.price, 16.74);
    assert.equal(entry.session, "pre");
    assert.equal(entry.source, "webull");
    assert.equal(feed.consecutiveErrors, 0);
  });

  it("writes NOTHING when the print fails the gate, preserving the prior entry", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: SUN_ON_2100 });
    const prior = { price: 20.0, ts: Math.floor((SUN_ON_2100 - 5 * 60 * 1000) / 1000), session: "overnight", source: "webull" };
    const feed = new WebullFeed({
      fetchJson: async (url) => {
        if (url.includes("/search/")) {
          return { data: [{ tickerId: 950178653, template: "stock", disSymbol: "SOFI", regionCode: "US" }] };
        }
        // Friday's stale post print — must be rejected by the session gate.
        return { pPrice: "16.74", tradeTime: wbTime(FRI_POST) };
      },
    });
    feed.demand("SOFI");
    feed.cache.set("SOFI", prior);
    await feed.runPoll();
    assert.deepEqual(feed.get("SOFI"), prior, "a rejected print must not overwrite the cache");
  });

  it("skips a symbol whose tickerId cannot be resolved", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: MON_PRE_0545 });
    let quoteCalls = 0;
    const feed = new WebullFeed({
      fetchJson: async (url) => {
        if (url.includes("/search/")) return { data: [] };
        quoteCalls++;
        return SOFI_LIVE_PAYLOAD;
      },
    });
    feed.demand("NOPE");
    await feed.runPoll();
    assert.equal(quoteCalls, 0, "no tickerId → no quote request");
    assert.equal(feed.get("NOPE"), null);
  });

  it("never throws when the transport rejects", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: MON_PRE_0545 });
    const feed = new WebullFeed({
      fetchJson: async () => { throw new Error("ECONNRESET"); },
    });
    feed.demand("SOFI");
    await feed.runPoll(); // must resolve
    assert.ok(feed.consecutiveErrors >= 1, "the failure is counted, not thrown");
  });

  it("reports health in the documented shape", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: MON_PRE_0545 });
    const feed = new WebullFeed({
      fetchJson: async (url) =>
        url.includes("/search/")
          ? { data: [{ tickerId: 950178653, template: "stock", disSymbol: "SOFI", regionCode: "US" }] }
          : SOFI_LIVE_PAYLOAD,
    });
    feed.demand("SOFI");
    await feed.runPoll();
    const h = feed.health();
    assert.equal(h.subs, 1);
    assert.equal(h.cacheSize, 1);
    assert.equal(h.tickerIds, 1);
    assert.equal(h.consecutiveErrors, 0);
    assert.ok(typeof h.lastPollAt === "string", "lastPollAt is an ISO string after a poll");
  });
});

// ── ExtFeed serve priority: alpaca → webull → yahoo ──────────────────────────

describe("ExtFeed serve priority — alpaca → webull → yahoo", () => {
  const now = MON_PRE_0545;
  const tsNow = Math.floor((now - 60 * 1000) / 1000);

  function seedAll(feed) {
    if (feed._extMap) {
      feed._extMap.set("AAPL", { price: 315.0, ts: tsNow, session: "pre", source: "alpaca_overnight" });
    }
    if (feed.webull) {
      feed.webull.cache.set("AAPL", { price: 314.0, ts: tsNow, session: "pre", source: "webull" });
    }
    if (feed._yahooCache) {
      feed._yahooCache.set("AAPL", { price: 313.0, ts: tsNow, session: "pre", source: "yahoo_unofficial" });
    }
  }

  it("serves Alpaca first when it is authed and has the symbol", () => {
    const feed = new ExtFeed({ alpacaKey: "k", alpacaSecret: "s" });
    try {
      seedAll(feed);
      feed.alpaca.authFailed = false;
      const ext = feed.getExt("AAPL", now, 313.39);
      assert.equal(ext.extPrice, 315.0);
      assert.equal(ext.extSource, "alpaca_overnight");
    } finally { feed.stop(); }
  });

  it("falls to Webull when Alpaca auth failed", () => {
    const feed = new ExtFeed({ alpacaKey: "k", alpacaSecret: "s" });
    try {
      seedAll(feed);
      feed.alpaca.authFailed = true;
      const ext = feed.getExt("AAPL", now, 313.39);
      assert.equal(ext.extPrice, 314.0);
      assert.equal(ext.extSource, "webull");
    } finally { feed.stop(); }
  });

  it("falls to Webull when Alpaca is healthy but has no print for the symbol", () => {
    const feed = new ExtFeed({ alpacaKey: "k", alpacaSecret: "s" });
    try {
      seedAll(feed);
      feed._extMap.delete("AAPL");
      feed.alpaca.authFailed = false;
      const ext = feed.getExt("AAPL", now, 313.39);
      assert.equal(ext.extSource, "webull", "an empty Alpaca map must not blank the ext block");
    } finally { feed.stop(); }
  });

  it("falls to Yahoo only when both Alpaca and Webull are empty", () => {
    const feed = new ExtFeed({ alpacaKey: "k", alpacaSecret: "s" });
    try {
      seedAll(feed);
      feed.alpaca.authFailed = true;
      feed.webull.cache.delete("AAPL");
      const ext = feed.getExt("AAPL", now, 313.39);
      assert.equal(ext.extPrice, 313.0);
      assert.equal(ext.extSource, "yahoo_unofficial");
    } finally { feed.stop(); }
  });

  it("Webull outranks Yahoo in keyless (no-Alpaca) mode too", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      seedAll(feed);
      const ext = feed.getExt("AAPL", now, 313.39);
      assert.equal(ext.extSource, "webull");
    } finally { feed.stop(); }
  });

  it("computes extChg from the passed close reference for a Webull print", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      seedAll(feed);
      const prevClose = 313.39;
      const ext = feed.getExt("AAPL", now, prevClose);
      const expected = ((314.0 - prevClose) / prevClose) * 100;
      assert.ok(Math.abs(ext.extChg - expected) < 1e-9, `extChg=${ext.extChg} expected≈${expected}`);
      assert.equal(ext.extTs, tsNow);
      assert.equal(ext.extSession, "pre");
    } finally { feed.stop(); }
  });

  it("returns null during RTH even with a fresh Webull print", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      feed.webull.cache.set("AAPL", {
        price: 314.0,
        ts: Math.floor(MON_RTH_1100 / 1000),
        session: "pre",
        source: "webull",
      });
      assert.equal(feed.getExt("AAPL", MON_RTH_1100, 313.39), null);
    } finally { feed.stop(); }
  });

  it("applies the 90-minute serve-time stale guard to Webull entries", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      feed.webull.cache.set("AAPL", {
        price: 314.0,
        ts: Math.floor((now - 91 * 60 * 1000) / 1000),
        session: "pre",
        source: "webull",
      });
      assert.equal(feed.getExt("AAPL", now, 313.39), null, "a 91-min-old print is not servable");
    } finally { feed.stop(); }
  });

  it("a retained stale Webull print cannot block a fresh Yahoo fallback", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      feed.webull.cache.set("AAPL", {
        price: 314.0,
        ts: Math.floor((now - 91 * 60 * 1000) / 1000),
        session: "pre",
        source: "webull",
      });
      feed._yahooCache.set("AAPL", {
        price: 313.5,
        ts: Math.floor((now - 60 * 1000) / 1000),
        session: "pre",
        source: "yahoo_unofficial",
      });
      const ext = feed.getExt("AAPL", now, 313.39);
      assert.ok(ext, "provider priority applies only among currently servable candidates");
      assert.equal(ext.extPrice, 313.5);
      assert.equal(ext.extSource, "yahoo_unofficial");
    } finally { feed.stop(); }
  });

  it("ignores a cache entry with no finite price (never serves an empty ext block)", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      // Shape defect: a producer wrote extPrice/extTs instead of price/ts.
      feed._yahooCache.set("AAPL", { extPrice: 313.0, extTs: tsNow, session: "pre", source: "yahoo-relay" });
      assert.equal(feed.getExt("AAPL", now, 313.39), null,
        "a populated extSource with a missing extPrice is worse than no ext block");
    } finally { feed.stop(); }
  });

  it("demand() mirrors the symbol into the Webull leg", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      feed.demand("AAPL");
      assert.ok(feed.webull.subs.has("AAPL"));
      assert.ok(feed._yahooSubs.has("AAPL"), "the existing yahoo mirroring is unchanged");
    } finally { feed.stop(); }
  });

  it("health() exposes the webull block", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      feed.demand("AAPL");
      const h = feed.health();
      assert.ok(h.webull, "health must carry a webull block");
      assert.equal(h.webull.subs, 1);
      assert.equal(h.webull.cacheSize, 0);
    } finally { feed.stop(); }
  });
});

// ── R2 relay → _yahooCache → getExt ──────────────────────────────────────────
//
// The relay FILE speaks extPrice/extTs (it is shaped for the API response); the CACHE speaks
// price/ts, which is what validExtEntry/getExt read. Writing the file's own field names into
// the cache made every relay hit invisible — and the branch `return`s before the direct-Yahoo
// calls, so a FRESH relay file produced strictly LESS ext data than a stale one. Driven end to
// end through _runYahooPoll here: a shape test on the writer alone would not have caught the
// suppression half of the bug.

describe("ExtFeed R2 relay — a fresh relay file actually serves", () => {
  const now = MON_PRE_0545;
  const relayTs = Math.floor((now - 90 * 1000) / 1000);

  /** A relay file as published to R2: asof_utc + quotes keyed by symbol. */
  function relayFile(asofMs, quotes) {
    return { asof_utc: new Date(asofMs).toISOString(), quotes };
  }

  function feedWithRelay(file, { onYahooDirect } = {}) {
    return new ExtFeed({
      alpacaKey: "", alpacaSecret: "",
      fetchRelay: async () => file,
      fetchYahooExt: async (sym) => { if (onYahooDirect) onYahooDirect(sym); return null; },
    });
  }

  it("a relay-shaped payload reaches getExt as a servable ext quote", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const feed = feedWithRelay(relayFile(now - 60 * 1000, {
      AAPL: { extPrice: 313.5, extTs: relayTs, close: 310.0 },
    }));
    try {
      feed.demand("AAPL");
      await feed._runYahooPoll();
      const ext = feed.getExt("AAPL", now, 310.0);
      assert.ok(ext, "a fresh relay hit must produce an ext block, not nothing");
      assert.equal(ext.extPrice, 313.5);
      assert.equal(ext.extTs, relayTs);
      assert.equal(ext.extSource, "yahoo-relay");
      assert.equal(ext.extSession, "pre");
      const expected = ((313.5 - 310.0) / 310.0) * 100;
      assert.ok(Math.abs(ext.extChg - expected) < 1e-9);
    } finally { feed.stop(); }
  });

  it("writes the cache in the SAME { price, ts, session, source } shape as every other leg", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const feed = feedWithRelay(relayFile(now - 60 * 1000, { AAPL: { extPrice: 313.5, extTs: relayTs } }));
    try {
      feed.demand("AAPL");
      await feed._runYahooPoll();
      assert.deepEqual(feed._yahooCache.get("AAPL"), {
        price: 313.5, ts: relayTs, session: "pre", source: "yahoo-relay",
      });
    } finally { feed.stop(); }
  });

  it("falls back to the relay file's asof when an entry carries no extTs", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const asof = now - 60 * 1000;
    const feed = feedWithRelay(relayFile(asof, { AAPL: { extPrice: 313.5 } }));
    try {
      feed.demand("AAPL");
      await feed._runYahooPoll();
      assert.equal(feed.getExt("AAPL", now, 310.0).extTs, Math.floor(asof / 1000));
    } finally { feed.stop(); }
  });

  it("consuming a fresh relay skips the direct-Yahoo calls (the whole point of the relay)", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const direct = [];
    const feed = feedWithRelay(
      relayFile(now - 60 * 1000, { AAPL: { extPrice: 313.5, extTs: relayTs } }),
      { onYahooDirect: (s) => direct.push(s) },
    );
    try {
      feed.demand("AAPL");
      await feed._runYahooPoll();
      assert.deepEqual(direct, [], "the VPS IP is Yahoo-429-blocked — one relay fetch replaces N");
      assert.ok(feed.getExt("AAPL", now, 310.0), "…and the symbol is still served");
    } finally { feed.stop(); }
  });

  it("a STALE relay file is ignored and the direct leg runs instead", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const direct = [];
    const feed = feedWithRelay(
      relayFile(now - 6 * 60 * 1000, { AAPL: { extPrice: 313.5, extTs: relayTs } }), // >5 min old
      { onYahooDirect: (s) => direct.push(s) },
    );
    try {
      feed.demand("AAPL");
      await feed._runYahooPoll();
      assert.deepEqual(direct, ["AAPL"], "a stale relay must not suppress the fallback");
      assert.equal(feed._yahooCache.get("AAPL"), undefined, "and must not seed the cache");
    } finally { feed.stop(); }
  });

  it("an unreachable relay falls through to the direct leg", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const direct = [];
    const feed = feedWithRelay(null, { onYahooDirect: (s) => direct.push(s) });
    try {
      feed.demand("AAPL");
      await feed._runYahooPoll();
      assert.deepEqual(direct, ["AAPL"]);
    } finally { feed.stop(); }
  });

  it("skips a relay entry with no finite extPrice rather than caching a hole", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const feed = feedWithRelay(relayFile(now - 60 * 1000, {
      AAPL: { extPrice: null, extTs: relayTs },
      MSFT: { extPrice: "413.2", extTs: relayTs },   // a string is not a number here
    }));
    try {
      feed.demand("AAPL");
      feed.demand("MSFT");
      await feed._runYahooPoll();
      assert.equal(feed.getExt("AAPL", now, 310.0), null);
      assert.equal(feed.getExt("MSFT", now, 410.0), null);
    } finally { feed.stop(); }
  });
});

// ── Kill switches ────────────────────────────────────────────────────────────

describe("WEBULL_DISABLE=1", () => {
  before(() => { process.env.WEBULL_DISABLE = "1"; });
  after(() => { delete process.env.WEBULL_DISABLE; });

  it("drops the Webull leg without touching Alpaca or Yahoo", () => {
    const feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      assert.equal(feed.webull, null, "the leg must not be constructed");
      feed.demand("AAPL"); // must not throw
      assert.ok(feed._yahooSubs.has("AAPL"), "the yahoo leg still works");
      assert.deepEqual(feed.health().webull, { disabled: true });

      // A Yahoo entry is still served.
      const now = MON_PRE_0545;
      feed._yahooCache.set("AAPL", {
        price: 313.0,
        ts: Math.floor((now - 60 * 1000) / 1000),
        session: "pre",
        source: "yahoo_unofficial",
      });
      assert.equal(feed.getExt("AAPL", now, 313.39).extSource, "yahoo_unofficial");
    } finally { feed.stop(); }
  });
});

describe("EXT_FEED_DISABLE=1 also disables the webull leg", () => {
  before(() => { process.env.EXT_FEED_DISABLE = "1"; });
  after(() => { delete process.env.EXT_FEED_DISABLE; });

  it("constructs no webull leg and serves nothing", () => {
    const feed = new ExtFeed({});
    try {
      assert.equal(feed.webull, null);
      assert.equal(feed.getExt("AAPL", MON_PRE_0545, 313.39), null);
      assert.deepEqual(feed.health(), { disabled: true });
    } finally { feed.stop(); }
  });
});
