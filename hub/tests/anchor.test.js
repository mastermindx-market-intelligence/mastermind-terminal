"use strict";
// Unit tests for lib/anchor.js — session-date rolling and resolution order.
// Run with: node --test tests/anchor.test.js   (Node ≥ 18 built-in test runner)
// Or via:   npm test  (from hub/ directory)

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AnchorCache, etDate, isRTH } = require("../lib/anchor");

// ── Helpers ──

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hub-anchor-test-"));
}

/** Write a minimal per-symbol daily file with the given bars. */
function writeDailyFile(dir, sym, bars) {
  const data = { bars };
  fs.writeFileSync(path.join(dir, `${sym}.json`), JSON.stringify(data), "utf8");
}

/** Build a bar array [date, open, high, low, close, vol]. */
function bar(date, close, open = close * 0.99) {
  return [date, open, close * 1.01, open * 0.99, close, 1_000_000];
}

// ── etDate helper ──

describe("etDate", () => {
  it("formats a UTC timestamp into ET YYYY-MM-DD", () => {
    // 2026-07-09 14:00 UTC = 10:00 ET (EDT = UTC-4) → 2026-07-09
    const ms = Date.UTC(2026, 6, 9, 14, 0, 0);
    assert.equal(etDate(ms), "2026-07-09");
  });

  it("handles midnight UTC boundary (00:00 UTC = 20:00 ET previous day)", () => {
    // 2026-07-10 00:00 UTC = 2026-07-09 20:00 ET
    const ms = Date.UTC(2026, 6, 10, 0, 0, 0);
    assert.equal(etDate(ms), "2026-07-09");
  });
});

// ── isRTH helper ──

describe("isRTH", () => {
  it("returns true at 10:00 ET", () => {
    // 2026-07-09 14:00 UTC = 10:00 ET
    assert.equal(isRTH(Date.UTC(2026, 6, 9, 14, 0)), true);
  });
  it("returns false at 17:00 ET (after close)", () => {
    // 2026-07-09 21:00 UTC = 17:00 ET
    assert.equal(isRTH(Date.UTC(2026, 6, 9, 21, 0)), false);
  });
  it("returns false at 09:00 ET (pre-market)", () => {
    // 2026-07-09 13:00 UTC = 09:00 ET
    assert.equal(isRTH(Date.UTC(2026, 6, 9, 13, 0)), false);
  });
});

// ── AnchorCache.get / resolve — session-date rolling ──

describe("AnchorCache session-date rolling", () => {
  let tmpDir;
  let cache;
  // "yesterday" and "today" in ET
  const YESTERDAY = "2026-07-08";
  const TODAY = "2026-07-09";
  // A timestamp that is 14:00 UTC on 2026-07-09 → 10:00 ET (RTH, TODAY)
  const NOW_RTH = Date.UTC(2026, 6, 9, 14, 0);
  // A timestamp that is 14:00 UTC on 2026-07-10 → 10:00 ET on 2026-07-10 (next session)
  const NOW_NEXT_SESSION = Date.UTC(2026, 6, 10, 14, 0);

  before(() => {
    tmpDir = makeTmpDir();
    // Write NVDA daily file: last bar is YESTERDAY (daily not yet rolled for TODAY)
    writeDailyFile(tmpDir, "NVDA", [
      bar("2026-07-07", 196.93),
      bar(YESTERDAY, 204.12),
    ]);
    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "", // no REST fallback in tests
      getManifest: () => ({
        prevCloseBySym: new Map([["NVDA", 195.0]]), // stale manifest value
      }),
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cache miss on fresh key", () => {
    assert.equal(cache.get("NVDA", NOW_RTH), null);
  });

  it("resolves prevClose from daily file (yesterday's close)", async () => {
    const anchor = await cache.resolve("NVDA", NOW_RTH);
    assert.equal(anchor.anchor_source, "daily_file");
    // prevClose should be YESTERDAY's close = 204.12, NOT the manifest's 195.0
    assert.equal(anchor.prevClose, 204.12);
    assert.equal(anchor.stale_anchor, undefined);
  });

  it("cache hit on second call (same session)", () => {
    const hit = cache.get("NVDA", NOW_RTH);
    assert.notEqual(hit, null);
    assert.equal(hit.prevClose, 204.12);
  });

  it("cache MISS on new session date (key rolls)", () => {
    // Simulate process still running next day
    const hit = cache.get("NVDA", NOW_NEXT_SESSION);
    assert.equal(hit, null, "should be a cache miss after session-date change");
  });

  it("resolves fresh anchor for new session", async () => {
    // Write a new daily file where TODAY is the last bar (daily rolled)
    writeDailyFile(tmpDir, "NVDA", [
      bar(YESTERDAY, 204.12),
      bar("2026-07-09", 202.78),
    ]);
    const anchor = await cache.resolve("NVDA", NOW_NEXT_SESSION);
    assert.equal(anchor.anchor_source, "daily_file");
    // For next session (2026-07-10), prevClose = close of 2026-07-09 bar
    // The file has last bar = 2026-07-09, prev bar = YESTERDAY
    // Since last.date (2026-07-09) < sessionDate (2026-07-10), prevClose = last.close
    assert.equal(anchor.prevClose, 202.78);
  });

  it("prune removes stale session keys", () => {
    cache.prune(NOW_NEXT_SESSION); // prune using NEXT_SESSION as "today"
    // The key for TODAY session should be gone (it's yesterday relative to NEXT_SESSION)
    const oldHit = cache.get("NVDA", NOW_RTH);
    assert.equal(oldHit, null, "old session key should be pruned");
    // The key for NEXT_SESSION should still be present
    const newHit = cache.get("NVDA", NOW_NEXT_SESSION);
    assert.notEqual(newHit, null, "current session key should survive prune");
  });
});

