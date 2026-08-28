"use strict";
// OKX public ws — UTC-0 crypto feed and perpetual companion lane. Only ONE crypto feed writes at
// a time (the coordinator's cryptoPrimary flag). The canonical -USD rows use OKX spot tickers;
// each row also carries the matching USDT perpetual ticker when OKX offers it. `sodUtc0` is the
// exchange's UTC-day open, so canonical chg is comparable with a TradingView-style 1D bar. The
// coordinator keeps Coinbase as a rolling-24h failover when OKX is unavailable.

const WebSocket = require("ws");
const log = require("./log");

const URL = "wss://ws.okx.com:8443/ws/v5/public";
const PING_INTERVAL_MS = 20 * 1000;
const PONG_DEADLINE_MS = 10 * 1000;
const IDLE_WATCHDOG_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 1000;

// BTC-USD → BTC-USDT / BTC-USDT-SWAP. Keep a reverse map so OKX instrument IDs are restamped
// back to the manifest's canonical -USD symbol.
function toSpotInst(sym) {
  const base = String(sym).replace(/-USD$/i, "");
  return `${base}-USDT`;
}
function toSwapInst(sym) {
  const base = String(sym).replace(/-USD$/i, "");
  return `${base}-USDT-SWAP`;
}
function parseInst(instId) {
  const s = String(instId || "").toUpperCase();
  if (s.endsWith("-USDT-SWAP")) {
    return { sym: `${s.slice(0, -"-USDT-SWAP".length)}-USD`, lane: "perp" };
  }
  if (s.endsWith("-USDT")) {
    return { sym: `${s.slice(0, -"-USDT".length)}-USD`, lane: "spot" };
  }
  return null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one OKX tickers row without touching the store. This is deliberately pure so the
 * UTC-day anchor and the spot/perpetual mapping remain unit-testable without a websocket.
 */
function parseOkxTicker(row) {
  const parsed = parseInst(row && row.instId);
  if (!parsed) return null;

  const last = num(row.last);
  if (last == null || last <= 0) return null;

  const sodUtc0 = num(row.sodUtc0);
  const open24h = num(row.open24h);
  const prevClose = sodUtc0 != null && sodUtc0 > 0
    ? sodUtc0
    : open24h != null && open24h > 0 ? open24h : null;
  const changeBasis = sodUtc0 != null && sodUtc0 > 0 ? "UTC_0" : "ROLLING_24H";
  const open = sodUtc0 != null && sodUtc0 > 0 ? sodUtc0 : open24h;
  const high = num(row.high24h);
  const low = num(row.low24h);
  const vol = num(row.vol24h);
  const ts = num(row.ts) != null ? Math.floor(num(row.ts) / 1000) : Math.floor(Date.now() / 1000);
  const chg = prevClose != null && prevClose !== 0 ? ((last - prevClose) / prevClose) * 100 : null;

  if (parsed.lane === "spot") {
    return {
      lane: "spot",
      sym: parsed.sym,
      last,
      prevClose,
      chg,
      open,
      high,
      low,
      vol,
      ts,
      live: true,
      source: "okx-spot",
      market: "crypto",
      basis: "LIVE",
      changeBasis,
    };
  }

  // Perpetuals are supplemental fields on the canonical spot row. Do not let a swap tick
  // overwrite the displayed spot price or its session anchor.
  return {
    lane: "perp",
    sym: parsed.sym,
    perpLast: last,
    perpPrevClose: prevClose,
    perpChg: chg,
    perpOpen: open,
    perpHigh: high,
    perpLow: low,
    perpVol: vol,
    perpTs: ts,
    perpChangeBasis: changeBasis,
    perpSource: "okx-swap",
  };
}

class OKX {
  constructor(store, feedCoordinator) {
    this.store = store;
    this.coord = feedCoordinator;
    this.ws = null;
    this.instIds = [];
    this.attempt = 0;
    this.stopped = true;
    this.connected = false;
    this.lastMsgAt = 0;
    this.subscribedAt = 0;

    this.pingTimer = null;
    this.pongTimer = null;
    this.watchdogTimer = null;
    this.reconnectTimer = null;
  }

  _instIds() {
    const out = [];
    for (const sym of this.store.manifest.syms) {
      if (sym.endsWith("-USD")) {
        out.push(toSpotInst(sym));
        out.push(toSwapInst(sym));
      }
    }
    return out;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    log.info("okx UTC-0 spot/perpetual feed ACTIVATED");
    this._connect();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    log.info("okx UTC-0 spot/perpetual feed stopped");
    this._clearTimers();
    if (this.ws) { try { this.ws.terminate(); } catch {} this.ws = null; }
    this.connected = false;
  }

  isConnected() { return this.connected; }

  isHealthy() {
    return this.connected && (Date.now() - this.lastMsgAt) < IDLE_WATCHDOG_MS;
  }

  recoveredFor(ms) {
    return this.connected && this.subscribedAt > 0 && (Date.now() - this.subscribedAt) >= ms;
  }

  _clearTimers() {
    for (const t of [this.pingTimer, this.pongTimer, this.watchdogTimer, this.reconnectTimer]) {
      if (t) clearTimeout(t) || clearInterval(t);
    }
    this.pingTimer = this.pongTimer = this.watchdogTimer = this.reconnectTimer = null;
  }

  _backoffMs() {
    const base = Math.min(MAX_BACKOFF_MS, Math.pow(2, this.attempt) * 1000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(1000, Math.round(base + jitter));
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const wait = this._backoffMs();
    this.attempt++;
    log.every("okx-reconnect", "WARN", "okx reconnect in", `${wait}ms`, `attempt=${this.attempt}`);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this._connect(); }, wait);
  }

  _connect() {
    if (this.stopped) return;
    this._clearTimers();
    this.instIds = this._instIds();
    if (this.instIds.length === 0) { this._scheduleReconnect(); return; }

    let ws;
    try { ws = new WebSocket(URL); } catch (e) {
      log.error("okx ws construct failed", e.message); this._scheduleReconnect(); return;
    }
    this.ws = ws;
    this.connected = false;

    ws.on("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.lastMsgAt = Date.now();
      this.subscribedAt = Date.now();
      log.info("okx connected", `insts=${this.instIds.length}`, "spot+perpetual");
      log.resetEvery("okx-reconnect");
      this._subscribe();
      this._startHeartbeat();
      this._armWatchdog();
    });

    ws.on("message", (buf) => {
      this.lastMsgAt = Date.now();
      const s = buf.toString();
      if (s === "pong") { if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; } return; }
      let msg; try { msg = JSON.parse(s); } catch { return; }
      this._onMessage(msg);
    });

    ws.on("error", (e) => log.every("okx-error", "WARN", "okx ws error", e && e.message));

    ws.on("close", (code) => {
      this.connected = false;
      this._clearTimers();
      log.every("okx-close", "WARN", "okx ws closed", `code=${code}`);
      this._scheduleReconnect();
    });
  }

  _subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const args = this.instIds.map((instId) => ({ channel: "tickers", instId }));
    try { this.ws.send(JSON.stringify({ op: "subscribe", args })); } catch (e) {
      log.warn("okx subscribe send failed", e.message);
    }
  }

  _onMessage(msg) {
    if (msg.event === "error") { log.warn("okx feed error", msg.msg || msg.code || ""); return; }
    if (!msg.data || !Array.isArray(msg.data)) return;
    if (this.coord && this.coord.cryptoPrimary !== "okx") return; // only primary writes

    for (const d of msg.data) {
      const quote = parseOkxTicker(d);
      if (!quote) continue;
      const { lane, ...partial } = quote;
      this.store.setQuote(quote.sym, partial);
    }
  }

  _startHeartbeat() {
    // OKX wants a literal "ping" text frame; server replies "pong".
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try { this.ws.send("ping"); } catch {}
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        log.warn("okx pong timeout — terminating");
        try { this.ws.terminate(); } catch {}
      }, PONG_DEADLINE_MS);
    }, PING_INTERVAL_MS);
  }

  _armWatchdog() {
    this.watchdogTimer = setInterval(() => {
      if (!this.connected) return;
      if (Date.now() - this.lastMsgAt > IDLE_WATCHDOG_MS) {
        log.warn("okx idle watchdog fired — terminating");
        try { this.ws.terminate(); } catch {}
      }
    }, IDLE_WATCHDOG_MS / 2);
  }

  health() {
    return {
      active: !this.stopped,
      connected: this.connected,
      healthy: this.isHealthy(),
      insts: this.instIds.length,
      lastMsgAt: this.lastMsgAt ? new Date(this.lastMsgAt).toISOString() : null,
      subscribedAt: this.subscribedAt ? new Date(this.subscribedAt).toISOString() : null,
    };
  }
}

module.exports = { OKX, parseOkxTicker, parseInst, toSpotInst, toSwapInst };
