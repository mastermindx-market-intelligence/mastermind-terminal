"use strict";
// lib/snapshot.js — Polygon REST snapshot leg: today's session for symbols the
// streaming aggregate feed is not currently carrying.
//
// WHY THIS EXISTS (operator-reported 2026-08-07, SKY/Champion Homes):
//   The hub's only source of a current price was the Polygon aggregate WebSocket, and
//   subscriptions are idle-swept after 30 minutes (polygon.js) with the quote pruned
//   after 45 (store.js). Outside the flagship 37 — which fast_flagship re-demands every
//   5 minutes — that is the NORMAL state. With no live entry, polygon.js seeds a
//   placeholder from `manifest.last`, and the manifest is a NIGHTLY artifact: it carries
//   the PREVIOUS session's close all day. So a symbol you open after the close (or come
//   back to after 30 minutes) showed yesterday's close as if it were the quote —
//   SKY read 91.52 (2026-08-06) while the tape had closed at 94.66.
//
//   The same hole is what produced the flat "0.00%" during RTH: the placeholder's `last`
//   IS the daily file's last bar close, which is exactly what the AnchorCache resolves as
//   `prevClose`, so `(last - prevClose)` is a structural zero (see store.getQuotes).
//
//   Polygon's snapshot endpoint carries today's session on the plan we already hold:
//     day{o,h,l,c,v} + prevDay{c} + updated(ns)
//   which is the missing leg. `/v2/aggs/ticker/<SYM>/prev` can NOT serve this — it is
//   anchored to the previous session by definition and returns yesterday's bar.
//
// CONTRACT
//   demand(sym)      — queue a refresh (fire-and-forget, batched). Safe to call per request.
//   get(sym, nowMs)  — SYNCHRONOUS read of today's session; null when unusable.
//   getCompleted(sym, nowMs, expectedClose)
//                    — prior-session pair, only when its close matches the independently
//                      resolved latest completed close. Never presents it as today's data.
//   stats()          — /health block.
//
// SAFETY
//   - No API key, or HUB_DISABLE_SNAPSHOT=1 → every method is an inert no-op and the
//     hub behaves exactly as it did before this file existed.
//   - `0 = MISSING` for an equity price (repo law): a zeroed `day` block — what Polygon
//     serves pre-open — is rejected, never published as a $0 print.
//   - A snapshot is only served for the CURRENT ET session date, derived from `updated`.
//     Yesterday's snapshot is never allowed to masquerade as today's.

const https = require("node:https");
const log = require("./log");
const { etDate, classifySession } = require("./usSession");

// ── REAL-TIME TIER (2026-08-08, Massive "Stocks Advanced") ───────────────────────────────────
// The plan now entitles real-time US STOCKS over REST. This file gains a faster poll and a
// last-trade parse, but the important part is what it does NOT do: it never LABELS the output
// real-time from configuration. `HUB_REALTIME_QUOTES=1` only enables the leg; the basis stamped
// on a quote comes from `verdict()`, which measures print age against the wall clock.
//
// HOW THE VERDICT IS MEASURED. Per-symbol age is the wrong discriminator: an illiquid name can
// legitimately go ten minutes without a print during premarket on a genuinely real-time feed, and
// labelling that "delayed" would be a lie in the other direction. Freshness is a property of the
// FEED, so we measure the FLOOR — the youngest print seen across every symbol snapshotted in the
// last FLOOR_WINDOW_MS. A 15-minute-delayed feed cannot produce a print younger than 15 minutes
// for ANY symbol, so the floor separates the two regimes with a wide margin and is immune to a
// quiet ticker. Evaluated only inside a live US session; outside one every print is honestly old
// and no freshness claim is made at all.
const REALTIME_MAX_LAG_MS = 2 * 60 * 1000;      // floor at/below this ⇒ real-time
const DELAYED_MAX_LAG_MS = 20 * 60 * 1000;      // …else at/below this ⇒ the familiar 15-min delay
const FLOOR_WINDOW_MS = 5 * 60 * 1000;          // rolling window the floor is measured over
// PER-NAME adoption bound — a different question from the floor above, and the one the BADGE
// answers. `verdict()` grades the FEED; a badge is per SYMBOL. Measured on this branch: a floor
// of 3s set by one liquid sibling let a quiet name whose own last print was 5h55m old publish
// `basis:"REALTIME", live:true` — a green "Live" chip on a six-hour-old price, with the true age
// reachable only on hover. A print older than the delayed plan's own lag is indistinguishable
// from what that plan would have served, so it cannot be adopted as real-time however fresh its
// siblings are. Deliberately generous (15m, not the 2m floor threshold) so an ordinarily quiet
// name on a genuinely real-time feed still reads live — the failure this bounds is the six-hour
// one, not the six-minute one.
const NAME_REALTIME_MAX_LAG_MS = 15 * 60 * 1000;

