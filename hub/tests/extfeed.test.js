"use strict";
// Unit tests for lib/extfeed.js — session classification, LRU, keyless fallback shape, merge.
// Run with: node --test tests/extfeed.test.js   (Node ≥ 18 built-in test runner)
// Or via:   npm test  (from hub/ directory)

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const https = require("https");

const { classifySession, yahooFetchExtPrice, ExtFeed, ALPACA_LRU_CAP } = require("../lib/extfeed");
const { Store } = require("../lib/store");

// ── Helpers ──────────────────────────────────────────────────────────────────

// Convert "HH:MM" ET string to a Unix ms timestamp on a fixed weekday.
// Uses 2026-07-09 (Thursday) as the fixed date to avoid weekend edge cases.
// ET = UTC-4 (EDT). Fixed date: 2026-07-09 = July 9 → July offset: month 6 (0-indexed).
function etMs(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  // 2026-07-09 UTC midnight = Date.UTC(2026, 6, 9, 0, 0)
  // UTC-4 → ET offset adds 4 hours: ET hh:mm = UTC hh+4:mm
  const utcMs = Date.UTC(2026, 6, 9, h + 4, m);
  return utcMs;
}

// ── classifySession ──────────────────────────────────────────────────────────

describe("classifySession", () => {
  it("04:00 ET → pre", () => assert.equal(classifySession(etMs("04:00")), "pre"));
  it("06:00 ET → pre", () => assert.equal(classifySession(etMs("06:00")), "pre"));
  it("09:29 ET → pre", () => assert.equal(classifySession(etMs("09:29")), "pre"));
  it("09:30 ET → rth", () => assert.equal(classifySession(etMs("09:30")), "rth"));
  it("12:00 ET → rth", () => assert.equal(classifySession(etMs("12:00")), "rth"));
  it("15:59 ET → rth", () => assert.equal(classifySession(etMs("15:59")), "rth"));
  it("16:00 ET → post", () => assert.equal(classifySession(etMs("16:00")), "post"));
  it("18:00 ET → post", () => assert.equal(classifySession(etMs("18:00")), "post"));
  it("19:59 ET → post", () => assert.equal(classifySession(etMs("19:59")), "post"));
  it("20:00 ET → overnight", () => assert.equal(classifySession(etMs("20:00")), "overnight"));
  it("23:00 ET → overnight", () => assert.equal(classifySession(etMs("23:00")), "overnight"));
  // 03:00 ET = 07:00 UTC on same date
  it("03:00 ET → overnight", () => {
    const ts = Date.UTC(2026, 6, 9, 7, 0); // 07:00 UTC = 03:00 ET
    assert.equal(classifySession(ts), "overnight");
  });
  // boundary: 04:00 ET is inclusive start of pre
  it("03:59 ET → overnight", () => {
    const ts = Date.UTC(2026, 6, 9, 7, 59); // 07:59 UTC = 03:59 ET
    assert.equal(classifySession(ts), "overnight");
  });
});

// ── LRU sub/unsub via ExtFeed.demand ─────────────────────────────────────────