// ── AnchorCache — daily file rolled (post-close) ──

describe("AnchorCache daily file rolled for today", () => {
  let tmpDir;
  let cache;
  const SESSION_DATE = "2026-07-09";
  // 21:00 UTC = 17:00 ET — after close
  const NOW_AFTERHOURS = Date.UTC(2026, 6, 9, 21, 0);

  before(() => {
    tmpDir = makeTmpDir();
    // File has today's bar (daily rolled post-close)
    writeDailyFile(tmpDir, "NVDA", [
      bar("2026-07-08", 204.12),
      bar(SESSION_DATE, 202.78),
    ]);
    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => ({ prevCloseBySym: new Map() }),
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prevClose = yesterday's close (second-to-last bar) when today's bar is present", async () => {
    const anchor = await cache.resolve("NVDA", NOW_AFTERHOURS);
    assert.equal(anchor.anchor_source, "daily_file");
    assert.equal(anchor.prevClose, 204.12, "prevClose should be yesterday's close");
    assert.equal(anchor.close, 202.78, "close should be today's official close");
  });
});

// ── AnchorCache — same-session daily-file roll (MSFT 2026-08-03 regression) ──

describe("AnchorCache refreshes when the daily file rolls inside one ET session", () => {
  const { Store } = require("../lib/store");
  const NOW_AFTERHOURS = Date.UTC(2026, 7, 3, 21, 0); // 17:00 ET
  const CLOSE_DAY_BEFORE = 451.10;
  const CLOSE_PREVIOUS = 464.72;
  const CLOSE_TODAY = 487.65;
  const EXT_PRICE = 484.02;
  let tmpDir;

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates regular and AH baselines without waiting for the next session date", async () => {
    tmpDir = makeTmpDir();
    // Hub warmed this anchor during RTH, before today's daily bar existed.
    writeDailyFile(tmpDir, "MSFT", [
      bar("2026-07-30", CLOSE_DAY_BEFORE),
      bar("2026-07-31", CLOSE_PREVIOUS),
    ]);
    const manifestPath = path.join(tmpDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      as_of: "2026-07-31",
      symbols: { MSFT: { last: CLOSE_PREVIOUS, chg: 3.0192861893150087 } },
    }));

    let store;
    const cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => store ? store.manifest : null,
    });
    store = new Store(manifestPath, cache);
    store.loadManifestIfStale(true);
    await cache.resolve("MSFT", NOW_AFTERHOURS);
    // The pre-roll quote is the PLACEHOLDER polygon.js writes when no AM bar has landed:
    // last = manifest.last = the previous session's close. (It used to be an arbitrary
    // 489.13, which is a state production never reaches — _onAM stamps regularSessionDate
    // on every real print, and non-RTH bars go to the ext lane, never to `last`. With a
    // distinct print in `last` the store now trusts it rather than the completed session,
    // so the fixture has to be the placeholder it always claimed to be.)
    store.setQuote("MSFT", { last: CLOSE_PREVIOUS, market: "us" }, NOW_AFTERHOURS);

    const stale = store.getQuotes(["MSFT"], NOW_AFTERHOURS).MSFT;
    const previousSessionMove = (CLOSE_PREVIOUS - CLOSE_DAY_BEFORE) / CLOSE_DAY_BEFORE * 100;
    assert.ok(Math.abs(stale.chg - previousSessionMove) < 0.001,
      "fixture reproduces the stale +3.02% completed-session value");
    assert.equal(stale.close, undefined, "today's close is absent before the file rolls");

    // The EOD writer atomically replaces the file after the cache key already exists.
    writeDailyFile(tmpDir, "MSFT", [
      bar("2026-07-30", CLOSE_DAY_BEFORE),
      bar("2026-07-31", CLOSE_PREVIOUS),
      bar("2026-08-03", CLOSE_TODAY),
    ]);

    let closeRef = null;
    const extFeed = {
      getExt(_sym, _now, reference) {
        closeRef = reference;
        return {
          extPrice: EXT_PRICE,
          extChg: (EXT_PRICE - reference) / reference * 100,
          extTs: Math.floor(NOW_AFTERHOURS / 1000),
          extSession: "post",
        };
      },
    };
    const corrected = store.getQuotes(
      ["MSFT"],
      NOW_AFTERHOURS + 6_000,
      extFeed,
    ).MSFT;

    const expectedRegular = (CLOSE_TODAY - CLOSE_PREVIOUS) / CLOSE_PREVIOUS * 100;
    const expectedExt = (EXT_PRICE - CLOSE_TODAY) / CLOSE_TODAY * 100;
    assert.equal(corrected.prevClose, CLOSE_PREVIOUS);
    assert.equal(corrected.close, CLOSE_TODAY, "same-session file roll supplies today's official close");
    assert.ok(Math.abs(corrected.chg - expectedRegular) < 0.001,
      `regular chg=${corrected.chg} expected≈${expectedRegular}`);
    assert.equal(corrected.prevSessionChg, undefined,
      "stale previous-session move is removed once today's close exists");
    assert.equal(closeRef, CLOSE_TODAY, "AH baseline is today's official close");
    assert.ok(Math.abs(corrected.extChg - expectedExt) < 0.001,
      `AH chg=${corrected.extChg} expected≈${expectedExt}`);
  });
});