// Per-symbol refresh interval. The delayed plan is 15 minutes behind, so polling faster
// buys nothing; 60s keeps a watchlist current without hammering the API.
const TTL_MS = 60 * 1000;
// Real-time refresh interval. The brief's sanctioned band for an active symbol is 5–15s; 8s
// sits inside it and keeps a 40-name watchlist at ONE batched upstream call per interval.
const REALTIME_TTL_MS = 8 * 1000;
// Hard ceiling on serving a cached snapshot. If the REST leg dies, stop serving its data
// rather than pinning a stale session on every quote.
const MAX_AGE_MS = 30 * 60 * 1000;
// Polygon accepts a comma-separated ticker list; keep URLs well inside any length limit.
const CHUNK = 50;
// Coalescing window: one request cycle serves every symbol demanded by a single
// /quotes call (a 40-symbol watchlist becomes ONE upstream request, not 40).
const FLUSH_DELAY_MS = 120;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Bound timestamps before Intl/Date conversion: a finite Number can still be outside
// Date's representable range and must not abort the remaining symbols in a batch.
function isValidClockMs(ms) {
  return Number.isFinite(ms) && ms > 0 && Number.isFinite(new Date(ms).getTime());
}

// A refresh dates a snapshot, not a market event. This is shared by the feed's
// measurement and the Store's per-name adoption/age, so neither can promote updated.
// Check the actual ET date as well as the parsed labels; future clocks never earn zero lag.
function marketClock(snap, nowMs) {
  if (!snap || (snap.printFrom !== "lastTrade" && snap.printFrom !== "min") ||
      !isValidClockMs(nowMs) || !isValidClockMs(snap.printMs) || snap.printMs > nowMs) {
    return null;
  }
  const date = etDate(snap.printMs);
  if (date !== etDate(nowMs) || snap.printDate !== date || snap.date !== date) return null;
  return { asOfMs: snap.printMs, lagMs: nowMs - snap.printMs };
}

class SnapshotFeed {
  /**
   * @param {object} opts
   * @param {string} [opts.apiKey]
   * @param {boolean} [opts.disabled]
   * @param {number}  [opts.ttlMs]
   * @param {typeof httpGetJson} [opts.fetchJson] — injectable transport (tests)
   */
  constructor({ apiKey, disabled, ttlMs, fetchJson, realtime } = {}) {
    this.apiKey = apiKey || "";
    this.disabled = !!disabled || !this.apiKey;
    this.realtime = !!realtime;
    this.ttlMs = ttlMs != null ? ttlMs : this.realtime ? REALTIME_TTL_MS : TTL_MS;
    this._fetchJson = fetchJson || httpGetJson;
    // Rolling freshness floor: [measuredAtMs, lagMs] of the youngest print seen recently.
    this._floorLagMs = null;
    this._floorAt = 0;

    /** @type {Map<string, {snap: object|null, ts: number}>} */
    this._cache = new Map();
    /** @type {Set<string>} */
    this._pending = new Set();
    this._timer = null;
    this._inflight = 0;
    this._errors = 0;
    this._lastOkAt = null;

    if (this.disabled) {
      log.info("snapshot feed disabled", apiKey ? "(HUB_DISABLE_SNAPSHOT)" : "(no API key)");
    }
  }

