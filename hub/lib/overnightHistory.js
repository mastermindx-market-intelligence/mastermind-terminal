"use strict";

// Historical U.S. overnight bars (Blue Ocean / BOATS) for the Quote Hub.
// Quote Hub remains the sole owner of Alpaca credentials and overnight history.
// Terminal receives only normalized bars + bounded evidence states.

const ET_TZ = "America/New_York";
const SOURCE = "alpaca-boats";
const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX = 256;
const HISTORICAL_DELAY_MS = 15 * 60_000;
const ALLOWED_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h"]);

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function realIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const ms = Date.parse(String(value) + "T00:00:00Z");
  if (!Number.isFinite(ms)) return null;
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  return roundTrip === value ? value : null;
}

function etParts(ms) {
  const p = {};
  for (const part of ET_FMT.formatToParts(ms)) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minuteOfDay: hour * 60 + minute,
    displayEpoch: Date.UTC(year, month - 1, day, hour, minute) / 1000,
  };
}

function etWallToUtcMs(dateStr, minuteOfDay) {
  if (!realIsoDate(dateStr) || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440) return NaN;
  const [year, month, day] = dateStr.split("-").map(Number);
  const naive = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const displayAtNaive = etParts(naive).displayEpoch * 1000;
  const offset = displayAtNaive - naive;
  return naive - offset;
}