// ── AnchorCache — manifest fallback when no daily file ──

describe("AnchorCache manifest fallback", () => {
  let tmpDir;
  let cache;
  const NOW = Date.UTC(2026, 6, 9, 14, 0);

  before(() => {
    tmpDir = makeTmpDir();
    // No daily file written for AAPL
    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => ({
        prevCloseBySym: new Map([["AAPL", 308.0]]),
      }),
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to manifest when daily file is absent", async () => {
    const anchor = await cache.resolve("AAPL", NOW);
    assert.equal(anchor.anchor_source, "manifest");
    assert.equal(anchor.prevClose, 308.0);
    assert.equal(anchor.stale_anchor, true);
  });
});

// ── AnchorCache — NVDA stale-manifest case (the bug scenario) ──

describe("AnchorCache — NVDA bug scenario", () => {
  // Scenario: manifest stuck at 07-07 (last=196.93, chg=0.71).
  // Manifest-derived prevClose = 196.93 / 1.0071 ≈ 195.54 (WRONG: two sessions stale).
  // Daily file has 07-08 close = 204.12.
  // Correct prevClose for the 07-09 session = 204.12.

  let tmpDir;
  let cache;
  const NOW = Date.UTC(2026, 6, 9, 14, 0); // 2026-07-09 10:00 ET

  before(() => {
    tmpDir = makeTmpDir();
    writeDailyFile(tmpDir, "NVDA", [
      bar("2026-07-07", 196.93),
      bar("2026-07-08", 204.12),
    ]);
    const staleManifestPrevClose = 196.93 / (1 + 0.71 / 100); // ≈ 195.54
    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => ({
        prevCloseBySym: new Map([["NVDA", staleManifestPrevClose]]),
      }),
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves 204.12 (not ~195.54) as prevClose for NVDA on 2026-07-09", async () => {
    const anchor = await cache.resolve("NVDA", NOW);
    assert.equal(anchor.anchor_source, "daily_file");
    assert.equal(anchor.prevClose, 204.12);
    // Verify the manifest fallback would have been wrong
    const manifestFallback = 196.93 / (1 + 0.71 / 100);
    assert.notEqual(anchor.prevClose, manifestFallback, "must NOT equal the stale manifest prevClose");
  });
});