describe("ExtFeed LRU subscription management", () => {
  let feed;

  before(() => {
    // Use yahoo fallback (no keys) so we can test without a real WS.
    process.env.EXT_FEED_DISABLE = "";
    feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    // Don't call feed.start() — we're testing demand/LRU logic only.
  });

  after(() => {
    feed.stop();
  });

  it("starts with empty yahoo subs map", () => {
    assert.equal(feed._yahooSubs.size, 0);
  });

  it("demand adds a symbol to yahoo subs", () => {
    feed.demand("AAPL");
    assert.ok(feed._yahooSubs.has("AAPL"), "AAPL should be in yahooSubs after demand");
  });

  it("demand for same symbol is idempotent (no growth)", () => {
    feed.demand("AAPL");
    feed.demand("AAPL");
    assert.equal(feed._yahooSubs.size, 1, "repeated demand must not grow the map");
  });

  it(`evicts LRU symbol when cap (${ALPACA_LRU_CAP}) is exceeded`, () => {
    // Fill to cap. AAPL was demanded first — it will be LRU if we demand 29 others.
    for (let i = 1; i < ALPACA_LRU_CAP; i++) {
      feed.demand(`SYM${i}`);
    }
    assert.equal(feed._yahooSubs.size, ALPACA_LRU_CAP, `should be at cap=${ALPACA_LRU_CAP}`);
    // AAPL was the first inserted (LRU). Demanding one more should evict AAPL.
    feed.demand("NEWCOMER");
    assert.equal(feed._yahooSubs.size, ALPACA_LRU_CAP, "size must stay at cap after eviction");
    assert.ok(!feed._yahooSubs.has("AAPL"), "AAPL (LRU) must have been evicted");
    assert.ok(feed._yahooSubs.has("NEWCOMER"), "NEWCOMER must be in subs");
  });

  it("re-demanding an existing symbol promotes it to MRU (not evicted next)", () => {
    const feed2 = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      // Add SYM_A first (will be LRU), then fill to cap.
      feed2.demand("SYM_A");
      for (let i = 0; i < ALPACA_LRU_CAP - 1; i++) feed2.demand(`X${i}`);
      assert.equal(feed2._yahooSubs.size, ALPACA_LRU_CAP);

      // Re-demand SYM_A to promote it to MRU.
      feed2.demand("SYM_A");
      // Now the LRU is X0. Demand one more — X0 should be evicted, not SYM_A.
      feed2.demand("NEW");
      assert.ok(feed2._yahooSubs.has("SYM_A"), "SYM_A was re-demanded (MRU) — must survive eviction");
      assert.ok(!feed2._yahooSubs.has("X0"), "X0 was not re-demanded (became LRU) — should be evicted");
    } finally {
      feed2.stop();
    }
  });

  it("eviction stops refresh but keeps a still-valid last-good Yahoo print servable", () => {
    const feed2 = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      const nowMs = etMs("07:00");
      feed2.demand("QCOM");
      feed2._yahooCache.set("QCOM", {
        price: 188.23,
        ts: Math.floor((nowMs - 60_000) / 1000),
        session: "pre",
        source: "yahoo-relay",
      });
      for (let i = 1; i < ALPACA_LRU_CAP; i++) feed2.demand(`X${i}`);
      feed2.demand("NEWCOMER");

      assert.ok(!feed2._yahooSubs.has("QCOM"), "the 30-slot subscription cap still applies");
      assert.ok(feed2._yahooCache.has("QCOM"),
        "subscription eviction must not masquerade as an authoritative quote deletion");
      const ext = feed2.getExt("QCOM", nowMs, 188.71);
      assert.ok(ext, "the bounded last-good cache stays servable until session/age gates expire it");
      assert.equal(ext.extPrice, 188.23);
    } finally {
      feed2.stop();
    }
  });

  it("re-touching an existing entry updates lastReq (idle-sweep regression)", () => {
    // Regression: before the fix, lruTouch re-inserted the same value object without
    // updating lastReq, so _sweepIdle would unsubscribe actively-demanded symbols after
    // 30 minutes (measured from their FIRST subscribe, not their most recent demand).
    const feed3 = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    try {
      const before = Date.now() - 1; // ensure the reference is strictly before
      feed3.demand("AAPL");
      const firstLastReq = feed3._yahooSubs.get("AAPL").lastReq;

      // Simulate 50ms passing then re-demand.
      // We cannot sleep in a sync test, so we patch Date.now temporarily.
      const origNow = Date.now;
      const fakeNow = origNow() + 50;
      Date.now = () => fakeNow;
      try {
        feed3.demand("AAPL"); // re-touch
      } finally {
        Date.now = origNow;
      }

      const afterLastReq = feed3._yahooSubs.get("AAPL").lastReq;
      assert.ok(afterLastReq >= fakeNow,
        `lastReq must be updated on re-touch; before=${firstLastReq}, after=${afterLastReq}, fakeNow=${fakeNow}`);
      assert.ok(afterLastReq > firstLastReq,
        "lastReq must increase on each re-demand (idle-sweep uses this to decide unsub)");
    } finally {
      feed3.stop();
    }
  });
});