function nextIsoDate(dateStr) {
  const valid = realIsoDate(dateStr);
  if (!valid) return "";
  return new Date(Date.parse(valid + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
}

function alpacaTimeframe(tf) {
  const value = String(tf || "");
  if (!ALLOWED_TIMEFRAMES.has(value)) return null;
  const m = /^(\d+)(m|h)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "m" ? `${n}Min` : `${n}Hour`;
}

function empty(status, note) {
  return {
    bars: [],
    source: SOURCE,
    status,
    ...(note ? { note } : {}),
  };
}

function validProviderBar(value) {
  if (!value || typeof value !== "object") return false;
  const ms = Date.parse(String(value.t || ""));
  const o = Number(value.o);
  const h = Number(value.h);
  const l = Number(value.l);
  const c = Number(value.c);
  const v = Number(value.v == null ? 0 : value.v);
  return Number.isFinite(ms)
    && [o, h, l, c, v].every(Number.isFinite)
    && o > 0 && h > 0 && l > 0 && c > 0 && v >= 0
    && h >= Math.max(o, c) && l <= Math.min(o, c) && h >= l;
}

class OvernightHistory {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || "";
    this.apiSecret = opts.apiSecret || "";
    this.disabled = opts.disabled === true || process.env.EXT_FEED_DISABLE === "1";
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.cacheMax = Number.isInteger(opts.cacheMax) && opts.cacheMax > 0 ? opts.cacheMax : DEFAULT_CACHE_MAX;
    this.cache = new Map();
    this.inflight = new Map();
    this.lastRequestAt = 0;
    this.lastStatus = this.apiKey && this.apiSecret ? "idle" : "not_configured";
  }

  health() {
    return {
      configured: !!(this.apiKey && this.apiSecret),
      disabled: this.disabled,
      cacheSize: this.cache.size,
      inflight: this.inflight.size,
      lastRequestAt: this.lastRequestAt ? new Date(this.lastRequestAt).toISOString() : null,
      lastStatus: this.lastStatus,
      source: SOURCE,
    };
  }

  cachePut(key, at, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, { at, value });
    while (this.cache.size > this.cacheMax) {
      const oldest = this.cache.keys().next().value;
      if (oldest == null) break;
      this.cache.delete(oldest);
    }
    return value;
  }

  async getWallDate(sym, tf, dateStr, nowMs = Date.now()) {
    const symbol = String(sym || "").trim().toUpperCase();
    if (this.disabled) {
      this.lastStatus = "unavailable";
      return empty("unavailable", "extended-hours feed is disabled");
    }
    if (!this.apiKey || !this.apiSecret) {
      this.lastStatus = "not_configured";
      return empty("not_configured", "overnight credentials are not configured on Quote Hub");
    }
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || !realIsoDate(dateStr)) {
      this.lastStatus = "unavailable";
      return empty("unavailable", "bad overnight history parameters");
    }

    const timeframe = alpacaTimeframe(tf);
    if (!timeframe) {
      this.lastStatus = "unavailable";
      return empty("unavailable", "unsupported BOATS timeframe");
    }

    const cacheKey = `${symbol}|${tf}|${dateStr}`;
    const hit = this.cache.get(cacheKey);
    if (hit && nowMs - hit.at < CACHE_TTL_MS) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, hit);
      return hit.value;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) return existing;

    const request = this.fetchWallDate(symbol, tf, timeframe, dateStr, nowMs, cacheKey)
      .finally(() => {
        if (this.inflight.get(cacheKey) === request) this.inflight.delete(cacheKey);
      });
    this.inflight.set(cacheKey, request);
    return request;
  }

  async fetchWallDate(symbol, tf, timeframe, dateStr, nowMs, cacheKey) {
    const startMs = etWallToUtcMs(dateStr, 0);
    const nextDate = nextIsoDate(dateStr);
    const wallEndMs = nextDate ? etWallToUtcMs(nextDate, 0) : NaN;
    const endMs = Math.min(wallEndMs, nowMs - HISTORICAL_DELAY_MS);
    if (!finite(startMs) || !finite(endMs) || endMs <= startMs) {
      const value = empty("empty");
      this.lastStatus = value.status;
      return this.cachePut(cacheKey, nowMs, value);
    }

    const params = new URLSearchParams({
      symbols: symbol,
      timeframe,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      adjustment: "split",
      feed: "boats",
      sort: "asc",
      limit: "1000",
    });

    this.lastRequestAt = nowMs;
    let response;
    try {
      response = await this.fetchImpl(
        `https://data.alpaca.markets/v2/stocks/bars?${params.toString()}`,
        {
          headers: {
            "APCA-API-KEY-ID": this.apiKey,
            "APCA-API-SECRET-KEY": this.apiSecret,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      const value = empty("unavailable", "overnight provider request failed");
      this.lastStatus = value.status;
      return this.cachePut(cacheKey, nowMs, value);
    }

    if (!response || !response.ok) {
      const status = response && Number.isInteger(response.status) ? response.status : null;
      const value = empty("unavailable", status ? `overnight provider HTTP ${status}` : "overnight provider rejected request");
      this.lastStatus = value.status;
      return this.cachePut(cacheKey, nowMs, value);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      const value = empty("unavailable", "overnight provider returned invalid JSON");
      this.lastStatus = value.status;
      return this.cachePut(cacheKey, nowMs, value);
    }

    if (!payload || typeof payload !== "object" || !payload.bars || typeof payload.bars !== "object" || Array.isArray(payload.bars)) {
      const value = empty("unavailable", "overnight provider returned invalid payload");
      this.lastStatus = value.status;
      return this.cachePut(cacheKey, nowMs, value);
    }
    if (payload.next_page_token) {
      const value = empty("unavailable", "overnight provider response exceeded the single-date bounded page");
      this.lastStatus = value.status;
      return this.cachePut(cacheKey, nowMs, value);
    }

    const raw = Array.isArray(payload.bars[symbol]) ? payload.bars[symbol] : [];
    const bars = [];
    for (const b of raw) {
      if (!validProviderBar(b)) continue;
      const ms = Date.parse(String(b.t));
      const display = etParts(ms);
      if (!(display.minuteOfDay < 4 * 60 || display.minuteOfDay >= 20 * 60)) continue;
      if (display.date !== dateStr) continue;
      bars.push([
        display.displayEpoch,
        Number(b.o),
        Number(b.h),
        Number(b.l),
        Number(b.c),
        Number(b.v == null ? 0 : b.v),
      ]);
    }

    bars.sort((a, b) => a[0] - b[0]);
    const uniq = [];
    let last = -1;
    for (const bar of bars) {
      if (bar[0] !== last) {
        uniq.push(bar);
        last = bar[0];
      }
    }

    const value = {
      bars: uniq,
      source: SOURCE,
      status: uniq.length ? "available" : "empty",
    };
    this.lastStatus = value.status;
    return this.cachePut(cacheKey, nowMs, value);
  }
}

module.exports = {
  OvernightHistory,
  alpacaTimeframe,
  etParts,
  etWallToUtcMs,
  realIsoDate,
};