// ── Store integration — setQuote uses anchor ──

describe("Store.setQuote uses AnchorCache prevClose", () => {
  const { Store } = require("../lib/store");

  let tmpDir;
  let cache;
  let store;
  const NOW = Date.UTC(2026, 6, 9, 14, 0); // 2026-07-09 10:00 ET

  before(async () => {
    tmpDir = makeTmpDir();
    writeDailyFile(tmpDir, "NVDA", [
      bar("2026-07-07", 196.93),
      bar("2026-07-08", 204.12),
    ]);

    // Write a manifest file (needed by Store constructor)
    const manifestPath = path.join(tmpDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      as_of: "2026-07-07",
      symbols: {
        NVDA: { last: 196.93, chg: 0.71 },
      },
    }));

    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => store ? store.manifest : null,
    });

    store = new Store(manifestPath, cache);
    store.loadManifestIfStale(true);

    // Pre-warm the anchor
    await cache.resolve("NVDA", NOW);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("chg is computed vs 204.12 (daily file), not vs stale manifest-derived prevClose", () => {
    // Simulate AM bar arriving: NVDA last = 202.00
    const q = store.setQuote("NVDA", { last: 202.00, market: "us" }, NOW);
    // Expected chg = (202.00 - 204.12) / 204.12 * 100 ≈ -1.039%
    const expectedChg = (202.00 - 204.12) / 204.12 * 100;
    assert.ok(q.chg != null, "chg must be set");
    assert.ok(Math.abs(q.chg - expectedChg) < 0.001, `chg=${q.chg} expected ≈ ${expectedChg}`);
    assert.equal(q.anchor_source, "daily_file");
    assert.equal(q.prevClose, 204.12);
    // The stale manifest would have given prevClose ≈ 195.54, chg ≈ +3.31% — totally wrong
    const stalePrevClose = 196.93 / (1 + 0.71 / 100);
    const staleChg = (202.00 - stalePrevClose) / stalePrevClose * 100;
    assert.ok(Math.abs(q.chg - staleChg) > 2, "chg must differ materially from the stale-manifest value");
  });
});

// ── Store.getQuotes — serve-time anchor re-derivation (the P1 confirmed bug path) ──
//
// Scenario: hub boots, NVDA quote is seeded with a stale prevClose (anchor cache was
// cold at write time). The daily file is then read and the anchor resolves to 204.12.
// getQuotes MUST correct prevClose/chg on the next read without requiring a new tape
// message. This is the exact path that caused NVDA/AAPL to show +0.00% all day.

describe("Store.getQuotes serve-time anchor re-derivation", () => {
  const { Store } = require("../lib/store");

  let tmpDir;
  let cache;
  let store;
  const SESSION_DATE = "2026-07-09";
  // 14:00 UTC = 10:00 ET — mid-RTH on 2026-07-09
  const NOW = Date.UTC(2026, 6, 9, 14, 0);

  before(async () => {
    tmpDir = makeTmpDir();
    // Daily file: yesterday's bar is last (file hasn't rolled yet — typical RTH state)
    writeDailyFile(tmpDir, "NVDA", [
      bar("2026-07-07", 196.93),
      bar("2026-07-08", 204.12),
    ]);

    const manifestPath = path.join(tmpDir, "manifest.json");
    // Stale manifest: only has data through 2026-07-07, so manifest-derived prevClose
    // is wrong: 196.93 / (1 + 0.71/100) ≈ 195.54 instead of the correct 204.12.
    fs.writeFileSync(manifestPath, JSON.stringify({
      as_of: "2026-07-07",
      symbols: { NVDA: { last: 196.93, chg: 0.71 } },
    }));

    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => store ? store.manifest : null,
    });

    store = new Store(manifestPath, cache);
    store.loadManifestIfStale(true);

    // Boot-time: anchor NOT yet warm → setQuote falls to manifest fallback.
    // This produces the stale prevClose ≈ 195.54, mirroring the P1 confirmed bug
    // where chg ended up 0 because prevClose==last (here it would be wrong positive).
    store.setQuote("NVDA", { last: 202.78, market: "us", chg: null }, NOW);

    // Simulate anchor resolution completing async AFTER the first setQuote.
    await cache.resolve("NVDA", NOW);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getQuotes corrects prevClose/chg without a new tape message", () => {
    const quotes = store.getQuotes(["NVDA"], NOW);
    const q = quotes["NVDA"];
    assert.ok(q, "NVDA must be present");
    // prevClose must now be the daily-file value, not the stale manifest value
    assert.equal(q.prevClose, 204.12, "prevClose must be corrected to daily-file value");
    assert.equal(q.anchor_source, "daily_file");
    // chg = (202.78 - 204.12) / 204.12 * 100 ≈ -0.657% (non-zero)
    const expectedChg = (202.78 - 204.12) / 204.12 * 100;
    assert.ok(q.chg != null, "chg must be non-null");
    assert.ok(Math.abs(q.chg - expectedChg) < 0.001, `chg=${q.chg} expected ≈ ${expectedChg}`);
    // Crucially: chg must NOT be 0 (the P1 bug symptom)
    assert.ok(Math.abs(q.chg) > 0.1, `chg must not be ~0; got ${q.chg}`);
  });

  it("persists the corrected quote so a second getQuotes call is consistent", () => {
    const q1 = store.getQuotes(["NVDA"], NOW)["NVDA"];
    const q2 = store.getQuotes(["NVDA"], NOW)["NVDA"];
    assert.equal(q1.prevClose, q2.prevClose, "prevClose must be stable across consecutive reads");
    assert.equal(q1.chg, q2.chg, "chg must be stable across consecutive reads");
  });
});

