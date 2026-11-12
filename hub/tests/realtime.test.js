"use strict";
// Real-time tier: the MEASUREMENT is the product, not the env flag.
//
// Run with: node --test tests/realtime.test.js
//
// WHAT THIS PINS. `HUB_REALTIME_QUOTES=1` enables a faster poll and a last-trade parse. It must
// never, on its own, cause a quote to be labelled real-time. The basis comes from verdict(),
// which times the youngest print seen against the wall clock. The tests below are written so
// that deleting the measurement and hard-coding `tier: "realtime"` FAILS — several of them
// assert the NON-real-time outcome under a feed that is fully enabled.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Store } = require("../lib/store");
const { SnapshotFeed } = require("../lib/snapshot");

// 2026-08-07 (Friday) 10:00 ET = 14:00 UTC — mid-session.
const RTH = Date.UTC(2026, 7, 7, 14, 0);
// 2026-08-08 (Saturday) 04:41 ET = 08:41 UTC — the weekend this feature was built on.
const WEEKEND = Date.UTC(2026, 7, 8, 8, 41);

const PREV_CLOSE = 312.41;
const LAST_TRADE = 313.25;

/** A Polygon snapshot row whose lastTrade is `ageMs` old at `nowMs`. */
function row(sym, nowMs, ageMs, { price = LAST_TRADE, prevClose = PREV_CLOSE } = {}) {
  const printMs = nowMs - ageMs;
  return {
    ticker: sym,
    day: { o: 311.9, h: 314.1, l: 311.2, c: price, v: 34_562_295 },
    prevDay: { c: prevClose },
    lastTrade: { p: price, s: 100, t: printMs * 1e6 }, // NANOseconds
    min: { c: price, t: printMs },                      // MILLIseconds
    updated: printMs * 1e6,
  };
}

function feedOf(rows, { realtime = true } = {}) {
  return new SnapshotFeed({ apiKey: "test-key", realtime, fetchJson: async () => ({ tickers: rows }) });
}

describe("parseSnapshot — unit discipline on the two timestamp fields", () => {
  it("reads lastTrade.t as NANOseconds and min.t as MILLIseconds", async () => {
    const { parseSnapshot } = require("../lib/snapshot");
    const snap = parseSnapshot(row("AAPL", RTH, 3_000));
    // Confusing the two units puts the print 10^6 out — a confidently wrong freshness verdict.
    assert.equal(snap.printMs, RTH - 3_000);
    assert.equal(snap.printFrom, "lastTrade");
    assert.equal(snap.printPrice, LAST_TRADE);
  });

  it("falls back to the minute bar, then to `updated`, when there is no trade block", () => {
    const { parseSnapshot } = require("../lib/snapshot");
    const noTrade = row("AAPL", RTH, 5_000);
    delete noTrade.lastTrade;
    assert.equal(parseSnapshot(noTrade).printFrom, "min");

    const bare = row("AAPL", RTH, 5_000);
    delete bare.lastTrade;
    delete bare.min;
    assert.equal(parseSnapshot(bare).printFrom, "updated");
  });
});

