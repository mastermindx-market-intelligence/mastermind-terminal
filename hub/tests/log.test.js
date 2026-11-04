"use strict";
// Unit tests for lib/log.js tally(): a burst of routine events (subscription LRU evictions)
// must produce a bounded number of INFO lines, while eviction behaviour stays unchanged.
// Run with: node --test "tests/*.test.js"   (Node ≥ 18 built-in test runner)
//
// Background: ExtFeed.demand runs for every US symbol on every /quotes request. One INFO line
// per eviction wrote 2,965,049 lines (412 MB) to the VPS syslog in the week to 2026-11-01.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const log = require("../lib/log");
const { ExtFeed, WebullFeed, WEBULL_LRU_CAP } = require("../lib/extfeed");
const { MacroFeed } = require("../lib/macrofeed");
const { Polygon } = require("../lib/polygon");

const WINDOW = log.TALLY_WINDOW_MS;

// Collect the INFO lines written to stdout while fn runs; the original writer is always restored.
function captureStdout(fn) {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    return true;
  };
  try { fn(); } finally { process.stdout.write = original; }
  return lines;
}

const evictionLines = (lines) => lines.filter((l) => l.includes("LRU-evicted"));

describe("log.tally", () => {
  // A test that fails mid-window would otherwise leave an open tally for the next one.
  afterEach(() => { captureStdout(() => log.flushTallies()); });

  it("reports a 10,000-event burst as ONE INFO line when the window closes", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const during = captureStdout(() => {
      for (let i = 0; i < 10_000; i++) log.tally("test LRU-evicted", `S${i}`);
    });
    assert.deepEqual(during, [], "nothing is written while the window is open");

    const closed = captureStdout(() => t.mock.timers.tick(WINDOW));
    assert.equal(closed.length, 1);
    assert.match(closed[0], /\[INFO\] test LRU-evicted x10000 in 60s window \(last S9999\)$/);
  });

  it("opens a fresh window after a summary, one line per window per key", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const lines = captureStdout(() => {
      for (let w = 0; w < 5; w++) {
        for (let i = 0; i < 1_000; i++) {
          log.tally("a LRU-evicted", `A${i}`);
          log.tally("b LRU-evicted", `B${i}`);
        }
        t.mock.timers.tick(WINDOW);
      }
    });
    assert.equal(lines.length, 10, "5 windows × 2 keys");
    assert.ok(lines.every((l) => / x1000 in 60s window /.test(l)));
  });

  it("closes a window on the next event when a stalled event loop kept the timer from firing", (t) => {
    // Only Date is mocked: the real 60 s timer cannot fire inside this test.
    t.mock.timers.enable({ apis: ["Date"], now: 0 });
    const lines = captureStdout(() => {
      log.tally("stall LRU-evicted", "X1");
      log.tally("stall LRU-evicted", "X2");
      t.mock.timers.tick(WINDOW + 1);
      log.tally("stall LRU-evicted", "X3");
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /stall LRU-evicted x2 in 60s window \(last X2\)$/);
    const rest = captureStdout(() => log.flushTallies());
    assert.match(rest[0], /stall LRU-evicted x1 in 60s window \(last X3\)$/);
  });

  it("writes each event at DEBUG only when HUB_LOG_LEVEL=DEBUG", () => {
    const script = [
      `const log = require(${JSON.stringify(path.join(__dirname, "../lib/log"))});`,
      `for (let i = 0; i < 5; i++) log.tally("dbg LRU-evicted", "S" + i);`,
      "log.flushTallies();",
    ].join("\n");
    const run = (level) => spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, HUB_LOG_LEVEL: level },
      encoding: "utf8",
    }).stdout.split("\n").filter(Boolean);

    const debug = run("DEBUG");
    assert.equal(debug.filter((l) => l.includes("[DEBUG] dbg LRU-evicted S")).length, 5);
    assert.equal(debug.filter((l) => l.includes("[INFO] dbg LRU-evicted x5")).length, 1);

    assert.deepEqual(run("INFO").map((l) => l.replace(/^\S+ /, "")), [
      "[INFO] dbg LRU-evicted x5 in 60s window (last S4)",
    ]);
  });
});

