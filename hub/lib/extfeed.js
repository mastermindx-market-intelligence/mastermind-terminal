"use strict";
// lib/extfeed.js — Extended / overnight quote feed for the Quote Hub.
//
// PURPOSE
//   Provides extPrice, extChg, extTs, extSession, extSource fields during
//   extended-hours windows: pre-market (04:00–09:30 ET), post-market (16:00–20:00 ET),
//   and true overnight (20:00–04:00 ET, Blue Ocean ATS via Alpaca's overnight feed).
//   These fields are NEVER emitted during RTH (09:30–16:00 ET).
//
// ARCHITECTURE (singleton in hub.js — shared across ALL users by design)
//   The hub is a shared singleton. The 30-symbol budget is global: if user A subscribes
//   NVDA and user B subscribes AAPL, both consume one slot each from the shared LRU cap.
//   Documented in hub/README.md §Extended-hours feed.
//
// FEED SELECTION
//   (a) Alpaca overnight websocket — requires ALPACA_API_KEY + ALPACA_API_SECRET env vars.
//       Free plan: IEX feed, 30-symbol websocket cap, covers ALL extended-hours windows
//       (pre-market, post-market, true overnight via v1beta1/overnight). Dynamic
//       subscriptions: subscribe symbols on /quotes demand, LRU cap 30, unsubscribe
//       evicted symbols.
//   (b) R2 relay file — fetches https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/live_flow/ext_quotes.json
//       every ~60 s. No credentials required (public R2 object). The Mac residential
//       IP polls Yahoo and publishes to R2 every 2 min during ext windows; the VPS
//       reads that relay file. asof_utc older than 5 min → treated as absent (stale).
//       extSource="yahoo-relay". Covers pre-market (04:00–09:30 ET) and post-market
//       (16:00–20:00 ET) but NOT true overnight (20:00–04:00 ET).
//       Cache entries are written in the SAME { price, ts, session, source } shape as every
//       other leg — the relay file's own extPrice/extTs field names stay in the file.
//   (c) Webull keyless quote API — quotes-gw.webullfintech.com. Resolves a tickerId per
//       symbol once (cached for the process lifetime), then polls getQuote every 60 s
//       outside RTH. Serves pPrice + tradeTime — the only fields verified against a live
//       payload. Candidate "overnight price" key names are logged once each as discovery
//       telemetry and never served. VERIFIED ABSENT 2026-07-27: a live probe from the VPS
//       (20:33–20:37 ET, during an active Blue Ocean overnight session) showed getQuote does
//       NOT carry true overnight (20:00–04:00 ET) prints — pPrice/pChange/tradeTime stayed
//       frozen at the final post-market print (~19:59 ET) across samples 65 s apart
//       (NVDA/SOFI/TSLA). The session gate in webullExtractPrint() therefore rejects the
//       stale post print overnight, and this leg serves nothing 20:00–04:00 ET by design;
//       the overnight unlock is Alpaca keys (leg (a)). extSource="webull".
//   (d) Keyless Yahoo fallback (legacy, kept for local dev) — direct REST polling of
//       query1.finance.yahoo.com/v8/finance/chart/<SYM>?interval=1m&range=1d&includePrePost=true
//       every ~60 s for the demanded symbols. Covers pre-market and post-market only.
//       Clearly labelled extSource="yahoo_unofficial". Grey endpoint — ToS-grey risk noted.
//       429s on DigitalOcean VPS IPs; r2file mode exists to bypass this.
//
//   Serve priority in getExt(): licensed stream (Alpaca/Polygon) → Webull →
//   Yahoo / R2 relay. An Alpaca entry is ignored when authentication failed.
//
// KILL-SWITCHES
//   EXT_FEED_DISABLE=1 → disables entirely (extPrice fields never emitted).
//   WEBULL_DISABLE=1   → disables the Webull leg only; Alpaca/Yahoo unaffected.
//
// SESSION-WINDOW LOGIC
//   Windows use ET (America/New_York). Half-open intervals:
//     pre-market: [04:00, 09:30)
//     RTH:        [09:30, 16:00)  ← ext fields suppressed
//     post-market:[16:00, 20:00)
//     overnight:  [20:00, 04:00)  (i.e. >= 20:00 OR < 04:00)
//   Weekend / holiday treatment: hub makes no NYSE-calendar assumption here. If the
//   upstream feed provides a print, we forward it; if not, extPrice is absent. The
//   session classifier returns 'overnight' on weekends during that clock window —
//   upstream will simply not send prints on those days.

const https = require("https");
const WebSocket = require("ws");
const log = require("./log");
const { classifySession } = require("./usSession");

// ── Session window classification ──────────────────────────────────────────────

// ── LRU map (insertion-ordered, Map iteration order is stable in V8) ──────────

/**
 * @param {Map} map — insertion-order LRU map
 * @param {string} key
 * @param {number} cap
 * @param {function} onEvict  — called with evicted key when cap is exceeded
 */
function lruTouch(map, key, cap, onEvict) {
  if (map.has(key)) {
    // Re-insert to MRU end and refresh the lastReq timestamp so the idle-sweep
    // does not unsubscribe symbols that are being actively demanded.
    const val = map.get(key);
    val.lastReq = Date.now();
    map.delete(key);
    map.set(key, val);
    return;
  }
  // Evict LRU entry if at cap.
  while (map.size >= cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
    if (onEvict) onEvict(oldest);
  }
  map.set(key, { lastReq: Date.now() });
}

