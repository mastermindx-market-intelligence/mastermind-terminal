"use strict";
// lib/macrofeed.js — near-live macro quote feed for the Quote Hub.
//
// PURPOSE
//   Serves futures (=F), caret indices (^GSPC, ^TNX, ^VIX), FX pairs (=X) and the
//   dollar index (DX-Y.NYB) through the same GET /quotes contract as US equities and
//   crypto. Before this module the terminal fetched these itself from Yahoo spark
//   (DELAYED_15M, ~15 min behind); the hub now answers them with a near-live leg.
//
// FEED SELECTION (per symbol, not per process)
//   (a) Sina global-futures snapshot — https://hq.sinajs.cn/list=<codes>, keyless,
//       near-real-time (~seconds behind). ONE batched request per poll for every
//       demanded symbol that has a SINA_MAP code. basis "LIVE", source "sina".
//   (b) Yahoo spark — https://query1.finance.yahoo.com/v7/finance/spark, keyless,
//       15-minute-delayed. Polls EVERY demanded macro symbol, including the Sina-mapped
//       ones: it is the only source for what Sina does not carry (^GSPC, ^TNX, ^VIX, FX
//       pairs, PL=F / PA=F / RTY=F — all verified EMPTY on Sina) AND the standby a
//       Sina-mapped symbol falls back to when the Sina leg goes stale or 4xxs. Polling
//       only the Sina-less set is what made that fallback dead code (fixed 2026-07-27:
//       the cache the freshness branch read could never be populated for a Sina symbol,
//       so an 8-hour-old print was served basis LIVE forever).
//       basis "DELAYED_15M", source "yahoo-spark", live:false.
//
//   A delayed source is NEVER labelled LIVE — and neither is a stale one. getQuote()
//   serves the FRESHER of the two cached entries, and demotes a Sina print older than
//   SINA_STALE_MS to basis DELAYED_15M / live:false. On a weekend everything is stale;
//   serving Friday's settle honestly labelled is right, suppressing it is not.
//
// ARCHITECTURE
//   Demand-driven singleton, mirroring lib/extfeed.js. The hub is a shared process:
//   the 64-symbol LRU budget is GLOBAL across all users, and a /quotes request for
//   symbol X from any user advances X to MRU. Symbols idle for 30 min are dropped.
//   No timers start at require() time — call .start() explicitly.
//
// KILL-SWITCH
//   MACRO_FEED_DISABLE=1 → demand() / getQuote() become no-ops, no polling.

const https = require("node:https");
const log = require("./log");
const { lruTouch } = require("./extfeed");

// ── Symbol map ────────────────────────────────────────────────────────────────

// Yahoo-style symbol → Sina global-futures code. Only symbols listed here are
// eligible for the LIVE leg; everything else macro-classified falls to Yahoo spark.
//
// Verified EMPTY on Sina (hq_str_x=""), so deliberately absent: hf_PL (platinum),
// hf_PA (palladium), hf_RTY (Russell 2000 futures).
const SINA_MAP = {
  "CL=F": "hf_CL",      // WTI crude
  "BZ=F": "hf_OIL",     // Brent crude
  "NG=F": "hf_NG",      // Henry Hub natural gas
  "GC=F": "hf_GC",      // COMEX gold
  "SI=F": "hf_SI",      // COMEX silver
  "HG=F": "hf_HG",      // COMEX copper — see SINA_SCALE below
  "ZC=F": "hf_C",       // CBOT corn
  "ZS=F": "hf_S",       // CBOT soybeans
  "ZW=F": "hf_W",       // CBOT wheat
  "ES=F": "hf_ES",      // E-mini S&P 500
  "NQ=F": "hf_NQ",      // E-mini Nasdaq 100
  "YM=F": "hf_YM",      // E-mini Dow
  "DX-Y.NYB": "DINIW",  // ICE dollar index (different row layout — see parseDiniwRow)
};

// UNIT QUIRK — COMEX copper.
//   Sina quotes hf_HG in US CENTS per pound (e.g. 640.013).
//   Yahoo HG=F — which is what the terminal charted historically and what the nightly
//   per-symbol daily files store — quotes USD per pound (e.g. 6.40013).
//   Serving the raw Sina number would make the live price look 100× the chart. Scale
//   EVERY price field (last / open / high / low / prevClose) by 0.01 for this symbol
//   only. `chg` is scale-invariant, so it is computed after scaling and is unaffected.
const SINA_SCALE = {
  "HG=F": 0.01,
};