// ── Store.getQuotes — daily-file-rolled scenario (post-close, after-hours) ──
//
// Scenario: market has closed, daily file has rolled to include today's bar.
// anchor.close = today's official close; the live AM last differs from close.
// getQuotes must emit close + afterHours and compute chg vs prevClose (not last).

describe("Store.getQuotes after-hours close/afterHours emission", () => {
  const { Store } = require("../lib/store");

  let tmpDir;
  let cache;
  let store;
  // 21:00 UTC = 17:00 ET — post-close on 2026-07-09
  const NOW_AH = Date.UTC(2026, 6, 9, 21, 0);

  before(async () => {
    tmpDir = makeTmpDir();
    // Daily file has today's bar — file rolled post-close
    writeDailyFile(tmpDir, "NVDA", [
      bar("2026-07-08", 204.12),
      bar("2026-07-09", 202.78),
    ]);

    const manifestPath = path.join(tmpDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      as_of: "2026-07-08",
      symbols: { NVDA: { last: 204.12, chg: 3.65 } },
    }));

    cache = new AnchorCache({
      dataDir: tmpDir,
      apiKey: "",
      getManifest: () => store ? store.manifest : null,
    });

    store = new Store(manifestPath, cache);
    store.loadManifestIfStale(true);

    // Warm the anchor
    await cache.resolve("NVDA", NOW_AH);

    // The primary lane carries only the completed regular-session price.
    store.setQuote("NVDA", { last: 202.78, market: "us" }, NOW_AH);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits close=last=202.78 with no legacy afterHours field", () => {
    const q = store.getQuotes(["NVDA"], NOW_AH)["NVDA"];
    assert.ok(q, "NVDA must be present");
    // anchor: prevClose=204.12 (yesterday), close=202.78 (today's official EOD)
    assert.equal(q.prevClose, 204.12, "prevClose = yesterday's close");
    assert.equal(q.close, 202.78, "close = today's official EOD close");
    assert.equal(q.last, 202.78, "last = completed regular-session price");
    assert.equal(q.afterHours, undefined, "extended prints use the separate ext namespace");
    // chg = (close - prevClose) / prevClose * 100 = (202.78 - 204.12) / 204.12 * 100
    const expectedChg = (202.78 - 204.12) / 204.12 * 100;
    assert.ok(Math.abs(q.chg - expectedChg) < 0.001, `chg=${q.chg} expected ≈ ${expectedChg}`);
    assert.equal(q.anchor_source, "daily_file");
  });

  it("afterHours stays absent for every regular quote value", async () => {
    store.setQuote("NVDA", { last: 202.79, market: "us" }, NOW_AH);
    const q = store.getQuotes(["NVDA"], NOW_AH)["NVDA"];
    assert.equal(q.afterHours, undefined, "afterHours must always be absent");
  });
});