// Subscription capacity and quote-history capacity are different things. The upstream keyless
// feeds can refresh only 30 symbols at once, but deleting a symbol's last valid print the instant
// it loses a subscription turns ordinary LRU pressure into a fake market-data deletion. Retain a
// bounded, insertion-ordered last-good cache; getExt's session + 90-minute gates remain the source
// of truth for whether an entry is still servable.
const EXT_CACHE_CAP = 500;

/**
 * Set an entry in a bounded insertion-ordered cache and refresh its MRU position.
 * @param {Map} map
 * @param {string} key
 * @param {object} value
 * @param {number} [cap]
 */
function boundedCacheSet(map, key, value, cap = EXT_CACHE_CAP) {
  if (!(map instanceof Map) || !Number.isFinite(cap) || cap < 1) return;
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

// ── Yahoo unofficial REST fallback ────────────────────────────────────────────

const YAHOO_POLL_INTERVAL_MS = 60 * 1000; // poll every 60 s
const YAHOO_BATCH_MAX = 30; // one HTTP request per symbol (Yahoo v8 chart = per-symbol)
const YAHOO_TIMEOUT_MS = 8 * 1000;

/**
 * Fetch a single symbol from Yahoo v8/finance/chart and extract the latest
 * extended-hours close price (last bar in pre or post session).
 *
 * Returns null when the symbol has no extended-hours print or the fetch fails.
 *
 * @param {string} sym  — US equity ticker (e.g. "AAPL")
 * @param {number} nowMs
 * @returns {Promise<{price:number, ts:number, session:'pre'|'post'}|null>}
 */
function yahooFetchExtPrice(sym, nowMs) {
  return new Promise((resolve) => {
    const session = classifySession(nowMs);
    // Yahoo pre/post data is only available in those windows (not overnight).
    if (session !== "pre" && session !== "post") {
      resolve(null);
      return;
    }

    const url =
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
      `?interval=1m&range=1d&includePrePost=true`;
    const req = https.get(
      url,
      { timeout: YAHOO_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0" } },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          try {
            const d = JSON.parse(body);
            const result = d && d.chart && d.chart.result && d.chart.result[0];
            if (!result) { resolve(null); return; }

            const meta = result.meta || {};
            const ctp = meta.currentTradingPeriod || {};
            const timestamps = result.timestamp || [];
            const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];

            if (!timestamps.length) { resolve(null); return; }

            // Determine session boundaries (Unix seconds).
            let sessionStart, sessionEnd;
            if (session === "pre") {
              sessionStart = ctp.pre && ctp.pre.start;
              sessionEnd = ctp.pre && ctp.pre.end;
            } else {
              sessionStart = ctp.post && ctp.post.start;
              sessionEnd = ctp.post && ctp.post.end;
            }

            if (!sessionStart || !sessionEnd) { resolve(null); return; }

            // Find the last bar inside the current session window with a non-null close.
            let lastTs = null, lastClose = null;
            for (let i = timestamps.length - 1; i >= 0; i--) {
              const t = timestamps[i];
              const c = closes[i];
              if (t >= sessionStart && t < sessionEnd && c != null && Number.isFinite(c)) {
                lastTs = t;
                lastClose = c;
                break;
              }
            }

            if (lastClose == null) { resolve(null); return; }
            resolve({ price: lastClose, ts: lastTs, session });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// ── R2 relay file poll ────────────────────────────────────────────────────────

const R2_EXT_URL = "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/live_flow/ext_quotes.json";
const R2_POLL_INTERVAL_MS = 60 * 1000;   // fetch every 60 s
const R2_STALE_MS = 5 * 60 * 1000;       // treat file older than 5 min as absent
const R2_TIMEOUT_MS = 8 * 1000;

/**
 * Fetch and parse the ext_quotes relay file from R2.
 * Returns the parsed object, or null on error / timeout.
 *
 * @returns {Promise<object|null>}
 */
function r2FetchExtFile() {
  return new Promise((resolve) => {
    const req = https.get(
      R2_EXT_URL,
      { timeout: R2_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// ── Alpaca websocket feed ─────────────────────────────────────────────────────

const ALPACA_WS_URL = "wss://stream.data.alpaca.markets/v1beta1/overnight";
const ALPACA_LRU_CAP = 30; // free plan: 30-symbol ws cap (all users, shared)
const ALPACA_SWEEP_MS = 60 * 1000;
const ALPACA_MAX_BACKOFF_MS = 30 * 1000;
const ALPACA_IDLE_UNSUB_MS = 30 * 60 * 1000;

class AlpacaFeed {
  /**
   * @param {string} apiKey
   * @param {string} apiSecret
   * @param {function(string, {price:number, ts:number, session:string}):void} onQuote
   */
  constructor(apiKey, apiSecret, onQuote) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.onQuote = onQuote;

    this.ws = null;
    this.authed = false;
    this.authFailed = false;
    this.stopped = false;
    this.attempt = 0;
    this.lastMsgAt = 0;
    this.reconnectTimer = null;
    this.sweepTimer = null;

    // LRU sub map: sym → { lastReq: number }
    this.subs = new Map();
  }

  start() {
    this.stopped = false;
    this._connect();
    this.sweepTimer = setInterval(() => this._sweepIdle(), ALPACA_SWEEP_MS);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    if (this.ws) { try { this.ws.terminate(); } catch {} this.ws = null; }
    this.authed = false;
  }

  isHealthy() { return this.authed && !this.authFailed; }

  health() {
    return {
      authed: this.authed,
      authFailed: this.authFailed,
      subs: this.subs.size,
      lruCap: ALPACA_LRU_CAP,
      lastMsgAt: this.lastMsgAt ? new Date(this.lastMsgAt).toISOString() : null,
      attempt: this.attempt,
    };
  }

  ensureSubscribed(sym) {
    const onEvict = (old) => {
      this._send({ action: "unsubscribe", trades: [old] });
      log.info("alpaca LRU-evicted", old);
    };
    lruTouch(this.subs, sym, ALPACA_LRU_CAP, onEvict);
    if (!this.subs.get(sym) || this.subs.get(sym).subscribedOnServer) return;
    // Mark pending subscribe
    this.subs.get(sym).subscribedOnServer = false;
    if (this.authed) {
      this._send({ action: "subscribe", trades: [sym] });
      this.subs.get(sym).subscribedOnServer = true;
    }
  }

  _backoffMs() {
    const base = Math.min(ALPACA_MAX_BACKOFF_MS, Math.pow(2, this.attempt) * 1000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(1000, Math.round(base + jitter));
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const wait = this._backoffMs();
    this.attempt++;
    log.every("alpaca-reconnect", "WARN", "alpaca reconnect in", `${wait}ms`, `attempt=${this.attempt}`);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this._connect(); }, wait);
  }

  _connect() {
    if (this.stopped) return;
    let ws;
    try { ws = new WebSocket(ALPACA_WS_URL); } catch (e) {
      log.error("alpaca ws construct failed", e.message); this._scheduleReconnect(); return;
    }
    this.ws = ws;
    this.authed = false;

    ws.on("open", () => {
      this.lastMsgAt = Date.now();
      log.info("alpaca ext feed connected — authenticating");
      this._send({ action: "auth", key: this.apiKey, secret: this.apiSecret });
    });

    ws.on("message", (buf) => {
      this.lastMsgAt = Date.now();
      let arr;
      try { arr = JSON.parse(buf.toString()); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];
      for (const msg of arr) this._onMessage(msg);
    });

    ws.on("error", (e) => log.every("alpaca-error", "WARN", "alpaca ws error", e && e.message));
    ws.on("close", (code) => {
      this.authed = false;
      log.every("alpaca-close", "WARN", "alpaca ws closed", `code=${code}`);
      this._scheduleReconnect();
    });
  }

  _onMessage(msg) {
    if (!msg) return;
    const t = msg.T || msg.type;

    if (t === "success") {
      if (msg.msg === "authenticated") {
        this.authed = true;
        this.authFailed = false;
        this.attempt = 0;
        log.info("alpaca ext feed authenticated — replaying subs", `n=${this.subs.size}`);
        log.resetEvery("alpaca-reconnect");
        this._replaySubs();
        return;
      }
      if (msg.msg === "connected") return; // handshake ack
    }

    if (t === "error") {
      const code = msg.code;
      // 402 = auth failed, 403 = not authorized for feed
      if (code === 402 || code === 403) {
        this.authFailed = true;
        this.authed = false;
        log.error("alpaca auth/subscription error", `code=${code}`, msg.msg || "");
      } else {
        log.warn("alpaca error msg", `code=${code}`, msg.msg || "");
      }
      return;
    }

    // Trade messages: T="t" on overnight feed
    if (t === "t") this._onTrade(msg);
  }

  _onTrade(msg) {
    const sym = msg.S || msg.Symbol;
    const price = Number(msg.p || msg.Price);
    const tsStr = msg.t || msg.Timestamp;
    if (!sym || !Number.isFinite(price) || !tsStr) return;

    let ts;
    try { ts = Math.floor(new Date(tsStr).getTime() / 1000); } catch { ts = Math.floor(Date.now() / 1000); }

    const session = classifySession(ts * 1000);
    // Alpaca overnight feed should never emit during RTH but guard anyway.
    if (session === "rth") return;

    if (this.onQuote) this.onQuote(sym, { price, ts, session });
  }

  _replaySubs() {
    const syms = [...this.subs.keys()];
    if (!syms.length) return;
    this._send({ action: "subscribe", trades: syms });
    for (const s of syms) {
      const meta = this.subs.get(s);
      if (meta) meta.subscribedOnServer = true;
    }
  }

  _sweepIdle() {
    const now = Date.now();
    const toUnsub = [];
    for (const [sym, meta] of this.subs) {
      if (now - meta.lastReq > ALPACA_IDLE_UNSUB_MS) toUnsub.push(sym);
    }
    for (const sym of toUnsub) {
      this.subs.delete(sym);
    }
    if (toUnsub.length) {
      this._send({ action: "unsubscribe", trades: toUnsub });
      log.info("alpaca idle-swept", toUnsub.length, "subs (>30m idle)");
    }
  }

  _send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(frame)); } catch (e) {
      log.warn("alpaca send failed", e.message);
    }
  }
}

// ── Webull keyless quote API ──────────────────────────────────────────────────
//
// Two endpoints, both keyless (User-Agent: Mozilla/5.0 required):
//   search: /api/search/pc/tickers?keyword=<SYM>&pageIndex=1&pageSize=3
//           → data[] rows { tickerId, disSymbol, regionCode, template, type }
//   quote:  /api/stock/tickerRealTime/getQuote?tickerId=<ID>&includeSecu=1&more=1
//           → { tradeTime, status, close, preClose, pPrice, pChange, pChRatio, ... }
// Every numeric field arrives as a STRING — Number() everything.

const WEBULL_SEARCH_URL = "https://quotes-gw.webullfintech.com/api/search/pc/tickers";
const WEBULL_QUOTE_URL = "https://quotes-gw.webullfintech.com/api/stock/tickerRealTime/getQuote";
const WEBULL_HEADERS = { "User-Agent": "Mozilla/5.0" };
const WEBULL_LRU_CAP = 30;
const WEBULL_POLL_INTERVAL_MS = 60 * 1000;
const WEBULL_TIMEOUT_MS = 8 * 1000;
const WEBULL_STAGGER_MS = 150;          // be polite: sequential fetches, small gap
const WEBULL_IDLE_UNSUB_MS = 30 * 60 * 1000;
const WEBULL_MAX_AGE_MS = 90 * 60 * 1000;
const WEBULL_MISS_TTL_MS = 60 * 60 * 1000; // negative tickerId cache — don't hammer search

// Candidate key names for an explicit overnight print. DISCOVERY TELEMETRY ONLY — never served.
//
// VERIFIED ABSENT 2026-07-27: a live VPS probe during an active Blue Ocean overnight session
// (20:33–20:37 ET) found NONE of these keys in the getQuote payload (NVDA/SOFI/TSLA) — the
// telemetry line below never fired. The payload DOES carry a literal `overnight` field, but it
// is an integer FLAG (observed 0), not a price, and appending &overnight=1 to getQuote changes
// nothing — worth re-probing if that flag ever reads non-zero. Every name here remains a guess.
// Serving a guessed field in preference to the VERIFIED pPrice would mean the first time Webull
// ships an unrelated key that happens to match one of these names, an unvalidated number
// silently becomes the price on the tape. The names are logged once each so a real one can be
// confirmed from the journal and promoted deliberately.
const WEBULL_OVERNIGHT_PRICE_KEYS = ["ovnPrice", "overnightPrice", "ovPrice", "overnightPx"];

// Key names already logged — one line per name per process, not one per poll.
const _webullOvernightKeysLogged = new Set();

// tradeTime MUST carry an explicit UTC offset or a trailing Z. `Date.parse` on an offset-less
// "2026-07-27T09:31:39" applies the SERVER's local zone, so the same payload yields a different
// instant on a UTC box than on an ET one — and the session/staleness gates below then compare
// that shifted instant against the wrong window. Every observed payload uses "+0000"; anything
// without an offset is rejected rather than guessed at.
const WEBULL_TS_OFFSET_RE = /[+-]\d{2}:?\d{2}$|Z$/;

/**
 * Extract an acceptable extended-session print from a Webull getQuote payload.
 *
 * GATE (load-bearing honesty rule — a rejected print writes nothing to the cache):
 *   1. The current session must not be RTH.
 *   2. tradeTime must carry an explicit offset/Z and parse to a finite timestamp.
 *   3. The print's OWN session (classifySession applied to its timestamp) must equal
 *      the current session. Without this, a Friday 17:00 ET post-market print would
 *      masquerade as Sunday-overnight data all weekend.
 *   4. The print must be < 90 min old (and not in the future — clock-skew guard).
 *
 * The served price is ALWAYS pPrice — the only field verified against a live payload.
 *
 * @param {object} json    raw getQuote response
 * @param {number} nowMs
 * @returns {{price:number, ts:number, session:string, source:'webull', key:'pPrice'}|null}
 */
function webullExtractPrint(json, nowMs) {
  if (!json || typeof json !== "object") return null;

  const nowSession = classifySession(nowMs);
  if (nowSession === "rth") return null;

  // Telemetry only: note (once per key name) that Webull exposed a candidate overnight field,
  // so a real one can be verified from the journal before anyone wires it to a price.
  for (const k of WEBULL_OVERNIGHT_PRICE_KEYS) {
    if (_webullOvernightKeysLogged.has(k)) continue;
    const v = Number(json[k]);
    if (json[k] != null && Number.isFinite(v) && v > 0) {
      _webullOvernightKeysLogged.add(k);
      log.info("webull overnight price key observed (telemetry only — not served)", k);
    }
  }

  // pPrice is the extended-session print (pre/post confirmed live) and the ONLY field served.
  const price = Number(json.pPrice);
  if (json.pPrice == null || !Number.isFinite(price) || price <= 0) return null;

  const tradeTime = typeof json.tradeTime === "string" ? json.tradeTime.trim() : "";
  if (!WEBULL_TS_OFFSET_RE.test(tradeTime)) return null;
  const tsMs = Date.parse(tradeTime);
  if (!Number.isFinite(tsMs)) return null;

  // Gate 3: the print's own session must match the session we are serving into.
  if (classifySession(tsMs) !== nowSession) return null;

  // Gate 4: freshness. A future-dated print is a clock/parse defect, not data.
  const ageMs = nowMs - tsMs;
  if (ageMs > WEBULL_MAX_AGE_MS) return null;
  if (ageMs < -60 * 1000) return null;

  return { price, ts: Math.floor(tsMs / 1000), session: nowSession, source: "webull", key: "pPrice" };
}

/**
 * GET a URL and resolve parsed JSON, or null on any error / timeout / non-2xx.
 * @param {string} url
 * @returns {Promise<object|null>}
 */
function webullFetchJson(url) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { timeout: WEBULL_TIMEOUT_MS, headers: WEBULL_HEADERS }, (res) => {
        const status = res.statusCode || 0;
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          if (status < 200 || status >= 300) { resolve(null); return; }
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
        res.on("error", () => resolve(null));
      });
    } catch { resolve(null); return; }
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

class WebullFeed {
  /**
   * @param {object} [opts]
   * @param {(url:string)=>Promise<object|null>} [opts.fetchJson] transport override (tests)
   */
  constructor(opts = {}) {
    /** @type {Map<string,{lastReq:number}>} demanded symbols (insertion-ordered LRU) */
    this.subs = new Map();
    /** @type {Map<string,{price:number, ts:number, session:string, source:string}>} */
    this.cache = new Map();
    /** @type {Map<string,number>} sym → tickerId (resolved once, kept for the process life) */
    this.tickerIds = new Map();
    /** @type {Map<string,number>} sym → epoch ms of the last failed lookup (1 h negative TTL) */
    this.misses = new Map();

    this.timer = null;
    this.stopped = false;
    this.lastPollAt = 0;
    this.consecutiveErrors = 0;

    this._fetchJson = opts.fetchJson || webullFetchJson;
  }

  start() {
    this.stopped = false;
    this._schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** LRU-track a demanded symbol. */
  demand(sym) {
    lruTouch(this.subs, sym, WEBULL_LRU_CAP, (old) => {
      // Eviction ends refresh only. The last-good print remains in the independently bounded
      // cache and is served only while ExtFeed.getExt's session/freshness gates accept it.
      log.info("webull subscription LRU-evicted", old);
    });
  }

  /** Cached ext print for a symbol, or null. */
  get(sym) {
    return this.cache.get(sym) || null;
  }

  health() {
    return {
      subs: this.subs.size,
      cacheSize: this.cache.size,
      tickerIds: this.tickerIds.size,
      lastPollAt: this.lastPollAt ? new Date(this.lastPollAt).toISOString() : null,
      consecutiveErrors: this.consecutiveErrors,
      lruCap: WEBULL_LRU_CAP,
    };
  }

  /**
   * Resolve sym → Webull tickerId. Positive results are cached for the process
   * lifetime; misses are cached for 1 h so an unlisted ticker cannot hammer search.
   *
   * @param {string} sym
   * @returns {Promise<number|null>}
   */
  async resolveTickerId(sym) {
    const hit = this.tickerIds.get(sym);
    if (hit != null) return hit;

    const missAt = this.misses.get(sym);
    if (missAt != null && Date.now() - missAt < WEBULL_MISS_TTL_MS) return null;

    const url =
      `${WEBULL_SEARCH_URL}?keyword=${encodeURIComponent(sym)}&pageIndex=1&pageSize=3`;
    const json = await this._fetchJson(url);
    const rows = json && Array.isArray(json.data) ? json.data : [];
    const want = String(sym).toUpperCase();
    for (const row of rows) {
      if (!row) continue;
      if (String(row.disSymbol || "").toUpperCase() !== want) continue;
      if (String(row.regionCode || "").toUpperCase() !== "US") continue;
      if (String(row.template || "") !== "stock") continue;
      const id = Number(row.tickerId);
      if (!Number.isFinite(id)) continue;
      this.tickerIds.set(sym, id);
      this.misses.delete(sym);
      return id;
    }
    this.misses.set(sym, Date.now());
    return null;
  }

  /**
   * One poll cycle: sequential per-symbol getQuote outside RTH only.
   * Never throws; a failed symbol leaves its cache entry untouched.
   */
  async runPoll() {
    try {
      const nowMs = Date.now();
      if (classifySession(nowMs) === "rth") return; // ext fields are suppressed in RTH anyway

      this._sweepIdle(nowMs);
      const syms = [...this.subs.keys()];
      if (!syms.length) return;

      let failed = 0;
      for (const sym of syms) {
        try {
          const id = await this.resolveTickerId(sym);
          if (id == null) continue;
          const json = await this._fetchJson(
            `${WEBULL_QUOTE_URL}?tickerId=${encodeURIComponent(String(id))}&includeSecu=1&more=1`
          );
          if (!json) { failed++; continue; }
          const print = webullExtractPrint(json, Date.now());
          // A rejected print writes NOTHING — we keep the previous (honest) entry.
          if (print) {
            boundedCacheSet(this.cache, sym, {
              price: print.price,
              ts: print.ts,
              session: print.session,
              source: "webull",
            });
          }
        } catch (e) {
          failed++;
          log.every("webull-sym-error", "WARN", "webull symbol poll failed", sym,
            (e && e.message) || String(e));
        }
        if (WEBULL_STAGGER_MS > 0) await new Promise((r) => setTimeout(r, WEBULL_STAGGER_MS));
      }

      this.lastPollAt = Date.now();
      if (failed) {
        this.consecutiveErrors++;
        log.every("webull-poll-error", "WARN", "webull poll had failures",
          `failed=${failed}/${syms.length}`, `consecutive=${this.consecutiveErrors}`);
      } else {
        if (this.consecutiveErrors) log.resetEvery("webull-poll-error");
        this.consecutiveErrors = 0;
      }
    } catch (e) {
      this.consecutiveErrors++;
      log.every("webull-poll-error", "WARN", "webull poll crashed",
        (e && e.message) || String(e), `consecutive=${this.consecutiveErrors}`);
    }
  }

  _sweepIdle(nowMs) {
    const expired = [];
    for (const [sym, meta] of this.subs) {
      if (nowMs - meta.lastReq > WEBULL_IDLE_UNSUB_MS) expired.push(sym);
    }
    for (const sym of expired) this.subs.delete(sym);
    // Idle sweep, like LRU eviction, ends refresh only. The independently bounded cache is
    // expired by getExt's session/freshness gates rather than by subscription bookkeeping.
    if (expired.length) log.info("webull subscriptions idle-swept", expired.length, "symbols (>30m idle)");
  }

  _schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.runPoll();
      this._schedule();
    }, WEBULL_POLL_INTERVAL_MS);
  }
}

/**
 * Guard for cache entries consumed by getExt(). Every leg is expected to store
 * { price, ts, session, source }; an entry missing a finite price or ts is a
 * producer defect and must never be served as an ext quote (a missing extPrice
 * with a populated extSource is worse than no ext block at all).
 *
 * @param {object|undefined} e
 * @returns {object|null}
 */
function validExtEntry(e) {
  if (!e) return null;
  if (!Number.isFinite(Number(e.price))) return null;
  if (!Number.isFinite(Number(e.ts))) return null;
  return e;
}

/**
 * Return a candidate only when it is servable in the current window. Provider priority must be
 * applied AFTER this filter: a retained stale Webull print must not shadow a fresh Yahoo fallback.
 * @param {object|undefined} e
 * @param {string} session
 * @param {number} nowMs
 * @returns {object|null}
 */
function servableExtEntry(e, session, nowMs) {
  const entry = validExtEntry(e);
  if (!entry || entry.session !== session) return null;
  const ageMs = nowMs - Number(entry.ts) * 1000;
  if (ageMs > 90 * 60 * 1000) return null;
  if (ageMs < -60 * 1000) return null;
  return entry;
}

// ── ExtFeed — main class ──────────────────────────────────────────────────────

/**
 * Extended-hours feed singleton.
 *
 * Call extFeed.demand(sym) whenever /quotes is called for a US symbol.
 * Call extFeed.getExt(sym, nowMs, officialClose) to retrieve the ext fields for
 * serve-time merging in store.getQuotes.
 *
 * Multi-user note: this is a shared singleton. The 30-symbol LRU budget is
 * global across all connected users. A /quotes request for symbol X from any
 * user advances X to MRU; the oldest symbol is evicted if at cap.
 */
class ExtFeed {
  /**
   * @param {object} opts
   * @param {string} [opts.alpacaKey]
   * @param {string} [opts.alpacaSecret]
   * @param {()=>Promise<object|null>} [opts.fetchRelay]          transport override (tests)
   * @param {(sym:string, nowMs:number)=>Promise<object|null>} [opts.fetchYahooExt]  ditto
   */
  constructor({ alpacaKey, alpacaSecret, fetchRelay, fetchYahooExt } = {}) {
    // Assigned before the disabled short-circuit so a test can inject transports on any instance.
    this._fetchRelay = fetchRelay || r2FetchExtFile;
    this._fetchYahooExt = fetchYahooExt || yahooFetchExtPrice;
    this.disabled = process.env.EXT_FEED_DISABLE === "1";
    if (this.disabled) {
      log.warn("EXT_FEED_DISABLE=1 — extended-hours feed off");
      this.mode = "disabled";
      this.alpaca = null;
      this.webull = null;
      this._extMap = null;
      this._yahooCache = null;
      this._yahooSubs = null;
      this._yahooTimer = null;
      return;
    }

    // Webull leg — keyless, covers pre/post only; true overnight verified absent
    // 2026-07-27 (the session gate in webullExtractPrint rejects the stale post
    // print it keeps serving). Independent kill-switch.
    this.webullDisabled = process.env.WEBULL_DISABLE === "1";
    this.webull = this.webullDisabled ? null : new WebullFeed();
    if (this.webullDisabled) log.warn("WEBULL_DISABLE=1 — webull ext leg off");

    // ext quote store: sym → { price, ts, session, source }
    this._extMap = new Map();

    if (alpacaKey && alpacaSecret) {
      this.mode = "alpaca";
      this.alpaca = new AlpacaFeed(alpacaKey, alpacaSecret, (sym, { price, ts, session }) => {
        this.ingest(sym, {
          price,
          ts,
          session,
          source: "alpaca_overnight",
          basis: "DELAYED_15M",
        });
        log.every(`ext-${sym}`, "DEBUG", "ext trade", sym, price, session);
      });
      // Yahoo fallback structures are initialised unconditionally so that if Alpaca
      // auth fails (402/403 — plan not entitled) we can degrade gracefully to the
      // keyless Yahoo leg for pre/post windows rather than silently serving no ext data.
      this._yahooSubs = new Map();
      this._yahooCache = new Map();
      this._yahooTimer = null;
    } else {
      // Keyless Yahoo fallback.
      this.mode = "yahoo_fallback";
      this.alpaca = null;
      // Yahoo-demanded symbols: sym → { lastReq }
      this._yahooSubs = new Map();
      // Yahoo REST result cache: sym → { price, ts, session }  (populated by poller)
      this._yahooCache = new Map();
      this._yahooTimer = null;
    }

    log.info("ext feed init", `mode=${this.mode}`);
  }

  start() {
    if (this.disabled) return;
    if (this.mode === "alpaca" && this.alpaca) {
      this.alpaca.start();
      // Also start the Yahoo poller as a warm fallback in case Alpaca auth fails.
      // The poller is a no-op during RTH/overnight so it adds negligible overhead.
      this._scheduleYahooPoll();
    } else if (this.mode === "yahoo_fallback") {
      // Start the Yahoo polling loop.
      this._scheduleYahooPoll();
    }
    // Webull runs in both modes — but it does NOT carry true overnight prints
    // (verified 2026-07-27), so without Alpaca keys the hub serves no ext data
    // 20:00–04:00 ET.
    if (this.webull) this.webull.start();
  }

  stop() {
    if (this.disabled) return;
    if (this.alpaca) this.alpaca.stop();
    if (this.webull) this.webull.stop();
    if (this._yahooTimer) { clearTimeout(this._yahooTimer); this._yahooTimer = null; }
  }

  /**
   * Signal that sym is being demanded. Must be called for every US sym on each /quotes request.
   * This drives LRU subscription management.
   * @param {string} sym
   */
  demand(sym) {
    if (this.disabled) return;
    if (this.mode === "alpaca" && this.alpaca) {
      this.alpaca.ensureSubscribed(sym);
      // Mirror into Yahoo subs so the fallback poller covers this symbol if Alpaca
      // auth fails.  _yahooSubs is always initialised in alpaca mode (see constructor).
      lruTouch(this._yahooSubs, sym, ALPACA_LRU_CAP, (old) => {
        // Subscription eviction ends refresh only; retain the bounded last-good print.
        log.info("yahoo fallback subscription LRU-evicted", old);
      });
    } else if (this.mode === "yahoo_fallback" && this._yahooSubs) {
      lruTouch(this._yahooSubs, sym, ALPACA_LRU_CAP, (old) => {
        // Subscription eviction ends refresh only; retain the bounded last-good print.
        log.info("yahoo ext subscription LRU-evicted", old);
      });
    }
    // Webull mirrors every demanded US symbol regardless of mode.
    if (this.webull) this.webull.demand(sym);
  }

  /**
   * Ingest an extended-session print from any hub feed. Newer timestamps win,
   * which lets Alpaca and Polygon coexist without racing the displayed price.
   *
   * @param {string} sym
   * @param {{price:number,ts:number,session:string,source:string,basis?:string}} entry
   */
  ingest(sym, entry) {
    if (this.disabled || !this._extMap || !entry) return;
    if (!Number.isFinite(entry.price) || !Number.isFinite(entry.ts)) return;
    if (entry.session === "rth") return;
    const previous = this._extMap.get(sym);
    if (!previous || entry.ts >= previous.ts) boundedCacheSet(this._extMap, sym, entry);
  }

  /**
   * Return ext fields to merge into a quote at serve-time.
   * Returns null when: feed disabled, current window is RTH, no ext print available.
   *
   * @param {string} sym
   * @param {number} nowMs
   * @param {number|null} officialClose  — today's official EOD close (anchor.close), or null
   * @returns {{ extPrice:number, extChg:number|null, extTs:number, extSession:string, extSource:string }|null}
   */
  getExt(sym, nowMs, officialClose) {
    if (this.disabled) return null;
    const session = classifySession(nowMs);
    if (session === "rth") return null;

    // Preserve the documented provider priority among candidates that are actually servable NOW.
    // The shared map contains both Polygon and Alpaca prints, so an Alpaca entry is only eligible
    // when the configured Alpaca leg has not failed authentication. Filtering session/freshness
    // before priority also lets a fresh lower-priority leg replace a retained stale higher one.
    const streamEntry = this._extMap
      ? servableExtEntry(this._extMap.get(sym), session, nowMs)
      : null;
    const streamSource = String(streamEntry?.source || "");
    const streamEligible =
      streamEntry &&
      (
        !streamSource.startsWith("alpaca") ||
        (this.alpaca && !this.alpaca.authFailed)
      );
    const webullEntry = this.webull
      ? servableExtEntry(this.webull.get(sym), session, nowMs)
      : null;
    const yahooEntry = this._yahooCache
      ? servableExtEntry(this._yahooCache.get(sym), session, nowMs)
      : null;
    const entry =
      (streamEligible ? streamEntry : null) ||
      webullEntry ||
      (
        yahooEntry &&
        !(session === "overnight" && String(yahooEntry.source || "").startsWith("yahoo"))
          ? yahooEntry
          : null
      );

    if (!entry) return null;

    const extPrice = entry.price;
    // chg vs the best available close reference:
    //   post-close → officialClose = today's EOD close (daily file has rolled)
    //   pre-market / overnight → store.getQuotes passes prevClose as the reference
    //     (today's official close does not exist yet; prevClose is the prior session's
    //      close — the same anchor used for the primary chg field)
    const closeRef = officialClose != null && Number.isFinite(officialClose) ? officialClose : null;
    const extChg = closeRef != null && closeRef !== 0
      ? ((extPrice - closeRef) / closeRef) * 100
      : null;

    return {
      extPrice,
      extChg,
      extTs: entry.ts,
      extSession: entry.session,
      extSource: entry.source,
      extBasis: entry.basis || (
        entry.source === "webull" || String(entry.source || "").startsWith("yahoo")
          ? "UNOFFICIAL"
          : String(entry.source || "").includes("live")
            ? "LIVE"
            : "DELAYED_15M"
      ),
    };
  }

  // ── Yahoo polling ──

  _scheduleYahooPoll() {
    if (this.disabled || (this.mode !== "yahoo_fallback" && this.mode !== "alpaca")) return;
    this._yahooTimer = setTimeout(async () => {
      await this._runYahooPoll();
      this._scheduleYahooPoll();
    }, YAHOO_POLL_INTERVAL_MS);
  }

  async _runYahooPoll() {
    if (!this._yahooSubs || !this._yahooCache) return;
    const nowMs = Date.now();
    const session = classifySession(nowMs);

    // Yahoo only has pre/post data; skip polling during RTH and overnight.
    if (session === "rth" || session === "overnight") return;

    const syms = [...this._yahooSubs.keys()];
    if (!syms.length) return;

    // ── R2 relay first (the VPS's own IP is Yahoo-429-blocked) ──────────────
    // The Mac residential IP publishes live_flow/ext_quotes.json every 2 min
    // during ext windows; a fresh relay file serves the whole demanded set in
    // ONE fetch. Direct per-symbol Yahoo below remains only as the local-dev /
    // relay-outage fallback.
    const relay = await this._fetchRelay();
    const relayAsof = relay && relay.asof_utc ? Date.parse(relay.asof_utc) : NaN;
    if (
      relay &&
      relay.quotes &&
      Number.isFinite(relayAsof) &&
      nowMs - relayAsof < R2_STALE_MS
    ) {
      let hit = 0;
      for (const sym of syms) {
        const e = relay.quotes[sym];
        if (e && typeof e.extPrice === "number" && Number.isFinite(e.extPrice)) {
          // The relay FILE speaks extPrice/extTs (it is shaped for the API response); the
          // CACHE speaks price/ts, which is what getExt/validExtEntry read. Writing the file's
          // own field names here made every relay hit invisible — validExtEntry rejected the
          // entry for having no finite price — while the early `return` below simultaneously
          // suppressed the direct-Yahoo calls that would otherwise have covered the gap. A
          // FRESH relay file therefore produced strictly LESS ext data than a stale one.
          boundedCacheSet(this._yahooCache, sym, {
            price: e.extPrice,
            ts: typeof e.extTs === "number" ? e.extTs : Math.floor(relayAsof / 1000),
            session,
            source: "yahoo-relay",
          });
          hit++;
        }
      }
      log.info("ext relay poll", `session=${session}`, `syms=${syms.length}`, `hits=${hit}`);
      return; // fresh relay consumed — no direct Yahoo calls this cycle
    }

    log.info("yahoo ext poll (direct)", `session=${session}`, `syms=${syms.length}`);

    // Fetch in parallel (each is a separate HTTP call; Yahoo has no batch chart endpoint).
    await Promise.all(
      syms.map(async (sym) => {
        const result = await this._fetchYahooExt(sym, nowMs);
        if (result) {
          boundedCacheSet(this._yahooCache, sym, { ...result, source: "yahoo_unofficial" });
        }
      })
    );
  }

  health() {
    if (this.disabled) return { disabled: true };
    return {
      mode: this.mode,
      extMapSize: this._extMap ? this._extMap.size : 0,
      yahooSubsSize: this._yahooSubs ? this._yahooSubs.size : 0,
      yahooCacheSize: this._yahooCache ? this._yahooCache.size : 0,
      alpaca: this.alpaca ? this.alpaca.health() : null,
      webull: this.webull ? this.webull.health() : { disabled: true },
    };
  }
}

module.exports = {
  ExtFeed,
  classifySession,
  yahooFetchExtPrice,
  AlpacaFeed,
  WebullFeed,
  webullExtractPrint,
  lruTouch,
  boundedCacheSet,
  ALPACA_LRU_CAP,
  WEBULL_LRU_CAP,
  EXT_CACHE_CAP,
  WEBULL_MAX_AGE_MS,
};