/** Reverse index: sina code → our symbol. */
const SINA_CODE_TO_SYM = new Map(Object.entries(SINA_MAP).map(([sym, code]) => [code, sym]));

// ── Tunables ──────────────────────────────────────────────────────────────────

// Global demanded-symbol budget. Must stay ABOVE the catalog's macro count (49 as of
// 2026-07-27) — a cap below it makes the last symbol rotate through eviction forever,
// re-fetching from cold on every request instead of ever holding a cached quote.
const MACRO_LRU_CAP = 64;
const MACRO_IDLE_EXPIRE_MS = 30 * 60 * 1000;    // drop symbols nobody has asked for in 30 min
const SINA_POLL_INTERVAL_MS = 3 * 1000;         // one batched request per 3 s
const YAHOO_POLL_INTERVAL_MS = 15 * 1000;
const YAHOO_CHUNK_MAX = 18;                     // Yahoo 400s above ~20 symbols per spark call
const HTTP_TIMEOUT_MS = 8 * 1000;
// Exponential backoff on consecutive poll failures: interval × 2^min(errors, 5), capped.
// This VPS's IP is already documented as Yahoo-429-prone (see lib/extfeed.js) — re-arming
// a fixed 3 s / 15 s timer into an upstream that is refusing us is how a soft rate-limit
// becomes a hard block. Reset to the base interval on the first success.
const BACKOFF_MAX_SHIFT = 5;
const SINA_MAX_BACKOFF_MS = 60 * 1000;
const YAHOO_MAX_BACKOFF_MS = 300 * 1000;
// A Sina print older than this means the contract is in a session break (or the leg
// is wedged); at that point a fresher delayed Yahoo print is the more honest answer.
const SINA_STALE_MS = 15 * 60 * 1000;

const SINA_URL_BASE = "https://hq.sinajs.cn/list=";
const SINA_HEADERS = {
  // Sina rejects requests without a finance.sina.com.cn referer.
  Referer: "https://finance.sina.com.cn",
  "User-Agent": "Mozilla/5.0",
};
const YAHOO_SPARK_BASE = "https://query1.finance.yahoo.com/v7/finance/spark";
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0" };

// ── Symbol routing ────────────────────────────────────────────────────────────

/**
 * True when the symbol belongs to the macro plane (futures, caret indices, FX,
 * dollar index). Mirrors terminal/lib/macroSymbols.ts so both sides agree on
 * which symbols the hub owns.
 *
 * @param {string} sym
 * @returns {boolean}
 */
function isMacroSymbol(sym) {
  if (!sym || typeof sym !== "string") return false;
  const s = sym.trim();
  if (s === "DX-Y.NYB") return true;
  if (/^\^[A-Z0-9]{1,12}$/i.test(s)) return true;
  if (/=F$/i.test(s)) return true;
  if (/=X$/i.test(s)) return true;
  return false;
}

// ── Small numeric helpers ─────────────────────────────────────────────────────

/** Parse a field to a finite number, or null. Sina/Yahoo both ship numbers as strings. */
function toNum(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** toNum + unit scale (see SINA_SCALE). Returns null when the field is unusable. */
function scaledNum(v, scale) {
  const n = toNum(v);
  return n == null ? null : n * scale;
}

/** Percent change vs a reference close; null when the reference is missing or zero. */
function pctChg(last, ref) {
  if (last == null || ref == null || ref === 0) return null;
  return ((last - ref) / ref) * 100;
}

/**
 * Convert a Beijing (UTC+8, no DST) wall-clock date + time to epoch seconds.
 * Sina stamps every row with its own exchange-side clock; we never substitute
 * our own time when the row carries one.
 *
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {string} timeStr "HH:MM:SS"
 * @returns {number|null} epoch seconds, or null when either field is unparseable
 */
function beijingToEpochSec(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dateStr == null ? "" : dateStr).trim());
  const t = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(timeStr == null ? "" : timeStr).trim());
  if (!d || !t) return null;
  // UTC+8 → subtract 8 from the hour. Date.UTC normalises a negative hour back a day.
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]) - 8, Number(t[2]), Number(t[3]));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Split an array into chunks of at most `size`. */
function chunkSyms(syms, size) {
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < syms.length; i += n) out.push(syms.slice(i, i + n));
  return out;
}