// ── prevSessionChg — three-state test suite ──────────────────────────────────
//
// Three states under test:
//
//   STATE A — RTH (regular trading hours, file not yet rolled):
//     Daily file: [2026-07-08 close=204.12, 2026-07-07 close=199.50] (not rolled for today)
//     nowMs = 14:00 UTC on 2026-07-09 (= 10:00 ET, inside RTH)
//     live last = 205.80 (differs materially from prevClose=204.12)
//     Expected: chg = (205.80 − 204.12) / 204.12 × 100 ≈ 0.82%; prevSessionChg absent
//     (RTH has a live print so chg IS the live day move; overnight shortcut not needed)
//
//   STATE B — post-close with daily file rolled (after-hours, live AH print differs):
//     Daily file: [2026-07-08 close=204.12, 2026-07-09 close=202.78] (today rolled)
//     nowMs = 21:00 UTC on 2026-07-09 (= 17:00 ET, post-close)
//     live last = 205.50 (differs from close=202.78 → afterHours emitted)
//     Expected: chg = (202.78 − 204.12) / 204.12 × 100; prevSessionChg absent
//     (today-close present so chg reflects the completed session, not overnight)
//
//   STATE C — overnight (no today-close, last ≈ prevClose within $0.01):
//     Daily file: [2026-07-08 close=204.12, 2026-07-07 close=199.50] (not yet rolled)
//     nowMs = 04:00 UTC on 2026-07-09 (= 00:00 ET, overnight — session is 2026-07-09)
//     live last = 204.12 (= prevClose exactly — typical overnight stub)
//     Expected: chg ≈ 0; prevSessionChg = (204.12 − 199.50) / 199.50 × 100 ≈ 2.31%