describe("verdict — measured, not configured", () => {
  it("grades a seconds-old print as real-time DURING a session", async () => {
    const feed = feedOf([row("AAPL", RTH, 3_000)]);
    feed.demand("AAPL", RTH);
    // Fixed clock: without it this assertion degrades to "closed" every weekend and stops
    // testing the rule it was written for.
    await feed._flush(RTH);
    const v = feed.verdict(RTH);
    assert.equal(v.tier, "realtime");
    assert.equal(v.floorLagMs, 3_000);
    assert.equal(v.session, "rth");
  });

  it("grades a 15-minute-old print as delayed, from the same measurement", async () => {
    const feed = feedOf([row("AAPL", RTH, 15 * 60_000 + 2_000)]);
    feed.demand("AAPL", RTH);
    await feed._flush(RTH);
    assert.equal(feed.verdict(RTH).tier, "delayed");
  });

  it("ignores a print from a PREVIOUS session when measuring the floor", async () => {
    // A row left over from yesterday would otherwise contribute a multi-hour floor and mask a
    // genuine measurement — or, on a stale cache, invent one.
    const stale = row("AAPL", RTH, 26 * 3600_000); // ~yesterday
    const feed = feedOf([stale]);
    feed.demand("AAPL", RTH);
    await feed._flush(RTH);
    assert.equal(feed.verdict(RTH).tier, "unknown");
    assert.equal(feed._floorLagMs, null);
  });

  it("REFUSES to grade on a weekend — an old print proves nothing when nothing is printing", () => {
    const feed = feedOf([row("AAPL", WEEKEND, 3_000)]);
    const v = feed.verdict(WEEKEND);
    assert.equal(v.tier, "closed",
      "a Saturday must not read as 'delayed' — the tape is shut, not lagging");
    assert.equal(v.floorLagMs, null);
  });

  it("is 'off' when the real-time leg was never enabled", () => {
    const feed = feedOf([row("AAPL", RTH, 3_000)], { realtime: false });
    assert.equal(feed.verdict(RTH).tier, "off");
  });

  it("is 'unknown' before anything has been measured — never optimistic by default", () => {
    const feed = feedOf([]);
    const v = feed.verdict(RTH);
    assert.equal(v.tier, "unknown");
    assert.equal(v.floorLagMs, null);
  });

  it("measures the FLOOR across symbols, so one quiet ticker cannot demote a live feed", () => {
    // MSFT has not printed in 11 minutes (legitimate for an illiquid window); AAPL printed 2s
    // ago. The feed is real-time — a per-symbol rule would have called it delayed.
    const feed = feedOf([]);
    feed._floorLagMs = 2_000;
    feed._floorAt = RTH;
    assert.equal(feed.verdict(RTH).tier, "realtime");

    // …and a floor that is genuinely 15 minutes old is the delayed plan, correctly identified.
    feed._floorLagMs = 15 * 60_000 + 30_000;
    feed._floorAt = RTH;
    const delayed = feed.verdict(RTH);
    assert.equal(delayed.tier, "delayed");
    assert.equal(delayed.floorLagMs, 15 * 60_000 + 30_000);
  });

  it("expires a stale measurement rather than re-serving it forever", () => {
    const feed = feedOf([]);
    feed._floorLagMs = 2_000;
    feed._floorAt = RTH - 20 * 60_000; // measured 20 min ago, window is 5
    assert.equal(feed.verdict(RTH).tier, "unknown");
  });
});

describe("store overlay — freshest print wins, but only on a measured real-time feed", () => {
  const anchor = { prevClose: PREV_CLOSE, close: null, anchor_source: "daily_file" };

  /** Store whose AAPL row came from the 15-min-delayed AM.* stream, stamped 15 min ago. */
  function delayedStreamStore(nowMs) {
    const store = new Store("/dev/null/manifest.json", { get: () => anchor });
    store.quotes.set("AAPL", {
      sym: "AAPL",
      last: 311.00,
      market: "us",
      live: false,
      source: "polygon-delayed",
      basis: "DELAYED_15M",
      regularSession: "rth",
      regularSessionDate: "2026-08-07",
      ts: Math.floor((nowMs - 15 * 60_000) / 1000),
    });
    return store;
  }

  it("a MEASURED real-time snapshot overrides a 15-min-old stream print", async () => {
    const store = delayedStreamStore(RTH);
    const feed = feedOf([row("AAPL", RTH, 3_000)]);
    feed.demand("AAPL", RTH);
    await feed._flush();
    // Pin the measurement to the test clock so the assertion is about the RULE, not about
    // how long this process took to get here.
    feed._floorLagMs = 3_000;
    feed._floorAt = RTH;

    const out = store.getQuotes(["AAPL"], RTH, null, feed);
    assert.equal(out.AAPL.basis, "REALTIME");
    assert.equal(out.AAPL.source, "polygon-snapshot-rt");
    assert.equal(out.AAPL.last, LAST_TRADE, "the delayed 311.00 must not survive");
    assert.equal(out.AAPL.live, true);
    assert.ok(out.AAPL.lagMs != null, "the number the verdict was made on rides along");
    // asOfMs is the STABLE half of the pair — it moves only when a new print lands, which is
    // what lets the client skip a re-render on a quiet symbol without freezing the shown age.
    assert.equal(out.AAPL.asOfMs, RTH - 3_000);
    // ONE chg formula, recomputed against the price actually published.
    const want = ((LAST_TRADE - PREV_CLOSE) / PREV_CLOSE) * 100;
    assert.ok(Math.abs(out.AAPL.chg - want) < 1e-9, `chg=${out.AAPL.chg}`);
  });

  it("does NOT override when the feed has not measured itself real-time", async () => {
    // Same data, same freshness, real-time mode OFF. The old rule (stream is authoritative)
    // must still hold, and nothing may claim REALTIME.
    const store = delayedStreamStore(RTH);
    const feed = feedOf([row("AAPL", RTH, 3_000)], { realtime: false });
    feed.demand("AAPL", RTH);
    await feed._flush();

    const out = store.getQuotes(["AAPL"], RTH, null, feed);
    assert.equal(out.AAPL.basis, "DELAYED_15M");
    assert.equal(out.AAPL.last, 311.00);
    assert.notEqual(out.AAPL.source, "polygon-snapshot-rt");
  });

  it("does not override on a TIE — a quiet symbol must not flap between two legs", async () => {
    const store = delayedStreamStore(RTH);
    const streamTs = store.quotes.get("AAPL").ts;
    // Snapshot print lands on the very second the stream already reported.
    const feed = feedOf([row("AAPL", RTH, RTH - streamTs * 1000)]);
    feed.demand("AAPL", RTH);
    await feed._flush();
    feed._floorLagMs = 3_000;
    feed._floorAt = RTH;

    const out = store.getQuotes(["AAPL"], RTH, null, feed);
    assert.equal(out.AAPL.basis, "DELAYED_15M", "equal timestamps keep the incumbent");
  });

  it("still rescues a symbol the stream is not carrying at all (the SKY path, unchanged)", async () => {
    const store = new Store("/dev/null/manifest.json", { get: () => anchor });
    store.quotes.set("AAPL", {
      sym: "AAPL", last: PREV_CLOSE, market: "us", live: false,
      source: "polygon-delayed", basis: "DELAYED_15M", regularSession: "closed",
      ts: Math.floor(RTH / 1000),
    });
    const feed = feedOf([row("AAPL", RTH, 4_000)], { realtime: false });
    feed.demand("AAPL", RTH);
    await feed._flush();

    const out = store.getQuotes(["AAPL"], RTH, null, feed);
    assert.equal(out.AAPL.regularSessionDate, "2026-08-07");
    assert.equal(out.AAPL.last, LAST_TRADE);
  });
});

