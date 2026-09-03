"use strict";
// Unit tests for lib/quotes.js — the GET /quotes response CONTRACT and symbol routing.
// Run with: node --test "tests/*.test.js"   (Node ≥ 18 built-in test runner)
// Or via:   npm test  (from hub/ directory)
//
// This is the guard on the macro merge: adding a second quote source must NOT change
// the response shape the terminal already parses — a flat { SYM: {...quote} } object
// carrying present entries only.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  classify,
  isMacroSymbol,
  isDailyOnlySymbol,
  DAILY_ONLY,
  parseQuoteView,
  applyDemand,
  buildQuotesResponse,
} = require("../lib/quotes");
const { Store } = require("../lib/store");
const { MacroFeed } = require("../lib/macrofeed");

const NOW = Date.UTC(2026, 6, 27, 14, 0, 0);
const TS = Math.floor(NOW / 1000);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeStore() {
  const store = new Store("/dev/null/manifest.json"); // no anchor cache, never read
  store.quotes.set("SOFI", {
    sym: "SOFI", last: 16.46, chg: -1.14, prevClose: 16.65,
    ts: TS, live: false, source: "polygon-delayed", market: "us", basis: "DELAYED_15M",
  });
  store.quotes.set("BTC-USD", {
    sym: "BTC-USD", last: 60000, chg: 1.23, prevClose: 59270,
    ts: TS, live: true, source: "coinbase", market: "crypto", basis: "LIVE",
  });
  return store;
}

function makeMacroFeed() {
  const feed = new MacroFeed();
  feed._sinaCache.set("CL=F", {
    sym: "CL=F", last: 82.543, chg: -7.577, prevClose: 89.31,
    open: 86.12, high: 86.2, low: 82.46, vol: null, amount: null,
    ts: TS, live: true, source: "sina", market: "macro", basis: "LIVE",
  });
  feed._yahooCache.set("^GSPC", {
    sym: "^GSPC", last: 7501.25, chg: 0.72, prevClose: 7447.5,
    open: null, high: null, low: null, vol: null, amount: null,
    ts: TS, live: false, source: "yahoo-spark", market: "macro", basis: "DELAYED_15M",
  });
  return feed;
}

// ── classify ─────────────────────────────────────────────────────────────────

describe("classify — taxonomy is unchanged by the macro work", () => {
  it("keeps the existing market buckets", () => {
    assert.equal(classify("600519.SS"), "cn");
    assert.equal(classify("000001.SZ"), "cn");
    assert.equal(classify("0700.HK"), "hk");
    assert.equal(classify("SHOP.TO"), "ca");
    assert.equal(classify("BTC-USD"), "crypto");
    assert.equal(classify("AAPL"), "us");
  });

  it("still falls macro symbols through to 'us' — routing MUST check isMacroSymbol first", () => {
    // Documents why buildQuotesResponse tests isMacroSymbol before classify: a bare
    // classify() would hand CL=F and ^GSPC to Polygon and the AnchorCache.
    assert.equal(classify("CL=F"), "us");
    assert.equal(classify("^GSPC"), "us");
    assert.equal(classify("DX-Y.NYB"), "us");
  });
});

// ── Response contract ────────────────────────────────────────────────────────