// ── Sina parsing ──────────────────────────────────────────────────────────────

/**
 * Parse an `hf_*` global-futures row.
 *
 * Field layout (0-indexed, verified live 2026-07-27):
 *   [0] last  [2] bid  [3] ask  [4] session high  [5] session low
 *   [6] HH:MM:SS Beijing wall-clock   [7] prior settle   [8] open
 *   [12] YYYY-MM-DD Beijing           [13] Chinese contract name
 *
 * @param {string} sym
 * @param {string} payload  the raw comma-joined row (quotes already stripped)
 * @param {number} nowMs
 * @returns {object|null} hub quote, or null when the row carries no usable print
 */
function parseHfRow(sym, payload, nowMs) {
  const f = payload.split(",");
  if (f.length < 13) return null;

  const scale = SINA_SCALE[sym] || 1;
  const last = scaledNum(f[0], scale);
  // A row with no (or a non-positive) last is a placeholder, not a print.
  if (last == null || last <= 0) return null;

  const prevClose = scaledNum(f[7], scale);
  // Sina stamps its own clock on every row; only fall back to ours when the row's
  // date/time is unparseable — the fetch just happened, so `now` is accurate to the
  // 3 s poll cadence.
  const ts = beijingToEpochSec(f[12], f[6]) ?? Math.floor((nowMs != null ? nowMs : Date.now()) / 1000);

  return {
    sym,
    last,
    chg: pctChg(last, prevClose),
    prevClose,
    open: scaledNum(f[8], scale),
    high: scaledNum(f[4], scale),
    low: scaledNum(f[5], scale),
    vol: null,
    amount: null,
    ts,
    live: true,
    source: "sina",
    market: "macro",
    basis: "LIVE",
  };
}

/**
 * Parse the DINIW (ICE dollar index) row — a DIFFERENT layout from `hf_*`.
 *
 * Field layout (0-indexed, verified live 2026-07-27):
 *   [0] HH:MM:SS Beijing  [1] last  [3] prev close  [5] open  [6] high  [7] low
 *   [9] Chinese name      [10] YYYY-MM-DD Beijing
 *
 * @param {string} sym
 * @param {string} payload
 * @param {number} nowMs
 * @returns {object|null}
 */
function parseDiniwRow(sym, payload, nowMs) {
  const f = payload.split(",");
  if (f.length < 11) return null;

  const last = toNum(f[1]);
  if (last == null || last <= 0) return null;

  const prevClose = toNum(f[3]);
  const ts = beijingToEpochSec(f[10], f[0]) ?? Math.floor((nowMs != null ? nowMs : Date.now()) / 1000);

  return {
    sym,
    last,
    chg: pctChg(last, prevClose),
    prevClose,
    open: toNum(f[5]),
    high: toNum(f[6]),
    low: toNum(f[7]),
    vol: null,
    amount: null,
    ts,
    live: true,
    source: "sina",
    market: "macro",
    basis: "LIVE",
  };
}

/**
 * Parse a full Sina response body into hub quotes.
 *
 * The body is a sequence of `var hq_str_<CODE>="<csv>";` statements. It is GBK-encoded,
 * but every field we read is ASCII — decode latin1 and ignore the mangled Chinese name
 * bytes (same treatment the terminal's Tencent leg already uses).
 *
 * Unknown codes and empty payloads (`hq_str_hf_PL=""` — the contract is not carried)
 * are skipped silently.
 *
 * @param {string} text  latin1-decoded response body
 * @param {number} [nowMs]
 * @returns {object[]} hub quotes
 */
function parseSinaPayload(text, nowMs) {
  const out = [];
  if (!text) return out;
  const re = /var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const code = m[1];
    const payload = m[2];
    const sym = SINA_CODE_TO_SYM.get(code);
    if (!sym) continue;      // code we never asked for
    if (!payload) continue;  // empty string → Sina does not carry this contract
    const q = code === "DINIW" ? parseDiniwRow(sym, payload, nowMs) : parseHfRow(sym, payload, nowMs);
    if (q) out.push(q);
  }
  return out;
}