  /** Queue `sym` for refresh when its cached snapshot is missing or past its TTL. */
  demand(sym, nowMs) {
    if (this.disabled || !sym) return;
    const now = nowMs != null ? nowMs : Date.now();
    if (!isValidClockMs(now)) return;
    const hit = this._cache.get(sym);
    if (hit && now - hit.ts < this.ttlMs) return;
    this._pending.add(sym);
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush().catch(() => {});
    }, FLUSH_DELAY_MS);
    if (this._timer.unref) this._timer.unref();
  }

  /**
   * Today's regular session for `sym`, or null.
   *
   * Null (→ caller keeps whatever it had) whenever the snapshot is absent, older than
   * MAX_AGE_MS, zeroed, or stamped with an ET date other than today's.
   *
   * @returns {{date:string, open:number|null, high:number|null, low:number|null,
   *            close:number, vol:number|null, prevClose:number|null, chg:number|null,
   *            ts:number}|null}
   */
  get(sym, nowMs) {
    if (this.disabled) return null;
    const hit = this._cache.get(sym);
    if (!hit || !hit.snap) return null;
    const now = nowMs != null ? nowMs : Date.now();
    if (!isValidClockMs(now) || now - hit.ts > MAX_AGE_MS) return null;
    // A snapshot from a previous session must never be served as the current one.
    if (hit.snap.date !== etDate(now)) return null;
    // Age is MEASURED at read time, not baked at fetch time — a cached snapshot served 8s later
    // is 8s older, and the label has to say so.
    const clock = marketClock(hit.snap, now);
    return { ...hit.snap, lagMs: clock ? clock.lagMs : null };
  }

  /**
   * Latest completed regular-session pair, corroborated against an independent close.
   *
   * Polygon keeps the prior session in `day` just after the ET date rolls (and over
   * weekends/holidays). That row is not today's session, so get() must continue to reject
   * it. It is still the best source for the PRIOR session's `prevDay.c`, though, when the
   * daily history has a bad bar. Requiring `day.c === expectedClose` proves both sources
   * refer to the same completed session before exposing the pair to Store.
   */
  getCompleted(sym, nowMs, expectedClose) {
    if (this.disabled) return null;
    const hit = this._cache.get(sym);
    if (!hit || !hit.snap) return null;
    const now = nowMs != null ? nowMs : Date.now();
    if (!isValidClockMs(now) || now - hit.ts > MAX_AGE_MS) return null;
    if (hit.snap.date === etDate(now)) return null;
    if (!Number.isFinite(expectedClose) || expectedClose <= 0) return null;
    const tolerance = Math.max(0.0001, Math.abs(expectedClose) * 1e-8);
    if (Math.abs(hit.snap.close - expectedClose) > tolerance) return null;
    const clock = marketClock(hit.snap, now);
    return { ...hit.snap, lagMs: clock ? clock.lagMs : null };
  }

  /**
   * The measured freshness verdict for the FEED (see the header for why it is not per-symbol).
   *
   * @returns {{tier:"realtime"|"delayed"|"unknown"|"closed"|"off", floorLagMs:number|null,
   *            measuredAt:string|null, session:string|null}}
   */
  verdict(nowMs) {
    const now = nowMs != null ? nowMs : Date.now();
    const validNow = isValidClockMs(now);
    const session = validNow ? classifySession(now) : null;
    if (this.disabled || !this.realtime) {
      return { tier: "off", floorLagMs: null, measuredAt: null, session };
    }
    if (!validNow) {
      return { tier: "unknown", floorLagMs: null, measuredAt: null, session };
    }
    // Outside a live session the tape is not printing, so an old print proves nothing about the
    // feed. Refusing to grade here is what stops a weekend from reading as "delayed".
    if (session === "overnight") {
      return { tier: "closed", floorLagMs: null, measuredAt: null, session };
    }
    const fresh = isValidClockMs(this._floorAt) && this._floorAt <= now &&
      now - this._floorAt <= FLOOR_WINDOW_MS;
    if (!fresh || !Number.isFinite(this._floorLagMs) || this._floorLagMs < 0) {
      return { tier: "unknown", floorLagMs: null, measuredAt: null, session };
    }
    const tier =
      this._floorLagMs <= REALTIME_MAX_LAG_MS ? "realtime"
        : this._floorLagMs <= DELAYED_MAX_LAG_MS ? "delayed"
          : "unknown";
    return {
      tier,
      floorLagMs: this._floorLagMs,
      measuredAt: new Date(this._floorAt).toISOString(),
      session,
    };
  }

  stats(nowMs) {
    return {
      disabled: this.disabled,
      realtime: this.realtime,
      ttlMs: this.ttlMs,
      cacheSize: this._cache.size,
      pending: this._pending.size,
      inflight: this._inflight,
      errors: this._errors,
      lastOkAt: this._lastOkAt ? new Date(this._lastOkAt).toISOString() : null,
      verdict: this.verdict(nowMs),
    };
  }

  // ── internal ──

  // nowMs is injectable so a test can grade the freshness rule against a fixed clock instead of
  // against whatever the wall clock says while the suite runs — otherwise the real-time
  // assertions silently become "closed" every weekend and stop testing anything.
  async _flush(nowMs) {
    if (this.disabled || this._pending.size === 0) return;
    if (nowMs != null && !isValidClockMs(nowMs)) return;
    const syms = [...this._pending];
    this._pending.clear();

    // The floor spans the WHOLE flush, not one response. It is documented as "the youngest print
    // across every symbol snapshotted", and a per-chunk write made the LAST chunk win instead:
    // a trailing chunk of quiet names could demote a genuinely real-time feed for a cycle and
    // flap basis/live/source across every symbol. Accumulated here, committed once below.
    let floor = null;
    let floorAt = 0;

    for (let i = 0; i < syms.length; i += CHUNK) {
      const chunk = syms.slice(i, i + CHUNK);
      this._inflight++;
      try {
        const url =
          "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers" +
          `?tickers=${chunk.map(encodeURIComponent).join(",")}&apiKey=${this.apiKey}`;
        const body = await this._fetchJson(url);
        const rows = (body && body.tickers) || [];
        const now = nowMs != null ? nowMs : Date.now();
        if (!isValidClockMs(now)) continue;
        const seen = new Set();
        for (const row of rows) {
          const sym = row && row.ticker;
          if (!sym) continue;
          seen.add(sym);
          const snap = parseSnapshot(row);
          this._cache.set(sym, { snap, ts: now });
          const clock = marketClock(snap, now);
          if (clock && (floor == null || clock.lagMs < floor)) {
            floor = clock.lagMs;
            floorAt = now;
          }
        }
        // Cache the MISS too, so an unknown/unsupported ticker is not re-requested on
        // every 6s poll. get() returns null for a null snap exactly as for an absent one.
        for (const sym of chunk) {
          if (!seen.has(sym)) this._cache.set(sym, { snap: null, ts: now });
        }
        this._lastOkAt = now;
      } catch (e) {
        this._errors++;
        log.warn("snapshot fetch failed", chunk.length, "syms", (e && e.message) || e);
      } finally {
        this._inflight--;
      }
    }
    // Committed once, after every chunk has answered, so the published floor is the minimum
    // across the whole flush. A chunk that threw simply contributes nothing to it.
    if (floor != null) { this._floorLagMs = floor; this._floorAt = floorAt; }
  }
}