describe("buildQuotesResponse — response contract", () => {
  it("returns a FLAT { SYM: quote } object for a mixed macro/us/crypto request", () => {
    const out = buildQuotesResponse(
      ["CL=F", "SOFI", "BTC-USD"], NOW,
      { store: makeStore(), macroFeed: makeMacroFeed() }
    );

    assert.equal(Object.prototype.toString.call(out), "[object Object]", "must be a plain object");
    assert.ok(!Array.isArray(out));
    assert.deepEqual(Object.keys(out).sort(), ["BTC-USD", "CL=F", "SOFI"]);

    // Every value is the quote itself, keyed by symbol — no wrapper, no envelope.
    for (const [sym, q] of Object.entries(out)) {
      assert.equal(typeof q, "object");
      assert.equal(q.sym, sym, "each value carries its own sym");
      assert.ok(typeof q.last === "number", `${sym} must carry a numeric last`);
      assert.ok(typeof q.ts === "number", `${sym} must carry a numeric ts`);
      assert.ok(typeof q.source === "string" && q.source, `${sym} must name its source`);
      assert.ok(typeof q.basis === "string" && q.basis, `${sym} must name its basis`);
    }
  });

  it("survives a JSON round-trip unchanged (this is what the HTTP layer sends)", () => {
    const out = buildQuotesResponse(
      ["CL=F", "SOFI", "BTC-USD"], NOW,
      { store: makeStore(), macroFeed: makeMacroFeed() }
    );
    assert.deepEqual(JSON.parse(JSON.stringify(out)), JSON.parse(JSON.stringify(out)));
    const parsed = JSON.parse(JSON.stringify(out));
    assert.equal(parsed["CL=F"].last, 82.543);
    assert.equal(parsed["SOFI"].last, 16.46);
    assert.equal(parsed["BTC-USD"].last, 60000);
  });

  it("carries the macro quote through with its own source/basis labels", () => {
    const out = buildQuotesResponse(["CL=F", "^GSPC"], NOW,
      { store: makeStore(), macroFeed: makeMacroFeed() });
    assert.equal(out["CL=F"].source, "sina");
    assert.equal(out["CL=F"].basis, "LIVE");
    assert.equal(out["CL=F"].live, true);
    assert.equal(out["^GSPC"].source, "yahoo-spark");
    assert.equal(out["^GSPC"].basis, "DELAYED_15M", "a delayed leg is never relabelled LIVE");
    assert.equal(out["^GSPC"].live, false);
  });

  it("omits symbols nothing has a quote for (present entries only)", () => {
    const out = buildQuotesResponse(
      ["CL=F", "SOFI", "NVDA", "GC=F"], NOW,
      { store: makeStore(), macroFeed: makeMacroFeed() }
    );
    assert.deepEqual(Object.keys(out).sort(), ["CL=F", "SOFI"]);
    assert.ok(!("NVDA" in out), "an unseeded US symbol is absent, not null");
    assert.ok(!("GC=F" in out), "an unseeded macro symbol is absent, not null");
  });

  it("never serves cn / hk / ca symbols", () => {
    const out = buildQuotesResponse(
      ["600519.SS", "0700.HK", "SHOP.TO", "SOFI"], NOW,
      { store: makeStore(), macroFeed: makeMacroFeed() }
    );
    assert.deepEqual(Object.keys(out), ["SOFI"]);
  });

  it("returns {} for an empty or missing symbol list", () => {
    const deps = { store: makeStore(), macroFeed: makeMacroFeed() };
    assert.deepEqual(buildQuotesResponse([], NOW, deps), {});
    assert.deepEqual(buildQuotesResponse(null, NOW, deps), {});
    assert.deepEqual(buildQuotesResponse(undefined, NOW, deps), {});
  });
});

// ── Routing isolation ────────────────────────────────────────────────────────

describe("buildQuotesResponse — routing isolation", () => {
  it("macro symbols are NEVER passed to the Store", () => {
    let seen = null;
    const storeSpy = {
      getQuotes(syms) { seen = [...syms]; return {}; },
    };
    buildQuotesResponse(
      ["CL=F", "^GSPC", "DX-Y.NYB", "EURUSD=X", "SOFI", "BTC-USD"], NOW,
      { store: storeSpy, macroFeed: makeMacroFeed() }
    );
    assert.deepEqual(seen, ["SOFI", "BTC-USD"],
      "the Store must only ever see us/crypto symbols — macro has no manifest or anchor");
  });

  it("non-macro symbols are NEVER passed to the MacroFeed", () => {
    let seen = null;
    const macroSpy = {
      getAll(syms) { seen = [...syms]; return {}; },
    };
    buildQuotesResponse(
      ["CL=F", "SOFI", "BTC-USD", "^GSPC"], NOW,
      { store: makeStore(), macroFeed: macroSpy }
    );
    assert.deepEqual(seen, ["CL=F", "^GSPC"]);
  });

  it("forwards nowMs and the extFeed to store.getQuotes unchanged", () => {
    let args = null;
    const extFeedSentinel = { getExt: () => null };
    const storeSpy = {
      getQuotes(syms, nowMs, extFeed) { args = { syms, nowMs, extFeed }; return {}; },
    };
    buildQuotesResponse(["SOFI"], NOW, {
      store: storeSpy, macroFeed: makeMacroFeed(), extFeed: extFeedSentinel,
    });
    assert.equal(args.nowMs, NOW);
    assert.equal(args.extFeed, extFeedSentinel, "the ext merge must still reach the Store");
  });

  it("skips the Store call entirely when only macro symbols are requested", () => {
    let called = false;
    const storeSpy = { getQuotes() { called = true; return {}; } };
    const out = buildQuotesResponse(["CL=F"], NOW,
      { store: storeSpy, macroFeed: makeMacroFeed() });
    assert.equal(called, false);
    assert.equal(out["CL=F"].last, 82.543);
  });

  it("degrades cleanly when the macroFeed is absent (kill-switch / boot order)", () => {
    const out = buildQuotesResponse(["CL=F", "SOFI"], NOW, { store: makeStore() });
    assert.deepEqual(Object.keys(out), ["SOFI"], "macro symbols drop out, us/crypto unaffected");
  });

  it("degrades cleanly when the store is absent", () => {
    const out = buildQuotesResponse(["CL=F", "SOFI"], NOW, { macroFeed: makeMacroFeed() });
    assert.deepEqual(Object.keys(out), ["CL=F"]);
  });

  it("a disabled macroFeed simply yields no macro entries", () => {
    process.env.MACRO_FEED_DISABLE = "1";
    try {
      const feed = new MacroFeed();
      const out = buildQuotesResponse(["CL=F", "SOFI"], NOW,
        { store: makeStore(), macroFeed: feed });
      assert.deepEqual(Object.keys(out), ["SOFI"]);
      feed.stop();
    } finally {
      delete process.env.MACRO_FEED_DISABLE;
    }
  });
});