// ── Yahoo spark parsing ───────────────────────────────────────────────────────

/** Last finite entry of a close series, or null. */
function lastFinite(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const n = toNum(arr[i]);
    if (n != null) return n;
  }
  return null;
}

/**
 * Parse a Yahoo v7 spark response into hub quotes.
 *
 * Yahoo has shipped two envelopes for this endpoint over time; both are handled:
 *   (a) { spark: { result: [ { symbol, response: [ { meta, timestamp, indicators } ] } ] } }
 *   (b) { "<SYM>": { symbol, close: [...], timestamp: [...], previousClose, chartPreviousClose } }
 *
 * @param {object} json
 * @param {number} [nowMs]
 * @returns {object[]} hub quotes, basis DELAYED_15M
 */
function parseYahooSpark(json, nowMs) {
  const out = [];
  if (!json || typeof json !== "object") return out;

  /** @type {{symbol:string, meta:object, timestamp:number[], closes:number[]}[]} */
  const rows = [];
  const envelope = json.spark && Array.isArray(json.spark.result) ? json.spark.result : null;

  if (envelope) {
    for (const r of envelope) {
      const resp = r && Array.isArray(r.response) ? r.response[0] : null;
      if (!resp) continue;
      const meta = resp.meta || {};
      const q =
        resp.indicators && Array.isArray(resp.indicators.quote) ? resp.indicators.quote[0] : null;
      rows.push({
        symbol: r.symbol || meta.symbol || "",
        meta,
        timestamp: Array.isArray(resp.timestamp) ? resp.timestamp : [],
        closes: q && Array.isArray(q.close) ? q.close : [],
      });
    }
  } else {
    for (const key of Object.keys(json)) {
      const r = json[key];
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      rows.push({
        symbol: r.symbol || key,
        meta: r,
        timestamp: Array.isArray(r.timestamp) ? r.timestamp : [],
        closes: Array.isArray(r.close) ? r.close : [],
      });
    }
  }

  for (const row of rows) {
    const sym = row.symbol;
    if (!sym) continue;
    const meta = row.meta || {};
    const last = toNum(meta.regularMarketPrice) ?? lastFinite(row.closes);
    if (last == null) continue;
    const prevClose = toNum(meta.previousClose) ?? toNum(meta.chartPreviousClose);
    const ts =
      toNum(meta.regularMarketTime) ??
      lastFinite(row.timestamp) ??
      Math.floor((nowMs != null ? nowMs : Date.now()) / 1000);

    out.push({
      sym,
      last,
      chg: pctChg(last, prevClose),
      prevClose,
      open: toNum(meta.regularMarketOpen),
      high: toNum(meta.regularMarketDayHigh),
      low: toNum(meta.regularMarketDayLow),
      vol: null,
      amount: null,
      ts,
      live: false,
      source: "yahoo-spark",
      market: "macro",
      basis: "DELAYED_15M",
    });
  }

  return out;
}

// ── HTTP transports (overridable for offline tests) ───────────────────────────

/**
 * GET a URL and resolve the raw response buffer. Rejects on transport error,
 * timeout, or non-2xx status so the caller can count consecutive failures.
 */
function httpGetBuffer(url, headers) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = https.get(url, { timeout: HTTP_TIMEOUT_MS, headers }, (res) => {
        const status = res.statusCode || 0;
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
        res.on("error", reject);
      });
    } catch (e) {
      reject(e);
      return;
    }
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

/**
 * Fetch one batched Sina snapshot for the given codes.
 * @param {string[]} codes  e.g. ["hf_CL","hf_GC","DINIW"]
 * @returns {Promise<string>} latin1-decoded body
 */
async function sinaFetch(codes) {
  const buf = await httpGetBuffer(SINA_URL_BASE + codes.join(","), SINA_HEADERS);
  // GBK on the wire; every numeric/date field is ASCII, so latin1 is a lossless
  // decode for the parts we read.
  return buf.toString("latin1");
}

/**
 * Fetch one Yahoo spark chunk.
 * @param {string[]} syms  at most YAHOO_CHUNK_MAX symbols
 * @returns {Promise<object>} parsed JSON
 */