describe("per-NAME freshness — the verdict grades the feed, but the badge is per symbol", () => {
  // 2026-08-07 (Friday) 15:30 ET = 19:30 UTC — late in the session.
  const LATE = Date.UTC(2026, 7, 7, 19, 30);
  // 09:35 ET the SAME day: a real print, from this session, but 5h55m stale by LATE.
  const QUIET_PRINT = Date.UTC(2026, 7, 7, 13, 35);
  const anchor = { prevClose: 11.0, close: null, anchor_source: "daily_file" };

  /** A name that DID trade today (day.c > 0, so the 0=MISSING rule admits the row) and has not
   *  printed since `printMs`. `updated` is now, which is what dates the snapshot as today's. */
  const quietRow = (printMs) => ({
    ticker: "SGML",
    day: { o: 9.5, h: 9.6, l: 9.4, c: 9.5, v: 1200 },
    prevDay: { c: 11.0 },
    lastTrade: { p: 9.5, s: 100, t: printMs * 1e6 }, // NANOseconds
    updated: LATE * 1e6,
  });

  /** Store in the SKY shape: the stream is not carrying SGML today at all. */
  function storeWithoutTodaysPrint() {
    const store = new Store("/dev/null/manifest.json", { get: () => anchor });
    store.quotes.set("SGML", {
      sym: "SGML", last: 11.0, market: "us", live: false, source: "manifest",
      basis: "EOD", regularSession: "rth", regularSessionDate: "2026-08-06",
      ts: Math.floor(Date.UTC(2026, 7, 7, 0, 0) / 1000),
    });
    return store;
  }

  /** Liquid sibling printing 3s ago — this is what holds the FEED's floor at real-time. */
  const liquidRow = () => row("AAPL", LATE, 3_000);

  it("does NOT adopt a name's hours-old print as real-time, however fresh its siblings are", async () => {
    // The measured failure this bounds: floorLagMs=3000 from AAPL let SGML's 5h55m-old print
    // publish basis:"REALTIME", live:true — a green "Live" chip on a six-hour-old price, with
    // the true age reachable only on hover.
    const feed = feedOf([liquidRow(), quietRow(QUIET_PRINT)]);
    feed.demand("AAPL", LATE); feed.demand("SGML", LATE);
    await feed._flush(LATE);

    assert.equal(feed.verdict(LATE).tier, "realtime", "the FEED is genuinely real-time");

    const out = storeWithoutTodaysPrint().getQuotes(["SGML"], LATE, null, feed);
    assert.equal(out.SGML.basis, "DELAYED_15M", "a stale print cannot ride a fresh floor");
    assert.equal(out.SGML.live, false);
    assert.notEqual(out.SGML.source, "polygon-snapshot-rt");
    // The day-price fallback has no proven print clock, even at the same numeric price.
    assert.equal(out.SGML.last, 9.5);
    assert.equal(out.SGML.asOfMs, undefined);
    assert.equal(out.SGML.lagMs, undefined);
  });

  it("still adopts the SAME name once its own print is fresh — the bound is not a blanket refusal", async () => {
    // Guards against over-correcting: an ordinarily quiet name that has just printed must still
    // read live, or the fix trades one wrong label for the opposite wrong label.
    const feed = feedOf([liquidRow(), quietRow(LATE - 40_000)]);
    feed.demand("AAPL", LATE); feed.demand("SGML", LATE);
    await feed._flush(LATE);

    const out = storeWithoutTodaysPrint().getQuotes(["SGML"], LATE, null, feed);
    assert.equal(out.SGML.basis, "REALTIME");
    assert.equal(out.SGML.live, true);
    assert.equal(out.SGML.last, 9.5);
  });
});

