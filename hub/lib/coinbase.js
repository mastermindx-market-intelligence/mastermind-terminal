"use strict";
// Coinbase exchange ws-feed (keyless) — rolling-24h crypto fallback.
//
// Verified live fields on wss://ws-feed.exchange.coinbase.com `ticker`:
//   type=ticker, product_id, price, open_24h, high_24h, low_24h, volume_24h, time (ISO).
// Crypto set is derived from the manifest (sym.endsWith("-USD")); products are literally BTC-USD.
//
// §0.6: Coinbase crypto chg/prevClose are rolling-24h (open_24h), NOT a session close. This is
// retained as a degraded fallback; OKX is the preferred UTC-0 comparison basis when healthy.
//
// Failure modes: exponential backoff min(30s,2^attempt) ±20% jitter; app-level ping every 20s
// with a 10s pong deadline (terminate → reconnect); an idle watchdog (>30s no message) forces a
// reconnect; on disconnect the store is NOT cleared (serve stale-but-timestamped). Full product
// list is resubscribed on every reconnect.

const WebSocket = require("ws");
const log = require("./log");

const URL = "wss://ws-feed.exchange.coinbase.com";
const PING_INTERVAL_MS = 20 * 1000;
const PONG_DEADLINE_MS = 10 * 1000;
const IDLE_WATCHDOG_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 1000;

class Coinbase {
  constructor(store, feedCoordinator) {
    this.store = store;
    this.coord = feedCoordinator; // exposes .cryptoPrimary and health hooks
    this.ws = null;
    this.products = [];
    this.attempt = 0;
    this.stopped = false;

    this.pingTimer = null;
    this.pongTimer = null;
    this.watchdogTimer = null;
    this.reconnectTimer = null;

    this.lastMsgAt = 0;
    this.connected = false;
    this.subscribedAt = 0; // when a clean subscribe ack / first ticker landed
  }

  // Derive BTC-USD, ETH-USD, … from the manifest symbol set.
  _products() {
    const out = [];
    for (const sym of this.store.manifest.syms) {
      if (sym.endsWith("-USD")) out.push(sym);
    }
    return out;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    this._clearTimers();
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected() { return this.connected; }
  // "healthy" for failover purposes = connected AND recently seen data.
  isHealthy() {
    return this.connected && (Date.now() - this.lastMsgAt) < IDLE_WATCHDOG_MS;
  }
  // Sustained-connection signal retained for feed health callers.
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
    const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
    return Math.max(1000, Math.round(base + jitter));
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    const wait = this._backoffMs();
    this.attempt++;
    log.every("coinbase-reconnect", "WARN", "coinbase reconnect in", `${wait}ms`, `attempt=${this.attempt}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, wait);
  }

  _connect() {
    if (this.stopped) return;
    this._clearTimers();
    this.products = this._products();
    if (this.products.length === 0) {
      log.warn("coinbase: no -USD products in manifest yet — retrying");
      this._scheduleReconnect();
      return;
    }

    let ws;
    try {
      ws = new WebSocket(URL);
    } catch (e) {
      log.error("coinbase ws construct failed", e.message);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.connected = false;
    this.subscribedAt = 0;

    ws.on("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.lastMsgAt = Date.now();
      log.info("coinbase connected", `products=${this.products.length}`);
      log.resetEvery("coinbase-reconnect");
      this._subscribe();
      this._startHeartbeat();
      this._armWatchdog();
    });

    ws.on("message", (buf) => {
      this.lastMsgAt = Date.now();
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      this._onMessage(msg);
    });

    ws.on("pong", () => {
      if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    });

    ws.on("error", (e) => {
      log.every("coinbase-error", "WARN", "coinbase ws error", e && e.message);
    });

    ws.on("close", (code) => {
      this.connected = false;
      this._clearTimers();
      log.every("coinbase-close", "WARN", "coinbase ws closed", `code=${code}`);
      this._scheduleReconnect();
    });
  }

  _subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = {
      type: "subscribe",
      channels: [{ name: "ticker", product_ids: this.products }],
    };
    try { this.ws.send(JSON.stringify(frame)); } catch (e) {
      log.warn("coinbase subscribe send failed", e.message);
    }
  }

  _onMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "subscriptions") {
      this.subscribedAt = Date.now();
      return;
    }
    if (msg.type === "error") {
      log.warn("coinbase feed error", msg.message || "");
      return;
    }
    if (msg.type !== "ticker") return;
    if (!msg.product_id) return;

    // Only the primary crypto feed writes to the store (OKX holds off unless it's primary).
    if (this.coord && this.coord.cryptoPrimary !== "coinbase") return;
    if (this.subscribedAt === 0) this.subscribedAt = Date.now();

    const last = Number(msg.price);
    if (!Number.isFinite(last)) return;
    const open24h = Number(msg.open_24h);
    const prevClose = Number.isFinite(open24h) && open24h !== 0 ? open24h : null;

    this.store.setQuote(msg.product_id, {
      last,
      prevClose, // crypto prevClose = 24h-open (§0.6); null → setQuote leaves chg null
      open: Number.isFinite(open24h) ? open24h : null,
      high: Number.isFinite(Number(msg.high_24h)) ? Number(msg.high_24h) : null,
      low: Number.isFinite(Number(msg.low_24h)) ? Number(msg.low_24h) : null,
      vol: Number.isFinite(Number(msg.volume_24h)) ? Number(msg.volume_24h) : null,
      ts: msg.time ? Math.floor(Date.parse(msg.time) / 1000) : Math.floor(Date.now() / 1000),
      live: true,
      source: "coinbase",
      market: "crypto",
      basis: "LIVE",
      changeBasis: "ROLLING_24H",
    });
  }

  _startHeartbeat() {
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try { this.ws.ping(); } catch {}
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        log.warn("coinbase pong timeout — terminating");
        try { this.ws.terminate(); } catch {}
      }, PONG_DEADLINE_MS);
    }, PING_INTERVAL_MS);
  }

  _armWatchdog() {
    this.watchdogTimer = setInterval(() => {
      if (!this.connected) return;
      if (Date.now() - this.lastMsgAt > IDLE_WATCHDOG_MS) {
        log.warn("coinbase idle watchdog fired (>30s no message) — terminating");
        try { this.ws.terminate(); } catch {}
      }
    }, IDLE_WATCHDOG_MS / 2);
  }

  health() {
    return {
      connected: this.connected,
      healthy: this.isHealthy(),
      products: this.products.length,
      lastMsgAt: this.lastMsgAt ? new Date(this.lastMsgAt).toISOString() : null,
      attempt: this.attempt,
    };
  }
}

module.exports = { Coinbase };