async function yahooSparkFetch(syms) {
  const url =
    `${YAHOO_SPARK_BASE}?symbols=${encodeURIComponent(syms.join(","))}` +
    `&range=1d&interval=5m`;
  const buf = await httpGetBuffer(url, YAHOO_HEADERS);
  return JSON.parse(buf.toString("utf8"));
}

// ── MacroFeed — main class ────────────────────────────────────────────────────

/**
 * Macro quote feed singleton.
 *
 * Call macroFeed.demand(sym) for every macro symbol on each /quotes request, then
 * macroFeed.getAll(syms) to read. Macro quotes bypass the Store entirely — they carry
 * their own prevClose/chg and never need the AnchorCache.
 *
 * Multi-user note: this is a shared singleton. The 64-symbol LRU budget is global.
 */
class MacroFeed {
  /**
   * @param {object} [opts]
   * @param {(codes:string[])=>Promise<string>} [opts.fetchSina]   transport override (tests)
   * @param {(syms:string[])=>Promise<object>}  [opts.fetchYahoo]  transport override (tests)
   */
  constructor(opts = {}) {
    this.disabled = process.env.MACRO_FEED_DISABLE === "1";

    /** @type {Map<string,{lastReq:number}>} demanded symbols, insertion-ordered LRU */
    this._subs = new Map();
    /** @type {Map<string,object>} sym → LIVE quote from Sina */
    this._sinaCache = new Map();
    /** @type {Map<string,object>} sym → DELAYED_15M quote from Yahoo spark */
    this._yahooCache = new Map();

    this._sinaTimer = null;
    this._yahooTimer = null;
    this._stopped = false;

    this.lastSinaPollAt = 0;
    this.lastYahooPollAt = 0;
    this.sinaConsecutiveErrors = 0;
    this.yahooConsecutiveErrors = 0;

    this._fetchSina = opts.fetchSina || sinaFetch;
    this._fetchYahoo = opts.fetchYahoo || yahooSparkFetch;

    if (this.disabled) log.warn("MACRO_FEED_DISABLE=1 — macro feed off");
    else log.info("macro feed init", `sinaSymbols=${Object.keys(SINA_MAP).length}`, `lruCap=${MACRO_LRU_CAP}`);
  }

  start() {
    if (this.disabled) return;
    this._stopped = false;
    this._scheduleSinaPoll();
    this._scheduleYahooPoll();
  }

  stop() {
    this._stopped = true;
    if (this._sinaTimer) { clearTimeout(this._sinaTimer); this._sinaTimer = null; }
    if (this._yahooTimer) { clearTimeout(this._yahooTimer); this._yahooTimer = null; }
  }

  /**
   * Signal that sym is being demanded. Drives LRU membership for both legs.
   * @param {string} sym
   */
  demand(sym) {
    if (this.disabled) return;
    lruTouch(this._subs, sym, MACRO_LRU_CAP, (old) => {
      this._sinaCache.delete(old);
      this._yahooCache.delete(old);
      log.tally("macro LRU-evicted", old);
    });
  }

  /**
   * Freshest cached quote for a macro symbol, or null.
   *
   * TWO rules, both about not printing a claim we cannot back:
   *
   *   1. FRESHER WINS. Both legs cover every demanded symbol, so when both have an
   *      entry we serve whichever carries the later print. A fresh Sina print (seconds
   *      old) beats a 15-min-delayed spark one; once Sina wedges or the contract enters
   *      a session break, the delayed-but-newer spark print takes over. Ties go to Sina
   *      — it is the near-live leg and carries session high/low the spark row lacks.
   *
   *   2. A STALE PRINT NEVER WEARS THE LIVE BADGE. Sina rows say basis "LIVE" because
   *      the leg is seconds behind while it is answering. Once the served Sina print is
   *      older than SINA_STALE_MS it is no longer live in any sense — it is the last
   *      print before the break — so it goes out as DELAYED_15M / live:false. The price
   *      and its own honest ts are unchanged: on a weekend Friday's settle IS the right
   *      answer; labelling it LIVE until Monday is not.
   *
   * @param {string} sym
   * @param {number} [nowMs]
   * @returns {object|null}
   */
  getQuote(sym, nowMs) {
    if (this.disabled) return null;
    const now = nowMs != null ? nowMs : Date.now();
    const s = this._sinaCache.get(sym) || null;
    const y = this._yahooCache.get(sym) || null;
    const q = s && y ? (y.ts > s.ts ? y : s) : (s || y);
    if (!q) return null;
    if (q.source === "sina" && now - q.ts * 1000 > SINA_STALE_MS) {
      return { ...q, live: false, basis: "DELAYED_15M" };
    }
    return q;
  }