describe("the freshness floor spans the whole flush, not the last chunk", () => {
  const LATE = Date.UTC(2026, 7, 7, 19, 30);

  it("takes the MINIMUM across chunks, so a trailing quiet chunk cannot demote a live feed", async () => {
    // CHUNK is 50, so 60 symbols are two upstream calls. The youngest print in the batch sits in
    // the FIRST chunk; the second chunk is entirely 10-minute-old prints. A per-chunk write made
    // the last chunk win and graded this feed "delayed" — flapping basis/live/source on every
    // symbol between polls.
    const fresh = row("AAPL", LATE, 3_000);
    const stale = (i) => row(`Q${i}`, LATE, 10 * 60_000);
    const rows = [fresh, ...Array.from({ length: 59 }, (_, i) => stale(i))];
    const bySym = new Map(rows.map((r) => [r.ticker, r]));

    const feed = new SnapshotFeed({
      apiKey: "test-key", realtime: true,
      // Honour the chunking: return only the rows this request actually asked for. A stub that
      // returns every row for every call would put the fresh print in both chunks and the test
      // would pass against the defect.
      fetchJson: async (url) => {
        const asked = decodeURIComponent(new URL(url).searchParams.get("tickers") || "").split(",");
        return { tickers: asked.map((s) => bySym.get(s)).filter(Boolean) };
      },
    });
    for (const r of rows) feed.demand(r.ticker, LATE);
    await feed._flush(LATE);

    const v = feed.verdict(LATE);
    assert.equal(v.floorLagMs, 3_000, "the floor is the youngest print in the whole flush");
    assert.equal(v.tier, "realtime");
  });
});