// ── Daily-only FRED series ───────────────────────────────────────────────────
//
// DFII10 / DFII5 / T10YIE / T5YIE are bare FRED series ids. They match neither
// isMacroSymbol nor any classify() branch, so they fell through to "us" and were treated
// as US equities: a Polygon AM.* subscription on a ticker Polygon does not carry, one of
// the 30 SHARED ext slots, and a manifest placeholder served as polygon-delayed /
// DELAYED_15M / ts:now — a 15-minute-freshness claim on a once-a-day print, which the
// chart then spliced in as a synthetic flat bar dated today.

describe("isDailyOnlySymbol", () => {
  it("claims exactly the four FRED series", () => {
    assert.deepEqual([...DAILY_ONLY].sort(), ["DFII10", "DFII5", "T10YIE", "T5YIE"]);
    for (const s of DAILY_ONLY) assert.equal(isDailyOnlySymbol(s), true, s);
  });

  it("claims nothing else — equities, crypto and macro are unaffected", () => {
    for (const s of ["AAPL", "SOFI", "BTC-USD", "CL=F", "^TNX", "EURUSD=X", "DX-Y.NYB", "600519.SS"]) {
      assert.equal(isDailyOnlySymbol(s), false, `${s} must keep its live leg`);
    }
  });

  it("rejects empty / non-string input", () => {
    for (const bad of ["", null, undefined, 42, {}]) assert.equal(isDailyOnlySymbol(bad), false);
  });

  it("classify() still falls them through to 'us' — the routers MUST check this first", () => {
    // Documents why applyDemand and buildQuotesResponse test isDailyOnlySymbol before
    // anything else: a bare classify() hands DFII10 to Polygon and the Store.
    assert.equal(classify("DFII10"), "us");
    assert.equal(isMacroSymbol("DFII10"), false, "…and no shape rule claims it either");
  });
});

describe("applyDemand — a daily-only symbol reaches NO feed", () => {
  function spies() {
    const seen = { polygon: [], anchor: [], ext: [], macro: [] };
    return {
      seen,
      deps: {
        polygon: {
          isHealthy: () => true,
          ensureSubscribed: (s) => seen.polygon.push(s),
        },
        anchorCache: { resolve: async (s) => { seen.anchor.push(s); } },
        extFeed: { demand: (s) => seen.ext.push(s) },
        macroFeed: { demand: (s) => seen.macro.push(s) },
      },
    };
  }

  it("burns no Polygon slot, no ext slot, and no macro subscription for DFII10", () => {
    const { seen, deps } = spies();
    applyDemand(["DFII10", "DFII5", "T10YIE", "T5YIE"], NOW, deps);
    assert.deepEqual(seen.polygon, [], "a Polygon LRU slot is 1 of 500, shared by every user");
    assert.deepEqual(seen.anchor, [], "there is no daily file to anchor a FRED series against");
    assert.deepEqual(seen.ext, [], "an ext slot is 1 of 30, shared — a daily print has no ext session");
    assert.deepEqual(seen.macro, [], "the macro feed has no Sina code and no spark ticker for it");
  });

  it("still demands every leg for an ordinary US symbol", () => {
    const { seen, deps } = spies();
    applyDemand(["SOFI"], NOW, deps);
    assert.deepEqual(seen.polygon, ["SOFI"]);
    assert.deepEqual(seen.anchor, ["SOFI"]);
    assert.deepEqual(seen.ext, ["SOFI"]);
    assert.deepEqual(seen.macro, []);
  });

  it("still routes a macro symbol to the MacroFeed alone", () => {
    const { seen, deps } = spies();
    applyDemand(["CL=F", "^GSPC"], NOW, deps);
    assert.deepEqual(seen.macro, ["CL=F", "^GSPC"]);
    assert.deepEqual(seen.polygon, [], "macro must never reach Polygon");
    assert.deepEqual(seen.ext, []);
  });

  it("sorts a mixed request without cross-contamination", () => {
    const { seen, deps } = spies();
    applyDemand(["DFII10", "SOFI", "CL=F", "BTC-USD", "600519.SS"], NOW, deps);
    assert.deepEqual(seen.polygon, ["SOFI"], "crypto/cn have no Polygon sub either");
    assert.deepEqual(seen.macro, ["CL=F"]);
    assert.deepEqual(seen.ext, ["SOFI"]);
  });

  it("honours HUB_DISABLE_US and an unhealthy Polygon", () => {
    const a = spies();
    applyDemand(["SOFI"], NOW, { ...a.deps, disableUS: true });
    assert.deepEqual(a.seen.polygon, []);
    const b = spies();
    b.deps.polygon.isHealthy = () => false;
    applyDemand(["SOFI"], NOW, b.deps);
    assert.deepEqual(b.seen.polygon, []);
  });

  it("does not throw when a feed is missing entirely (boot order / kill-switch)", () => {
    applyDemand(["DFII10", "SOFI", "CL=F"], NOW, {});
    applyDemand(null, NOW, {});
  });
});