  /**
   * Map of present quotes for the requested symbols. Missing symbols are simply
   * absent — same "present entries only" contract as Store.getQuotes.
   *
   * @param {string[]} syms
   * @param {number} [nowMs]
   * @returns {Object<string,object>}
   */
  getAll(syms, nowMs) {
    const out = {};
    if (this.disabled || !Array.isArray(syms)) return out;
    for (const sym of syms) {
      const q = this.getQuote(sym, nowMs);
      if (q) out[sym] = q;
    }
    return out;
  }

  health() {
    if (this.disabled) return { disabled: true };
    // sinaSubs: how many demanded symbols the near-live leg can even carry.
    // yahooSubs: EVERY demanded symbol — the spark leg covers the whole set, both as the
    // only source for what Sina lacks and as the fallback for what it has.
    let sinaSubs = 0;
    for (const sym of this._subs.keys()) {
      if (SINA_MAP[sym]) sinaSubs++;
    }
    return {
      sinaSubs,
      yahooSubs: this._subs.size,
      cacheSize: this._sinaCache.size + this._yahooCache.size,
      lastSinaPollAt: this.lastSinaPollAt ? new Date(this.lastSinaPollAt).toISOString() : null,
      lastYahooPollAt: this.lastYahooPollAt ? new Date(this.lastYahooPollAt).toISOString() : null,
      sinaConsecutiveErrors: this.sinaConsecutiveErrors,
      yahooConsecutiveErrors: this.yahooConsecutiveErrors,
      lruCap: MACRO_LRU_CAP,
    };
  }

  // ── polling ────────────────────────────────────────────────────────────────

  /** Drop symbols nobody has demanded for MACRO_IDLE_EXPIRE_MS, and their caches. */
  _sweepIdle(nowMs) {
    const now = nowMs != null ? nowMs : Date.now();
    const expired = [];
    for (const [sym, meta] of this._subs) {
      if (now - meta.lastReq > MACRO_IDLE_EXPIRE_MS) expired.push(sym);
    }
    for (const sym of expired) {
      this._subs.delete(sym);
      this._sinaCache.delete(sym);
      this._yahooCache.delete(sym);
    }
    if (expired.length) log.info("macro idle-swept", expired.length, "symbols (>30m idle)");
    return expired.length;
  }

  /** Demanded symbols that Sina carries. */
  _sinaCodes() {
    const codes = [];
    for (const sym of this._subs.keys()) {
      const code = SINA_MAP[sym];
      if (code) codes.push(code);
    }
    return codes;
  }

  /**
   * EVERY demanded symbol — the Yahoo spark set.
   *
   * Deliberately NOT "the symbols Sina does not carry". The delayed spark entry is the
   * standby getQuote() falls to when a Sina print goes stale, so excluding Sina-mapped
   * symbols here left `_yahooCache` permanently empty for exactly the symbols the
   * fallback exists to protect — the freshness branch was unreachable and a Sina entry
   * was served basis LIVE regardless of age (fixed 2026-07-27).
   *
   * Cost: at the 64-symbol cap this is ≤4 spark chunks per 15 s poll instead of ≤3.
   */
  _yahooSyms() {
    return [...this._subs.keys()];
  }

  /**
   * One Sina poll cycle. Never throws — a failed poll logs (throttled), bumps the
   * consecutive-error counter, and leaves the existing cache in place.
   */
  async _runSinaPoll() {
    if (this.disabled) return;
    try {
      this._sweepIdle(Date.now());
      const codes = this._sinaCodes();
      if (!codes.length) return; // nothing demanded on this leg — skip the cycle

      const text = await this._fetchSina(codes);
      const rows = parseSinaPayload(text, Date.now());
      for (const q of rows) this._sinaCache.set(q.sym, q);
      this.lastSinaPollAt = Date.now();
      if (this.sinaConsecutiveErrors) {
        log.resetEvery("macro-sina-error");
        this.sinaConsecutiveErrors = 0;
      }
      if (!rows.length) {
        log.every("macro-sina-empty", "WARN", "sina poll returned no usable rows", `codes=${codes.length}`);
      }
    } catch (e) {
      this.sinaConsecutiveErrors++;
      log.every("macro-sina-error", "WARN", "sina poll failed", (e && e.message) || String(e),
        `consecutive=${this.sinaConsecutiveErrors}`);
    }
  }