// ── Keyless Yahoo fallback shape ──────────────────────────────────────────────
// We use a stub of yahooFetchExtPrice to verify the shape contract without
// making live HTTP calls — but we also have a live integration probe below.

describe("yahooFetchExtPrice shape contract (stub)", () => {
  // The function must return null or an object with { price, ts, session }.

  it("returns null during RTH (classifySession=rth)", async () => {
    // RTH: 10:00 ET on 2026-07-09 = 14:00 UTC
    const rthMs = Date.UTC(2026, 6, 9, 14, 0);
    // yahooFetchExtPrice returns null immediately in RTH without making a network call.
    const result = await yahooFetchExtPrice("__NO_NETWORK__", rthMs);
    assert.equal(result, null, "must return null during RTH (no ext print in RTH)");
  });

  it("returns null during overnight (classifySession=overnight)", async () => {
    // 00:00 ET on 2026-07-09 = 04:00 UTC — deep overnight
    const overnightMs = Date.UTC(2026, 6, 9, 4, 0);
    const result = await yahooFetchExtPrice("__NO_NETWORK__", overnightMs);
    assert.equal(result, null, "must return null during overnight (Yahoo has no overnight bars)");
  });
});

// ── ExtFeed.getExt field shape and RTH suppression ───────────────────────────

describe("ExtFeed.getExt — field shape and session gating", () => {
  let feed;

  before(() => {
    feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    // Inject a synthetic pre-market ext print into the yahoo cache.
    const preMktMs = etMs("07:00"); // 07:00 ET = pre-market
    feed._yahooCache.set("AAPL", {
      price: 314.50,
      ts: Math.floor(preMktMs / 1000),
      session: "pre",
      source: "yahoo_unofficial",
    });
  });

  after(() => { feed.stop(); });

  it("returns null during RTH even if a cached ext entry exists", () => {
    const rthMs = etMs("11:00");
    const ext = feed.getExt("AAPL", rthMs, 316.22);
    assert.equal(ext, null, "getExt must return null during RTH");
  });

  it("returns ext fields during pre-market with officialClose=null (closeRef=null) → extChg=null", () => {
    // getExt itself gets null when BOTH officialClose and prevClose are unavailable.
    // In normal operation store.getQuotes passes prevClose as the reference; this test
    // covers the case where the caller explicitly passes null (both refs absent).
    const preMktMs = etMs("07:00");
    const ext = feed.getExt("AAPL", preMktMs, null);
    assert.ok(ext != null, "ext must be non-null in pre-market");
    assert.equal(ext.extPrice, 314.50, "extPrice must equal the injected price");
    assert.equal(ext.extChg, null, "extChg must be null when no close reference is available");
    assert.ok(typeof ext.extTs === "number", "extTs must be a number");
    assert.equal(ext.extSession, "pre", "extSession must be 'pre'");
    assert.equal(ext.extSource, "yahoo_unofficial", "extSource must be 'yahoo_unofficial'");
  });

  it("computes extChg when officialClose is absent but prevClose is passed (pre-market normal path)", () => {
    // Regression: before the fix, store.getQuotes passed officialClose (null pre-market)
    // so extChg was always null in pre-market even though prevClose was available.
    // store.getQuotes now passes prevClose as the reference when officialClose is absent.
    const preMktMs = etMs("07:00");
    const prevClose = 313.39; // prior session close, used as reference pre-market
    const ext = feed.getExt("AAPL", preMktMs, prevClose);
    assert.ok(ext != null, "ext must be non-null in pre-market");
    const expectedChg = (314.50 - prevClose) / prevClose * 100;
    assert.ok(ext.extChg !== null, "extChg must NOT be null when prevClose is passed as reference");
    assert.ok(Math.abs(ext.extChg - expectedChg) < 0.001,
      `extChg=${ext.extChg?.toFixed(4)} expected≈${expectedChg.toFixed(4)} (+0.354%)`);
  });

  it("computes extChg correctly when officialClose is provided", () => {
    const preMktMs = etMs("07:00");
    const officialClose = 316.22; // yesterday's official close used as reference
    const ext = feed.getExt("AAPL", preMktMs, officialClose);
    assert.ok(ext != null);
    const expectedChg = (314.50 - officialClose) / officialClose * 100;
    assert.ok(Math.abs(ext.extChg - expectedChg) < 0.001,
      `extChg=${ext.extChg?.toFixed(4)} expected≈${expectedChg.toFixed(4)}`);
  });

  it("returns null for unknown symbol even in ext window", () => {
    const preMktMs = etMs("07:00");
    const ext = feed.getExt("ZZZ_UNKNOWN", preMktMs, null);
    assert.equal(ext, null);
  });

  it("returns null when ext print is older than 90 minutes", () => {
    const preMktMs = etMs("07:00");
    // Inject an old print (91 min old).
    feed._yahooCache.set("MSFT", {
      price: 400.00,
      ts: Math.floor((preMktMs - 91 * 60 * 1000) / 1000),
      session: "pre",
      source: "yahoo_unofficial",
    });
    const ext = feed.getExt("MSFT", preMktMs, null);
    assert.equal(ext, null, "stale ext print (>90 min) must be rejected");
  });
});