describe("buildQuotesResponse — a daily-only symbol is absent, never placeholdered", () => {
  it("omits DFII10 even when the Store holds a placeholder row for it", () => {
    // This is the actual production shape: polygon._writePlaceholder had already written a
    // manifest-derived row stamped source polygon-delayed / basis DELAYED_15M / ts:now.
    // Routing must drop it BEFORE the Store is ever asked.
    const store = makeStore();
    store.quotes.set("DFII10", {
      sym: "DFII10", last: 1.85, chg: 0, prevClose: 1.85,
      ts: TS, live: false, source: "polygon-delayed", market: "us", basis: "DELAYED_15M",
    });
    const out = buildQuotesResponse(["DFII10", "SOFI"], NOW, { store, macroFeed: makeMacroFeed() });
    assert.deepEqual(Object.keys(out), ["SOFI"]);
    assert.ok(!("DFII10" in out),
      "a once-a-day FRED print must never be served with a 15-minute freshness claim");
  });

  it("never passes a daily-only symbol to the Store at all", () => {
    let seen = null;
    const storeSpy = { getQuotes(syms) { seen = [...syms]; return {}; } };
    buildQuotesResponse(["DFII10", "T5YIE", "SOFI"], NOW,
      { store: storeSpy, macroFeed: makeMacroFeed() });
    assert.deepEqual(seen, ["SOFI"]);
  });

  it("never passes a daily-only symbol to the MacroFeed either", () => {
    let seen = null;
    const macroSpy = { getAll(syms) { seen = [...syms]; return {}; } };
    buildQuotesResponse(["DFII10", "CL=F"], NOW, { store: makeStore(), macroFeed: macroSpy });
    assert.deepEqual(seen, ["CL=F"]);
  });

  it("skips the Store entirely when the request is daily-only", () => {
    let called = false;
    const storeSpy = { getQuotes() { called = true; return {}; } };
    const out = buildQuotesResponse(["DFII10"], NOW, { store: storeSpy, macroFeed: makeMacroFeed() });
    assert.equal(called, false);
    assert.deepEqual(out, {});
  });
});

// ── isMacroSymbol re-export ──────────────────────────────────────────────────

describe("lib/quotes re-exports isMacroSymbol", () => {
  it("is the same predicate the macro feed uses", () => {
    assert.equal(isMacroSymbol("CL=F"), true);
    assert.equal(isMacroSymbol("SOFI"), false);
    assert.equal(isMacroSymbol, require("../lib/macrofeed").isMacroSymbol,
      "one predicate, one source of truth — hub.js and macrofeed must not drift");
  });
});

// ── R1A-T: closed view=regular quote read (zero ExtFeed demand) ────────────
//
// Reactive Projection R1A-T (spec §5, plan Task T1/T2). `view=regular` closes the
// endpoint at TWO boundaries: zero ExtFeed.demand() calls on the demand pass, and
// no ext* key survives in any emitted row on the response pass — even when the
// Store hands back a legacy row that already carries ext* keys from an earlier
// full-view request. Missing view stays exactly `full`; the vocabulary is CLOSED,
// so anything else (unknown/blank/repeated/conflicting) is null and the caller
// (hub.js) must answer 400.