  /**
   * One Yahoo spark poll cycle (chunked ≤ YAHOO_CHUNK_MAX). Never throws; a failed
   * chunk does not abort the remaining chunks.
   */
  async _runYahooPoll() {
    if (this.disabled) return;
    try {
      const syms = this._yahooSyms();
      if (!syms.length) return;

      let ok = 0;
      let failed = 0;
      for (const chunk of chunkSyms(syms, YAHOO_CHUNK_MAX)) {
        try {
          const json = await this._fetchYahoo(chunk);
          for (const q of parseYahooSpark(json, Date.now())) this._yahooCache.set(q.sym, q);
          ok++;
        } catch (e) {
          failed++;
          log.every("macro-yahoo-error", "WARN", "yahoo spark chunk failed",
            (e && e.message) || String(e), `syms=${chunk.length}`);
        }
      }
      this.lastYahooPollAt = Date.now();
      if (failed) this.yahooConsecutiveErrors++;
      else if (ok) {
        if (this.yahooConsecutiveErrors) log.resetEvery("macro-yahoo-error");
        this.yahooConsecutiveErrors = 0;
      }
    } catch (e) {
      this.yahooConsecutiveErrors++;
      log.every("macro-yahoo-error", "WARN", "yahoo spark poll failed",
        (e && e.message) || String(e), `consecutive=${this.yahooConsecutiveErrors}`);
    }
  }

  /**
   * Next poll delay for a leg: base × 2^min(consecutiveErrors, 5), capped.
   * Zero errors → the plain base interval, so a healthy leg is unaffected.
   *
   * @param {number} baseMs
   * @param {number} errors  consecutive failures for that leg
   * @param {number} capMs
   * @returns {number}
   */
  _backoffMs(baseMs, errors, capMs) {
    const n = Math.min(Math.max(0, errors | 0), BACKOFF_MAX_SHIFT);
    return Math.min(capMs, baseMs * Math.pow(2, n));
  }

  /** Delay before the next Sina poll (3 s healthy → 60 s cap while failing). */
  _sinaDelayMs() {
    return this._backoffMs(SINA_POLL_INTERVAL_MS, this.sinaConsecutiveErrors, SINA_MAX_BACKOFF_MS);
  }

  /** Delay before the next Yahoo poll (15 s healthy → 300 s cap while failing). */
  _yahooDelayMs() {
    return this._backoffMs(YAHOO_POLL_INTERVAL_MS, this.yahooConsecutiveErrors, YAHOO_MAX_BACKOFF_MS);
  }

  _scheduleSinaPoll() {
    if (this.disabled || this._stopped) return;
    // Delay is read at ARM time, so the counter the last cycle just updated is the one
    // that governs the wait — a failing leg backs off from the very next re-arm.
    this._sinaTimer = setTimeout(async () => {
      this._sinaTimer = null;
      await this._runSinaPoll();
      this._scheduleSinaPoll();
    }, this._sinaDelayMs());
  }

  _scheduleYahooPoll() {
    if (this.disabled || this._stopped) return;
    this._yahooTimer = setTimeout(async () => {
      this._yahooTimer = null;
      await this._runYahooPoll();
      this._scheduleYahooPoll();
    }, this._yahooDelayMs());
  }
}

module.exports = {
  MacroFeed,
  isMacroSymbol,
  SINA_MAP,
  SINA_SCALE,
  SINA_CODE_TO_SYM,
  parseSinaPayload,
  parseYahooSpark,
  beijingToEpochSec,
  chunkSyms,
  MACRO_LRU_CAP,
  MACRO_IDLE_EXPIRE_MS,
  SINA_POLL_INTERVAL_MS,
  YAHOO_POLL_INTERVAL_MS,
  YAHOO_CHUNK_MAX,
  SINA_STALE_MS,
  SINA_MAX_BACKOFF_MS,
  YAHOO_MAX_BACKOFF_MS,
  BACKOFF_MAX_SHIFT,
};