// ── ExtFeed disabled ──────────────────────────────────────────────────────────

describe("ExtFeed disabled (EXT_FEED_DISABLE=1)", () => {
  before(() => { process.env.EXT_FEED_DISABLE = "1"; });
  after(() => { delete process.env.EXT_FEED_DISABLE; });

  it("getExt returns null when feed is disabled", () => {
    const disabledFeed = new ExtFeed({});
    const preMktMs = etMs("07:00");
    const ext = disabledFeed.getExt("AAPL", preMktMs, null);
    assert.equal(ext, null);
    disabledFeed.stop();
  });
});

// ── Alpaca authFailed → Yahoo fallback ───────────────────────────────────────

describe("ExtFeed Alpaca authFailed degrades to Yahoo fallback", () => {
  it("serves Yahoo cache when alpaca.authFailed=true", () => {
    // Simulate: Alpaca keys present but auth fails (402/403 — plan not entitled).
    // Regression: before the fix, _yahooCache was null in alpaca mode so getExt
    // returned null silently with no fallback.
    const feed = new ExtFeed({ alpacaKey: "fake-key", alpacaSecret: "fake-secret" });
    try {
      // Verify the fallback structures exist in alpaca mode.
      assert.ok(feed._yahooSubs instanceof Map, "_yahooSubs must be initialised in alpaca mode");
      assert.ok(feed._yahooCache instanceof Map, "_yahooCache must be initialised in alpaca mode");

      // Inject a Yahoo cache entry directly (as the poller would on a real run).
      const preMktMs = etMs("07:00");
      feed._yahooCache.set("AAPL", {
        price: 314.50,
        ts: Math.floor(preMktMs / 1000),
        session: "pre",
        source: "yahoo_unofficial",
      });

      // Simulate authFailed.
      feed.alpaca.authFailed = true;

      const ext = feed.getExt("AAPL", preMktMs, 313.39);
      assert.ok(ext != null, "getExt must return Yahoo data when Alpaca authFailed");
      assert.equal(ext.extPrice, 314.50, "extPrice from Yahoo fallback must be correct");
      assert.ok(ext.extChg !== null, "extChg must be computed from prevClose reference");
      assert.equal(ext.extSource, "yahoo_unofficial", "extSource must identify Yahoo fallback");
    } finally {
      // Stop without starting — alpaca.ws is null so stop() is a no-op.
      feed.stop();
    }
  });

  it("serves Alpaca _extMap when authFailed=false (primary path)", () => {
    const feed = new ExtFeed({ alpacaKey: "fake-key", alpacaSecret: "fake-secret" });
    try {
      const preMktMs = etMs("07:00");
      feed._extMap.set("AAPL", {
        price: 315.00,
        ts: Math.floor(preMktMs / 1000),
        session: "pre",
        source: "alpaca_overnight",
      });
      feed.alpaca.authFailed = false;

      const ext = feed.getExt("AAPL", preMktMs, 313.39);
      assert.ok(ext != null, "getExt must return Alpaca data when auth succeeded");
      assert.equal(ext.extPrice, 315.00, "must serve from Alpaca _extMap, not Yahoo cache");
      assert.equal(ext.extSource, "alpaca_overnight");
    } finally {
      feed.stop();
    }
  });
});