describe("prevSessionChg — three-state RTH / post-close / overnight", () => {
  const { AnchorCache } = require("../lib/anchor");
  const { Store } = require("../lib/store");

  // ── shared fixtures ──
  const CLOSE_YESTERDAY  = 204.12;   // 2026-07-08
  const CLOSE_DAY_BEFORE = 199.50;   // 2026-07-07
  const CLOSE_TODAY      = 202.78;   // 2026-07-09 (only present when file is rolled)

  // ET timestamps:
  //   RTH:        2026-07-09 14:00 UTC = 10:00 ET (inside 09:30–16:00)
  //   Post-close: 2026-07-09 21:00 UTC = 17:00 ET
  //   Overnight:  2026-07-09 04:00 UTC = 00:00 ET (session date = 2026-07-09)
  const NOW_RTH        = Date.UTC(2026, 6, 9, 14, 0);
  const NOW_POST_CLOSE = Date.UTC(2026, 6, 9, 21, 0);
  const NOW_OVERNIGHT  = Date.UTC(2026, 6, 9,  4, 0);

  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: build a fresh store + cache for the given bars and nowMs.
  async function makeStore(bars, liveLastPrice, nowMs) {
    const dir = makeTmpDir();
    if (!tmpDir) tmpDir = dir; // track first for cleanup; each test makes its own
    writeDailyFile(dir, "MSFT", bars);
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      as_of: "2026-07-08",
      symbols: { MSFT: { last: CLOSE_YESTERDAY, chg: 0.0 } },
    }));
    let s;
    const cache = new AnchorCache({
      dataDir: dir,
      apiKey: "",
      getManifest: () => s ? s.manifest : null,
    });
    s = new Store(manifestPath, cache);
    s.loadManifestIfStale(true);
    await cache.resolve("MSFT", nowMs);
    s.setQuote("MSFT", { last: liveLastPrice, market: "us" }, nowMs);
    return { store: s, cache, dir };
  }

  it("STATE A — RTH: chg reflects live price; prevSessionChg is absent", async () => {
    // File not rolled for today; live last differs from prevClose.
    const liveLast = 205.80;
    const { store } = await makeStore([
      bar("2026-07-07", CLOSE_DAY_BEFORE),
      bar("2026-07-08", CLOSE_YESTERDAY),
    ], liveLast, NOW_RTH);

    const q = store.getQuotes(["MSFT"], NOW_RTH)["MSFT"];
    assert.ok(q, "MSFT must be present");

    const expectedChg = (liveLast - CLOSE_YESTERDAY) / CLOSE_YESTERDAY * 100;
    assert.ok(Math.abs(q.chg - expectedChg) < 0.001,
      `RTH chg=${q.chg?.toFixed(4)} expected≈${expectedChg.toFixed(4)}`);
    assert.equal(q.prevSessionChg, undefined,
      "prevSessionChg must be absent during RTH (live print present)");
    assert.equal(q.close, undefined, "no today-close during RTH");
  });

  it("STATE B — post-close (file rolled): chg uses official close; prevSessionChg absent", async () => {
    // File has today's bar; the regular lane remains pinned to the official close.
    const { store } = await makeStore([
      bar("2026-07-07", CLOSE_DAY_BEFORE),
      bar("2026-07-08", CLOSE_YESTERDAY),
      bar("2026-07-09", CLOSE_TODAY),
    ], CLOSE_TODAY, NOW_POST_CLOSE);

    const q = store.getQuotes(["MSFT"], NOW_POST_CLOSE)["MSFT"];
    assert.ok(q, "MSFT must be present");

    // chg = (today's official close − yesterday) / yesterday
    const expectedChg = (CLOSE_TODAY - CLOSE_YESTERDAY) / CLOSE_YESTERDAY * 100;
    assert.ok(Math.abs(q.chg - expectedChg) < 0.001,
      `post-close chg=${q.chg?.toFixed(4)} expected≈${expectedChg.toFixed(4)}`);
    assert.equal(q.close, CLOSE_TODAY, "close = official today EOD");
    assert.equal(q.last, CLOSE_TODAY, "last = official today EOD");
    assert.equal(q.afterHours, undefined, "extended prints use the separate ext namespace");
    assert.equal(q.prevSessionChg, undefined,
      "prevSessionChg must be absent post-close (today-close present)");
  });

  it("STATE C — overnight: prevSessionChg = last completed session move", async () => {
    // File not yet rolled for today; live stub = prevClose (typical overnight).
    // prevSessionChg = (yesterday's close − day-before) / day-before
    const overnightLast = CLOSE_YESTERDAY; // = 204.12 exactly (within $0.01 of prevClose)
    const { store } = await makeStore([
      bar("2026-07-07", CLOSE_DAY_BEFORE),
      bar("2026-07-08", CLOSE_YESTERDAY),
    ], overnightLast, NOW_OVERNIGHT);

    const q = store.getQuotes(["MSFT"], NOW_OVERNIGHT)["MSFT"];
    assert.ok(q, "MSFT must be present");

    const expectedPrevSessionChg =
      (CLOSE_YESTERDAY - CLOSE_DAY_BEFORE) / CLOSE_DAY_BEFORE * 100;
    assert.ok(q.prevSessionChg != null,
      "prevSessionChg must be present overnight");
    assert.ok(Math.abs(q.prevSessionChg - expectedPrevSessionChg) < 0.001,
      `prevSessionChg=${q.prevSessionChg?.toFixed(4)} expected≈${expectedPrevSessionChg.toFixed(4)}`);
    assert.equal(q.close, undefined, "no today-close overnight");
    assert.equal(q.afterHours, undefined, "no afterHours overnight");
    assert.ok(Math.abs(q.chg - expectedPrevSessionChg) < 0.001,
      `chg retains the completed-session move overnight; got ${q.chg}`);
  });
});

it("completed reference retains the actual calendar-qualified daily bar identity", () => {
  const dir = makeTmpDir();
  try {
    const cache = new AnchorCache({ dataDir: dir });
    const pre = Date.parse("2026-10-23T12:00:00Z");
    writeDailyFile(dir, "NVDA", [bar("2026-10-21", 90), bar("2026-10-22", 100), bar("2026-10-23", 101)]);
    const before = cache._fromDailyFile("NVDA", "2026-10-23", pre);
    assert.equal(before.completedRegularClose, 100);
    assert.equal(before.completedRegularSessionDate, "2026-10-22");
    assert.equal(before.completedRegularSource, "daily_file");
    const after = cache._fromDailyFile("NVDA", "2026-10-23", Date.parse("2026-10-23T20:00:00Z"));
    assert.equal(after.completedRegularClose, 101);
    assert.equal(after.completedRegularSessionDate, "2026-10-23");
    for (const bars of [
      [bar("2026-10-22", 100), bar("2026-10-21", 90)],
      [bar("2026-10-22", 100), bar("2026-10-26", 102)],
      [bar("bad", 90), bar("2026-10-22", 100)],
      [bar("2026-10-21", 90), bar("2026-10-22", 0)],
    ]) {
      writeDailyFile(dir, "NVDA", bars);
      const result = cache._fromDailyFile("NVDA", "2026-10-23", pre);
      assert.equal(result?.completedRegularClose, undefined);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