describe("feed LRU eviction bursts log a bounded number of INFO lines", () => {
  afterEach(() => { captureStdout(() => log.flushTallies()); });

  it("ExtFeed.demand (yahoo fallback + webull legs): 1,000 symbols → 2 INFO lines", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 10, 2, 15) });
    const savedDisable = process.env.EXT_FEED_DISABLE;
    const savedWebull = process.env.WEBULL_DISABLE;
    delete process.env.EXT_FEED_DISABLE;
    delete process.env.WEBULL_DISABLE;
    let feed;
    try {
      feed = new ExtFeed({ alpacaKey: "", alpacaSecret: "" });
    } finally {
      if (savedDisable !== undefined) process.env.EXT_FEED_DISABLE = savedDisable;
      if (savedWebull !== undefined) process.env.WEBULL_DISABLE = savedWebull;
    }
    assert.equal(feed.mode, "yahoo_fallback");

    const during = captureStdout(() => {
      for (let i = 0; i < 1_000; i++) feed.demand(`SYM${i}`);
    });
    assert.deepEqual(evictionLines(during), []);

    // Eviction itself is unchanged: both legs keep exactly their cap, newest symbols last.
    assert.equal(feed._yahooSubs.size, 30);
    assert.equal(feed.webull.subs.size, WEBULL_LRU_CAP);
    assert.equal([...feed.webull.subs.keys()].at(-1), "SYM999");
    assert.equal(feed._yahooSubs.has("SYM969"), false);
    assert.equal(feed._yahooSubs.has("SYM970"), true);

    const closed = evictionLines(captureStdout(() => t.mock.timers.tick(WINDOW)));
    assert.deepEqual(closed.map((l) => l.replace(/^\S+ /, "")).sort(), [
      "[INFO] webull subscription LRU-evicted x970 in 60s window (last SYM969)",
      "[INFO] yahoo ext subscription LRU-evicted x970 in 60s window (last SYM969)",
    ]);
    feed.stop();
  });

  it("ExtFeed.demand in alpaca mode: alpaca + yahoo fallback legs tally separately", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 10, 2, 15) });
    const feed = new ExtFeed({ alpacaKey: "fake-key", alpacaSecret: "fake-secret" });
    assert.equal(feed.mode, "alpaca");
    const lines = captureStdout(() => {
      for (let i = 0; i < 500; i++) feed.demand(`SYM${i}`);
      t.mock.timers.tick(WINDOW);
    });
    assert.equal(feed.alpaca.subs.size, 30);
    const names = evictionLines(lines).map((l) => l.match(/\[INFO\] (.+?) x\d+/)[1]).sort();
    assert.deepEqual(names, [
      "alpaca LRU-evicted",
      "webull subscription LRU-evicted",
      "yahoo fallback subscription LRU-evicted",
    ]);
    feed.stop();
  });

  it("WebullFeed.demand: re-demanding a cached symbol does not count as an eviction", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const wb = new WebullFeed({ fetchJson: async () => ({}) });
    const lines = captureStdout(() => {
      for (let i = 0; i < WEBULL_LRU_CAP; i++) wb.demand(`W${i}`);
      for (let i = 0; i < 100; i++) wb.demand(`W${i % WEBULL_LRU_CAP}`);
      t.mock.timers.tick(WINDOW);
    });
    assert.deepEqual(evictionLines(lines), []);
  });

  it("MacroFeed.demand: a burst past its cap still drops the evicted caches, with one INFO line", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const feed = new MacroFeed();
    feed._sinaCache.set("M0", { price: 1 });
    feed._yahooCache.set("M0", { price: 1 });
    const lines = captureStdout(() => {
      for (let i = 0; i < 1_000; i++) feed.demand(`M${i}`);
      t.mock.timers.tick(WINDOW);
    });
    assert.equal(feed._sinaCache.has("M0"), false);
    assert.equal(feed._yahooCache.has("M0"), false);
    const ev = evictionLines(lines);
    assert.equal(ev.length, 1);
    assert.match(ev[0], /macro LRU-evicted x\d+ in 60s window/);
  });

  it("Polygon.ensureSubscribed: still unsubscribes every evicted symbol, with one INFO line", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const marked = new Map();
    const store = {
      setQuote: () => {}, quotes: new Map(),
      markSubscribed: (sym, on) => marked.set(sym, on),
      manifest: { lastBySym: new Map() },
    };
    const polygon = new Polygon(store, "test-key", null);
    const frames = [];
    polygon._send = (frame) => frames.push(frame);
    const lines = captureStdout(() => {
      for (let i = 0; i < 2_000; i++) polygon.ensureSubscribed(`P${i}`);
      t.mock.timers.tick(WINDOW);
    });
    const unsubscribed = frames.filter((f) => f.action === "unsubscribe").length;
    assert.equal(unsubscribed, 2_000 - polygon.subs.size);
    assert.equal(marked.get("P0"), false);
    const ev = evictionLines(lines);
    assert.equal(ev.length, 1);
    assert.match(ev[0], new RegExp(`polygon LRU-evicted x${unsubscribed} in 60s window \\(last P${unsubscribed - 1}\\)$`));
    polygon.stop();
  });
});