// ── Store.getQuotes ext field merge ──────────────────────────────────────────

describe("Store.getQuotes ext field merge", () => {
  function makeStore() {
    return new Store("/dev/null/manifest.json");
  }

  function makeExtFeedStub(extEntry) {
    // Minimal stub matching the extFeed interface used by store.getQuotes.
    return {
      getExt(sym, nowMs, officialClose) {
        return extEntry;
      },
    };
  }

  const preMktMs = etMs("07:00");

  it("merges ext fields when extFeed returns a result", () => {
    const store = makeStore();
    store.quotes.set("AAPL", {
      sym: "AAPL", last: 316.22, market: "us", chg: 0.90,
      prevClose: 313.39, ts: Math.floor(preMktMs / 1000),
      live: false, source: "polygon-delayed",
    });

    const stubExt = {
      extPrice: 314.50,
      extChg: -0.54,
      extTs: Math.floor(preMktMs / 1000),
      extSession: "pre",
      extSource: "yahoo_unofficial",
    };
    const extFeedStub = makeExtFeedStub(stubExt);

    const result = store.getQuotes(["AAPL"], preMktMs, extFeedStub);
    const q = result["AAPL"];
    assert.ok(q, "AAPL must be in result");
    assert.equal(q.extPrice, 314.50, "extPrice must be merged");
    assert.equal(q.extChg, -0.54, "extChg must be merged");
    assert.equal(q.extSession, "pre", "extSession must be merged");
    assert.equal(q.extSource, "yahoo_unofficial", "extSource must be merged");
    // Existing fields must survive.
    assert.equal(q.last, 316.22, "existing last must survive");
    assert.equal(q.chg, 0.90, "existing chg must survive");
  });

  it("strips stale ext fields when extFeed returns null", () => {
    const store = makeStore();
    // Pre-populate quote WITH stale ext fields.
    store.quotes.set("NVDA", {
      sym: "NVDA", last: 202.78, market: "us", chg: -0.65,
      prevClose: 204.12, ts: Math.floor(preMktMs / 1000),
      extPrice: 201.00, extChg: -1.53, extTs: Math.floor(preMktMs / 1000) - 200,
      extSession: "post", extSource: "yahoo_unofficial",
    });

    const extFeedNull = makeExtFeedStub(null);
    const result = store.getQuotes(["NVDA"], preMktMs, extFeedNull);
    const q = result["NVDA"];
    assert.ok(q, "NVDA must be in result");
    assert.equal(q.extPrice, undefined, "stale extPrice must be stripped");
    assert.equal(q.extChg, undefined, "stale extChg must be stripped");
    assert.equal(q.extSession, undefined, "stale extSession must be stripped");
    assert.equal(q.extSource, undefined, "stale extSource must be stripped");
  });

  it("does NOT emit ext fields for non-US market (crypto)", () => {
    const store = makeStore();
    store.quotes.set("BTC-USD", {
      sym: "BTC-USD", last: 60000, market: "crypto", chg: 1.23,
      prevClose: 59270, ts: Math.floor(preMktMs / 1000),
    });

    const stubExt = {
      extPrice: 60100,
      extChg: 0.17,
      extTs: Math.floor(preMktMs / 1000),
      extSession: "pre",
      extSource: "yahoo_unofficial",
    };
    const extFeedStub = makeExtFeedStub(stubExt);
    const result = store.getQuotes(["BTC-USD"], preMktMs, extFeedStub);
    const q = result["BTC-USD"];
    assert.ok(q, "BTC-USD must be in result");
    assert.equal(q.extPrice, undefined, "ext fields must NOT be added to crypto quotes");
  });

  it("passes through when extFeed argument is absent (no ext fields)", () => {
    const store = makeStore();
    store.quotes.set("AAPL", {
      sym: "AAPL", last: 316.22, market: "us", chg: 0.90,
      prevClose: 313.39, ts: Math.floor(preMktMs / 1000),
    });
    // Call with no extFeed argument (legacy / hub.js passes null when DISABLE_US).
    const result = store.getQuotes(["AAPL"], preMktMs);
    const q = result["AAPL"];
    assert.ok(q, "AAPL must be in result");
    assert.equal(q.extPrice, undefined, "no extPrice when no extFeed passed");
  });

  it("store passes prevClose as closeRef to getExt when today's close is absent (pre-market regression)", () => {
    // Regression: store.getQuotes used to pass officialClose (null in pre-market),
    // making extChg always null even though prevClose was available.
    // Verified end-to-end: pre-market quote (last=316.22, prevClose=313.39, no close)
    // + injected ext print 314.50 → getExt must receive 313.39 as the close reference
    // and return extChg = (314.50 - 313.39) / 313.39 * 100 = +0.354%.
    const store = makeStore();
    const prevClose = 313.39;
    store.quotes.set("AAPL", {
      sym: "AAPL", last: 316.22, market: "us", chg: 0.90,
      prevClose,
      // Deliberately no `close` field — this is the pre-market / overnight condition.
      ts: Math.floor(preMktMs / 1000),
      live: false, source: "polygon-delayed",
    });

    // Capture the closeRef that store passes to getExt.
    let capturedCloseRef;
    const capturingStub = {
      getExt(sym, nowMs, closeRef) {
        capturedCloseRef = closeRef;
        // Return a real ext entry with the correct extChg for the captured closeRef.
        if (closeRef == null) return null;
        const extPrice = 314.50;
        return {
          extPrice,
          extChg: (extPrice - closeRef) / closeRef * 100,
          extTs: Math.floor(preMktMs / 1000),
          extSession: "pre",
          extSource: "yahoo_unofficial",
        };
      },
    };

    const result = store.getQuotes(["AAPL"], preMktMs, capturingStub);
    assert.equal(capturedCloseRef, prevClose,
      `store must pass prevClose=${prevClose} as closeRef when today's close is absent`);
    const q = result["AAPL"];
    assert.ok(q.extChg !== null && q.extChg !== undefined, "extChg must be non-null pre-market");
    const expectedChg = (314.50 - prevClose) / prevClose * 100;
    assert.ok(Math.abs(q.extChg - expectedChg) < 0.001,
      `extChg=${q.extChg?.toFixed(4)} expected≈${expectedChg.toFixed(4)} (+0.354%)`);
  });
});