function demandSpies() {
  const seen = { snapshot: [], polygon: [], anchor: [], ext: [], macro: [] };
  return {
    seen,
    deps: {
      snapshotFeed: { demand: (s) => seen.snapshot.push(s) },
      polygon: {
        isHealthy: () => true,
        ensureSubscribed: (s) => seen.polygon.push(s),
      },
      anchorCache: { resolve: async (s) => { seen.anchor.push(s); } },
      extFeed: { demand: (s) => seen.ext.push(s) },
      macroFeed: { demand: (s) => seen.macro.push(s) },
    },
  };
}

describe("parseQuoteView — closed endpoint vocabulary", () => {
  it("defaults only an absent value to full", () => {
    assert.equal(parseQuoteView([]), "full");
  });

  it("accepts exactly one full or regular value", () => {
    assert.equal(parseQuoteView(["full"]), "full");
    assert.equal(parseQuoteView(["regular"]), "regular");
  });

  it("rejects unknown, blank and repeated values", () => {
    for (const raw of [[""], ["all"], ["regular", "regular"], ["full", "regular"], null]) {
      assert.equal(parseQuoteView(raw), null);
    }
  });
});

describe("applyDemand — view=regular spends zero ext slots", () => {
  it("regular view preserves regular demand and spends zero ext slots", () => {
    const { seen, deps } = demandSpies();
    applyDemand(["AAPL", "NVDA"], NOW, deps, { includeExtended: false });
    assert.deepEqual(seen.snapshot, ["AAPL", "NVDA"]);
    assert.deepEqual(seen.polygon, ["AAPL", "NVDA"]);
    assert.deepEqual(seen.anchor, ["AAPL", "NVDA"]);
    assert.deepEqual(seen.ext, []);
  });

  it("default/full view keeps existing ext demand", () => {
    for (const options of [undefined, { includeExtended: true }]) {
      const { seen, deps } = demandSpies();
      applyDemand(["AAPL"], NOW, deps, options);
      assert.deepEqual(seen.snapshot, ["AAPL"]);
      assert.deepEqual(seen.polygon, ["AAPL"]);
      assert.deepEqual(seen.anchor, ["AAPL"]);
      assert.deepEqual(seen.ext, ["AAPL"]);
    }
  });
});

describe("buildQuotesResponse — view=regular is closed at the response boundary", () => {
  it("regular response passes no ext feed into Store and strips legacy ext keys", () => {
    let seenExt = "unset";
    const store = {
      getQuotes(_syms, _now, extFeed) {
        seenExt = extFeed;
        return {
          AAPL: {
            sym: "AAPL",
            last: 200,
            prevClose: 198,
            chg: 1.0101,
            ts: TS,
            live: true,
            source: "polygon-live",
            basis: "LIVE",
            // legacy/poisoned row: the regular view must strip these at the
            // response boundary even though no ExtFeed was consulted
            extPrice: 201,
            extChg: 1.5,
            extTs: TS,
            extSession: "post",
            extSource: "webull",
            extBasis: "EXT",
          },
        };
      },
    };
    const out = buildQuotesResponse(
      ["AAPL"], NOW, { store, extFeed: { getExt() { throw new Error("must not run"); } } },
      { includeExtended: false }
    );
    assert.equal(seenExt, null);
    for (const key of ["extPrice", "extChg", "extTs", "extSession", "extSource", "extBasis"]) {
      assert.equal(key in out.AAPL, false);
    }
  });

  it("default full view remains unchanged", () => {
    const store = {
      getQuotes(_syms, _now, extFeed) {
        assert.notEqual(extFeed, null, "full view must still forward extFeed to the Store");
        return {
          AAPL: {
            sym: "AAPL", last: 200, prevClose: 198, chg: 1.0101, ts: TS,
            live: true, source: "polygon-live", basis: "LIVE",
            extPrice: 201, extChg: 1.5, extTs: TS, extSession: "post", extSource: "webull",
          },
        };
      },
    };
    const extFeedSentinel = { getExt: () => null };
    for (const options of [undefined, { includeExtended: true }]) {
      const out = buildQuotesResponse(["AAPL"], NOW, { store, extFeed: extFeedSentinel }, options);
      assert.equal(out.AAPL.extPrice, 201, "full view must not strip ext fields");
      assert.equal(out.AAPL.extSource, "webull");
    }
  });
});