/**
 * Polygon snapshot row → our shape, or null when the row cannot be trusted.
 * Exported for unit tests; pure.
 */
function parseSnapshot(row) {
  if (!row || typeof row !== "object") return null;
  const day = row.day || {};
  const prev = row.prevDay || {};

  const close = num(day.c);
  // `0 = MISSING` for an equity price — Polygon zeroes the `day` block before the open.
  if (close == null || close <= 0) return null;

  // `updated` is nanoseconds since epoch. It is the only field that dates the snapshot,
  // and dating it is what stops yesterday's block being served as today's session.
  const updatedNs = num(row.updated);
  if (updatedNs == null || updatedNs <= 0) return null;
  const updatedMs = updatedNs / 1e6;
  if (!isValidClockMs(updatedMs)) return null;

  const prevClose = num(prev.c);
  // ONE chg formula, matching store.setQuote — never Polygon's todaysChangePerc, so the
  // percentage can't drift from the one every other lane computes.
  const chg =
    prevClose != null && prevClose !== 0 ? ((close - prevClose) / prevClose) * 100 : null;

  const open = num(day.o);
  const high = num(day.h);
  const low = num(day.l);
  const vol = num(day.v);

  // ── The freshest datable print on the row ──
  // `lastTrade.t` is NANOseconds; the `min` block's `t` is MILLIseconds. Getting those two units
  // the wrong way round would report a print 10^6 times too old or too new — i.e. it would drive
  // the freshness verdict straight to a confident wrong answer, so each is converted at its own
  // source and never through a shared helper.
  const lt = row.lastTrade || null;
  const ltPrice = lt ? num(lt.p) : null;
  const ltNs = lt ? num(lt.t) : null;
  const ltMs = ltNs != null && isValidClockMs(ltNs / 1e6) ? ltNs / 1e6 : null;

  const min = row.min || null;
  const minClose = min ? num(min.c) : null;
  const minMsRaw = min ? num(min.t) : null;
  const minMs = isValidClockMs(minMsRaw) ? minMsRaw : null;

  // Prefer the trade print, then the minute bar. The row's updated timestamp still
  // dates an otherwise usable day-price fallback, but supplies no print instant.
  let printMs = null, printPrice = null, printFrom = null;
  if (ltMs != null && ltPrice != null && ltPrice > 0) {
    printMs = ltMs; printPrice = ltPrice; printFrom = "lastTrade";
  } else if (minMs != null && minClose != null && minClose > 0) {
    printMs = minMs; printPrice = minClose; printFrom = "min";
  } else {
    printPrice = close; printFrom = "updated";
  }

  return {
    date: etDate(updatedMs),
    open: open != null && open > 0 ? open : null,
    high: high != null && high > 0 ? high : null,
    low: low != null && low > 0 ? low : null,
    close,
    vol,
    prevClose: prevClose != null && prevClose > 0 ? prevClose : null,
    chg,
    ts: Math.floor(updatedMs / 1000),
    // Real-time tier fields. Always parsed (cheap, and it makes the delayed plan's own lag
    // measurable too); only CONSUMED when the feed is in real-time mode.
    printMs,
    printPrice,
    printFrom,
    printDate: printMs != null ? etDate(printMs) : null,
  };
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("snapshot timeout")); });
  });
}

module.exports = {
  SnapshotFeed, parseSnapshot, marketClock, isValidClockMs,
  TTL_MS, REALTIME_TTL_MS, MAX_AGE_MS,
  REALTIME_MAX_LAG_MS, DELAYED_MAX_LAG_MS, FLOOR_WINDOW_MS,
  NAME_REALTIME_MAX_LAG_MS,
};