describe("snapshot market-clock eligibility through the quote response", () => {
  const { parseSnapshot } = require("../lib/snapshot");
  const { buildQuotesResponse } = require("../lib/quotes");
  const anchor = { prevClose: 100, close: null, anchor_source: "daily_file" };

  function clockRow(sym = "TEST", {
    printMs = RTH - 4_000, origin = "lastTrade", updatedMs = RTH,
    price = 102, close = 101,
  } = {}) {
    const value = {
      ticker: sym, day: { o: 100, h: 104, l: 99, c: close, v: 1000 },
      prevDay: { c: 100 }, updated: updatedMs * 1e6,
    };
    if (origin === "lastTrade") value.lastTrade = { p: price, t: printMs * 1e6 };
    if (origin === "min") value.min = { c: price, t: printMs };
    return value;
  }

  function clockStore(syms = ["TEST"]) {
    const store = new Store("/dev/null/manifest.json", { get: () => anchor });
    for (const sym of syms) store.quotes.set(sym, {
      sym, last: 100, market: "us", live: false, source: "manifest", basis: "EOD",
      regularSession: "closed", ts: Math.floor(RTH / 1000),
    });
    return store;
  }

  async function clockFeed(rows, { now = RTH, realtime = true, disabled = false } = {}) {
    const feed = new SnapshotFeed({
      apiKey: "synthetic-key", realtime, disabled,
      fetchJson: async () => ({ tickers: rows }),
    });
    for (const value of rows) feed.demand(value.ticker, now);
    await feed._flush(now);
    return feed;
  }

  function response(store, feed, now = RTH, syms = ["TEST"], extra = {}) {
    return buildQuotesResponse(syms, now, { store, snapshotFeed: feed, ...extra },
      { includeExtended: false });
  }

  function assertUnmeasured(quote) {
    assert.equal(quote.live, false);
    assert.equal(quote.basis, "DELAYED_15M");
    assert.equal(quote.asOfMs, undefined, "refresh time is not a print instant");
    assert.equal(quote.lagMs, undefined, "unknown print age is not zero lag");
  }

  it("keeps an updated-only price without manufacturing feed or per-name freshness", async () => {
    const feed = await clockFeed([clockRow("TEST", { origin: "updated" })]);
    assert.equal(feed.verdict(RTH).tier, "unknown");
    assert.equal(feed._floorLagMs, null);
    assert.equal(feed.get("TEST", RTH).lagMs, null);
    const quote = response(clockStore(), feed).TEST;
    assert.equal(quote.last, 101);
    assert.equal(quote.prevClose, 100);
    assert.equal(quote.chg, 1);
    assert.equal(quote.regularSessionDate, "2026-08-07");
    assertUnmeasured(quote);
  });

  it("does not let a liquid sibling lend a refresh-only name a measured print instant", async () => {
    const feed = await clockFeed([clockRow("GOOD"), clockRow("TEST", { origin: "updated" })]);
    assert.equal(feed.verdict(RTH).tier, "realtime");
    const quotes = response(clockStore(["TEST", "GOOD"]), feed, RTH, ["TEST", "GOOD"]);
    assertUnmeasured(quotes.TEST);
    assert.equal(quotes.GOOD.live, true);
    assert.equal(quotes.GOOD.asOfMs, RTH - 4_000);
  });

  for (const [name, printMs] of [
    ["future", RTH + 1], ["NaN", NaN], ["infinity", Infinity],
    ["out of Date range", 1e100], ["zero", 0], ["negative", -1],
  ]) {
    it("refuses a " + name + " print clock while preserving a valid sibling and fallback price", async () => {
      const feed = await clockFeed([clockRow("TEST", { printMs }), clockRow("GOOD")]);
      assert.equal(feed._errors, 0, "a malformed clock must not abort its response chunk");
      assert.equal(feed.verdict(RTH).floorLagMs, 4_000);
      assert.equal(feed.get("TEST", RTH).lagMs, null);
      const quotes = response(clockStore(["TEST", "GOOD"]), feed, RTH, ["TEST", "GOOD"]);
      assert.equal(quotes.TEST.last, 101);
      assertUnmeasured(quotes.TEST);
      assert.equal(quotes.GOOD.last, 102);
      assert.equal(quotes.GOOD.basis, "REALTIME");
    });
  }

  for (const updatedMs of [NaN, Infinity, 1e100]) {
    it("isolates an invalid snapshot date " + String(updatedMs) + " from valid siblings", async () => {
      const invalid = clockRow("BAD", { updatedMs });
      assert.doesNotThrow(() => parseSnapshot(invalid));
      assert.equal(parseSnapshot(invalid), null);
      const feed = await clockFeed([invalid, clockRow("GOOD")]);
      assert.equal(feed._errors, 0);
      assert.equal(feed.get("BAD", RTH), null);
      assert.equal(feed.verdict(RTH).floorLagMs, 4_000);
      assert.equal(response(clockStore(["GOOD"]), feed, RTH, ["GOOD"]).GOOD.last, 102);
    });
  }

  for (const origin of ["lastTrade", "min"]) {
    it("measures a genuine " + origin + " clock at fetch, read and response time", async () => {
      const feed = await clockFeed([clockRow("TEST", { origin })]);
      assert.equal(feed.verdict(RTH).floorLagMs, 4_000);
      assert.equal(feed.get("TEST", RTH + 2_000).lagMs, 6_000);
      const quote = response(clockStore(), feed, RTH + 2_000).TEST;
      assert.equal(quote.last, 102);
      assert.equal(quote.ts, Math.floor((RTH - 4_000) / 1000));
      assert.equal(quote.asOfMs, RTH - 4_000);
      assert.equal(quote.lagMs, 6_000);
      assert.equal(quote.basis, "REALTIME");
    });
  }

  it("falls back from an unrepresentable trade timestamp to a genuine minute clock", async () => {
    const value = clockRow("TEST", { printMs: 1e100 });
    value.min = { c: 103, t: RTH - 5_000 };
    const feed = await clockFeed([value]);
    assert.equal(feed._errors, 0);
    assert.equal(feed.get("TEST", RTH).printFrom, "min");
    const quote = response(clockStore(), feed).TEST;
    assert.equal(quote.last, 103);
    assert.equal(quote.asOfMs, RTH - 5_000);
  });

  for (const [age, tier] of [
    [2 * 60_000, "realtime"], [2 * 60_000 + 1, "delayed"],
    [20 * 60_000, "delayed"], [20 * 60_000 + 1, "unknown"],
  ]) {
    it("preserves the feed boundary at age " + age, async () => {
      const feed = await clockFeed([clockRow("TEST", { printMs: RTH - age })]);
      assert.equal(feed.verdict(RTH).tier, tier);
    });
  }

  for (const age of [15 * 60_000, 15 * 60_000 + 1]) {
    it("preserves the per-name boundary at age " + age + " under a fresh sibling floor", async () => {
      const feed = await clockFeed([clockRow("GOOD"), clockRow("TEST", { printMs: RTH - age })]);
      const quote = response(clockStore(), feed).TEST;
      assert.equal(quote.live, age === 15 * 60_000);
      if (age === 15 * 60_000) {
        assert.equal(quote.last, 102);
        assert.equal(quote.asOfMs, RTH - age);
        assert.equal(quote.lagMs, age);
      } else {
        assert.equal(quote.last, 101);
        assertUnmeasured(quote);
      }
    });
  }

  it("checks the actual ET print date instead of trusting a forged date label", async () => {
    const feed = await clockFeed([clockRow("TEST", { printMs: RTH - 24 * 3600_000 })]);
    const cached = feed._cache.get("TEST");
    cached.snap.printDate = "2026-08-07";
    feed._floorLagMs = 1;
    feed._floorAt = RTH;
    assert.equal(feed.get("TEST", RTH).lagMs, null);
    assertUnmeasured(response(clockStore(), feed).TEST);
  });

  it("uses ET, not the UTC date, across the midnight boundary", async () => {
    const now = Date.UTC(2026, 7, 7, 4, 30); // 00:30 ET
    const previousET = Date.UTC(2026, 7, 7, 3, 59); // same UTC date, prior ET date
    const feed = await clockFeed([clockRow("TEST", { printMs: previousET, updatedMs: now })], { now });
    assert.equal(feed.get("TEST", now).lagMs, null);
    assert.equal(feed.verdict(now).tier, "closed");
    assertUnmeasured(response(clockStore(), feed, now).TEST);
  });

  for (const now of [NaN, Infinity, 1e100]) {
    it("refuses an invalid decision clock " + String(now) + " without date conversion failure", async () => {
      const feed = await clockFeed([clockRow()]);
      assert.equal(feed.get("TEST", now), null);
      assert.equal(feed.getCompleted("TEST", now, 101), null);
      assert.equal(feed.verdict(now).tier, "unknown");
      assert.deepEqual(response(clockStore(), feed, now), {});
    });
  }

  it("refuses an invalid flush clock before any transport or cache observation", async () => {
    const feed = new SnapshotFeed({
      apiKey: "synthetic-key", realtime: true,
      fetchJson: async () => assert.fail("invalid decision clock reached transport"),
    });
    feed._pending.add("TEST");
    for (const now of [NaN, Infinity, 1e100]) await feed._flush(now);
    assert.equal(feed._cache.size, 0);
    assert.equal(feed._lastOkAt, null);
    assert.equal(feed.verdict(RTH).tier, "unknown");
  });

  it("does not grade a measurement observed after the decision clock", async () => {
    const feed = await clockFeed([clockRow()]);
    assert.equal(feed.verdict(RTH).tier, "realtime");
    assert.equal(feed.verdict(RTH - 1).tier, "unknown");
  });

  it("revalidates clock origin and lag in Store even when an injected feed overclaims", () => {
    const snap = parseSnapshot(clockRow("TEST", { origin: "updated" }));
    const feed = { get: () => ({ ...snap, lagMs: 0 }), verdict: () => ({ tier: "realtime" }) };
    assertUnmeasured(response(clockStore(), feed).TEST);
  });

  it("keeps the realtime mode and disabled feed policies intact", async () => {
    const off = await clockFeed([clockRow()], { realtime: false });
    const quote = response(clockStore(), off).TEST;
    assert.equal(off.verdict(RTH).tier, "off");
    assert.equal(quote.live, false);
    assert.equal(quote.last, 101);
    assertUnmeasured(quote);
    let fetches = 0;
    const disabled = new SnapshotFeed({
      apiKey: "synthetic-key", realtime: true, disabled: true,
      fetchJson: async () => { fetches++; assert.fail("disabled feed called transport"); },
    });
    disabled.demand("TEST", RTH);
    await disabled._flush(RTH);
    assert.equal(disabled.verdict(RTH).tier, "off");
    assert.equal(disabled.get("TEST", RTH), null);
    assert.equal(fetches, 0);
  });

  it("preserves the closed-session fallback and regular-view extended-feed boundary", async () => {
    const now = Date.UTC(2026, 7, 8, 1, 0); // Friday 21:00 ET, same ET session date
    const feed = await clockFeed([clockRow("TEST", { origin: "updated", updatedMs: now })], { now });
    assert.equal(feed.verdict(now).tier, "closed");
    const quote = response(clockStore(), feed, now, ["TEST"], {
      extFeed: { getExt: () => assert.fail("regular view reached extended feed") },
    }).TEST;
    assert.equal(quote.last, 101);
    assert.equal(quote.close, 101);
    assert.equal(quote.marketSession, "overnight");
    assertUnmeasured(quote);
  });

  it("preserves the explicit zero-day premarket exclusion", () => {
    const value = clockRow();
    value.day.c = 0;
    assert.equal(parseSnapshot(value), null);
  });

  it("recovers from refresh-only fallback even when the genuine print precedes its refresh timestamp", async () => {
    const store = clockStore();
    const first = await clockFeed([clockRow("TEST", { origin: "updated" })]);
    assertUnmeasured(response(store, first).TEST);
    store.setQuote("TEST", { vol: 2000 }, RTH);
    const next = await clockFeed([clockRow("TEST", { printMs: RTH - 3_000 })]);
    const quote = response(store, next).TEST;
    assert.equal(quote.last, 102);
    assert.equal(quote.basis, "REALTIME");
    assert.equal(quote.asOfMs, RTH - 3_000);
  });

  it("recovers from a day-price fallback when a newer realtime print becomes available", async () => {
    const store = clockStore();
    const first = await clockFeed([clockRow("TEST", { printMs: RTH - 30_000 })], { realtime: false });
    response(store, first);
    const next = await clockFeed([clockRow("TEST", { printMs: RTH - 3_000 })]);
    const quote = response(store, next).TEST;
    assert.equal(quote.basis, "REALTIME");
    assert.equal(quote.asOfMs, RTH - 3_000);
  });

  it("does not turn a timestamp-only heartbeat into market-event precedence", async () => {
    const store = clockStore();
    response(store, await clockFeed([clockRow("TEST", { origin: "updated" })]));
    store.setQuote("TEST", { ts: Math.floor(RTH / 1000) + 1 }, RTH + 1_000);
    const quote = response(store, await clockFeed([clockRow()]), RTH + 1_000).TEST;
    assert.equal(quote.last, 102);
    assert.equal(quote.basis, "REALTIME");
  });

  for (const samePrice of [false, true]) {
    it("preserves a genuine newer stream partial with " + (samePrice ? "unchanged" : "changed") + " price and inherited source", async () => {
      const store = clockStore();
      response(store, await clockFeed([clockRow()]));
      const last = samePrice ? 102 : 103;
      store.setQuote("TEST", { last, ts: Math.floor((RTH - 1_000) / 1000) }, RTH);
      const quote = response(store, await clockFeed([clockRow("TEST", { printMs: RTH - 2_000, price: 104 })])).TEST;
      assert.equal(quote.last, last, "older REST print must not replace the actual stream observation");
      assert.equal(quote.ts, Math.floor((RTH - 1_000) / 1000));
      assert.equal(quote.asOfMs, undefined, "AM partial does not inherit a snapshot's measured instant");
      assert.equal(quote.lagMs, undefined);
    });
  }

  it("keeps the existing seconds-level stream tie rule after a snapshot-to-stream transition", async () => {
    const store = clockStore();
    response(store, await clockFeed([clockRow()]));
    store.setQuote("TEST", { last: 103, ts: Math.floor((RTH - 2_000) / 1000) }, RTH);
    const quote = response(store, await clockFeed([clockRow("TEST", { printMs: RTH - 1_500, price: 104 })])).TEST;
    assert.equal(quote.last, 103);
  });

  it("retains the measured fields supplied by a genuine second-aggregate partial", async () => {
    const store = clockStore();
    response(store, await clockFeed([clockRow()]));
    const asOfMs = RTH - 500;
    store.setQuote("TEST", {
      last: 103, ts: Math.floor(asOfMs / 1000), asOfMs, lagMs: 500,
      regularSession: "rth", regularSessionDate: "2026-08-07",
      source: "polygon-live-second", basis: "REALTIME", live: true,
    }, RTH);
    const quote = response(store, await clockFeed([clockRow()])).TEST;
    assert.equal(quote.last, 103);
    assert.equal(quote.asOfMs, asOfMs);
    assert.equal(quote.lagMs, 500);
    assert.equal(quote.source, "polygon-live-second");
  });

  it("keeps internal clock provenance out of serialized quotes and preserves Store recovery after a regular-view copy", async () => {
    const store = clockStore();
    const body = response(store, await clockFeed([clockRow("TEST", { origin: "updated" })]));
    const allowed = new Set([
      "sym", "last", "market", "live", "source", "basis", "regularSession", "ts",
      "prevClose", "chg", "anchor_source", "marketSession", "regularSessionDate",
      "open", "high", "low", "vol", "asOfMs", "lagMs",
    ]);
    for (const key of Object.keys(JSON.parse(JSON.stringify(body)).TEST)) {
      assert.ok(allowed.has(key), "unexpected public field: " + key);
    }
    body.TEST.ts = 1e100;
    body.TEST.last = 999;
    store.setQuote("TEST", { amount: 1000 }, RTH);
    const recovered = response(store, await clockFeed([clockRow()])).TEST;
    assert.equal(recovered.last, 102);
    assert.equal(recovered.asOfMs, RTH - 4_000);
  });


  for (const origin of ["lastTrade", "min"]) {
    it("recovers an off-feed day-price fallback from the same " + origin + " observation", async () => {
      const store = clockStore();
      const value = clockRow("TEST", { origin });
      const first = response(store, await clockFeed([value], { realtime: false })).TEST;
      assert.equal(first.last, 101);
      assertUnmeasured(first);
      const recovered = response(store, await clockFeed([value])).TEST;
      assert.equal(recovered.last, 102);
      assert.equal(recovered.asOfMs, RTH - 4_000);
      assert.equal(recovered.lagMs, 4_000);
      assert.equal(recovered.basis, "REALTIME");
    });

    it("recovers a delayed-feed day-price fallback when a sibling qualifies the same " + origin + " observation", async () => {
      const store = clockStore();
      const value = clockRow("TEST", { origin, printMs: RTH - 3 * 60_000 });
      const delayed = await clockFeed([value]);
      assert.equal(delayed.verdict(RTH).tier, "delayed");
      const first = response(store, delayed).TEST;
      assert.equal(first.last, 101);
      assertUnmeasured(first);
      const realtime = await clockFeed([value, clockRow("GOOD")]);
      assert.equal(realtime.verdict(RTH).tier, "realtime");
      const recovered = response(store, realtime).TEST;
      assert.equal(recovered.last, 102);
      assert.equal(recovered.asOfMs, RTH - 3 * 60_000);
      assert.equal(recovered.lagMs, 3 * 60_000);
      assert.equal(recovered.basis, "REALTIME");
    });

    it("keeps a stale-name day-price fallback unmeasured until a fresh " + origin + " price is adopted", async () => {
      const store = clockStore();
      const stale = clockRow("TEST", { origin, printMs: RTH - 15 * 60_000 - 1 });
      const feed = await clockFeed([stale, clockRow("GOOD")]);
      assert.equal(feed.verdict(RTH).tier, "realtime");
      const first = response(store, feed).TEST;
      assert.equal(first.last, 101);
      assertUnmeasured(first);
      const recovered = response(store, await clockFeed([
        clockRow("TEST", { origin, printMs: RTH - 3_000, price: 103 }),
      ])).TEST;
      assert.equal(recovered.last, 103);
      assert.equal(recovered.asOfMs, RTH - 3_000);
      assert.equal(recovered.lagMs, 3_000);
      assert.equal(recovered.basis, "REALTIME");
    });

    it("preserves actual adopted " + origin + " price precedence and a strictly newer subsecond observation", async () => {
      const store = clockStore();
      const firstMs = RTH - 3_800;
      const first = response(store, await clockFeed([
        clockRow("TEST", { origin, printMs: firstMs, price: 102 }),
      ])).TEST;
      assert.equal(first.last, 102);
      assert.equal(first.asOfMs, firstMs);
      for (const printMs of [RTH - 3_900, firstMs]) {
        const kept = response(store, await clockFeed([
          clockRow("TEST", { origin, printMs, price: 104 }),
        ])).TEST;
        assert.equal(kept.last, 102);
        assert.equal(kept.asOfMs, firstMs);
      }
      const nextMs = RTH - 3_200;
      const next = response(store, await clockFeed([
        clockRow("TEST", { origin, printMs: nextMs, price: 103 }),
      ])).TEST;
      assert.equal(Math.floor(firstMs / 1000), Math.floor(nextMs / 1000));
      assert.equal(next.last, 103);
      assert.equal(next.asOfMs, nextMs);
      assert.equal(next.lagMs, 3_200);
    });
  }

  it("does not infer day-price clock provenance from equality with an unused print price", async () => {
    const value = clockRow("TEST", { price: 101, close: 101 });
    const quote = response(clockStore(), await clockFeed([value], { realtime: false })).TEST;
    assert.equal(quote.last, 101);
    assertUnmeasured(quote);
  });

  it("does not stamp a closed-session day-price fallback with its unused trade clock", async () => {
    const now = Date.UTC(2026, 7, 8, 1, 0);
    const value = clockRow("TEST", { printMs: now - 4_000, updatedMs: now });
    const feed = await clockFeed([value], { now });
    assert.equal(feed.verdict(now).tier, "closed");
    const quote = response(clockStore(), feed, now).TEST;
    assert.equal(quote.last, 101);
    assert.equal(quote.close, 101);
    assert.equal(quote.marketSession, "overnight");
    assertUnmeasured(quote);
  });

  for (const partial of [
    { last: 105 },
    { last: 105, ts: String(Math.floor(RTH / 1000)) },
    { last: 105, ts: Infinity },
    { last: 105, ts: Math.floor(RTH / 1000) + 1 },
    { last: 105, ts: Math.floor(RTH / 1000), regularSession: "closed" },
  ]) {
    it("removes measured snapshot fields from a value replacement without a genuine market clock " + JSON.stringify(partial), async () => {
      const store = clockStore();
      response(store, await clockFeed([clockRow()]));
      const replaced = store.setQuote("TEST", partial, RTH);
      assert.equal(replaced.last, 105);
      assert.equal(replaced.asOfMs, undefined);
      assert.equal(replaced.lagMs, undefined);
      const recovered = response(store, await clockFeed([clockRow("TEST", { printMs: RTH - 3_000 })])).TEST;
      assert.equal(recovered.last, 102);
      assert.equal(recovered.basis, "REALTIME");
    });
  }
});