// ── Live Yahoo fallback integration (pre-market / post-market only) ───────────
// This test is a live probe: it runs yahooFetchExtPrice for AAPL during the
// appropriate ext window and checks the returned shape.
// If we're in RTH or overnight the test asserts null (which is correct behaviour).

describe("yahooFetchExtPrice live probe (AAPL)", () => {
  it("returns null or a correctly-shaped object depending on current ET session", async () => {
    const nowMs = Date.now();
    const session = classifySession(nowMs);

    const result = await yahooFetchExtPrice("AAPL", nowMs);

    if (session === "rth" || session === "overnight") {
      // Function short-circuits before making a network call in these windows.
      assert.equal(result, null,
        `Must return null during ${session} (no ext print available)`);
    } else {
      // pre or post: may be null if Yahoo has no bars yet (very start of session),
      // or must be a valid object.
      if (result === null) {
        // Acceptable: session just started and Yahoo has no bars yet.
        assert.equal(result, null);
      } else {
        assert.ok(typeof result.price === "number" && Number.isFinite(result.price),
          `price must be a finite number; got ${result.price}`);
        assert.ok(typeof result.ts === "number" && result.ts > 0,
          `ts must be a positive number; got ${result.ts}`);
        assert.ok(result.session === "pre" || result.session === "post",
          `session must be 'pre' or 'post'; got ${result.session}`);
      }
    }
  });
});
