"use strict";

// Historical U.S. overnight bars (Blue Ocean / BOATS) for the Quote Hub.
//
// OWNERSHIP
// Quote Hub already owns all pre/post/overnight quote plumbing and the Alpaca credential
// surface. This module extends that SAME owner with bounded historical BOATS reads. Terminal
// remains a thin localhost proxy; it never receives or duplicates Alpaca credentials.
//
// OUTPUT CLOCK
// Terminal intraday bars use a "display epoch": ET wall-clock components encoded as UTC.
// Example: a true 13:30Z instant in EDT becomes 09:30Z for chart display. We emit that same
// convention here so BOATS bars can be merged losslessly with the canonical Massive/store bars.

const ET_TZ = "America/New_York";
const SOURCE = "alpaca-boats";
const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const HISTORICAL_DELAY_MS = 15 * 60_000;

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

// ET wall clock on dateStr -> true UTC instant. This mirrors Terminal's proven conversion.
// Midnight is safely outside the ambiguous DST transition hour.
function etWallToUtcMs(dateStr, minuteOfDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440) return NaN;
  const naive = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const displayAtNaive = etParts(naive).displayEpoch * 1000;
  const offset = displayAtNaive - naive;
  return naive - offset;
}

function nextIsoDate(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? new Date(ms + 86_400_000).toISOString().slice(0, 10) : "";
}

function alpacaTimeframe(tf) {
  const m = /^(\d+)(m|h)$/.exec(String(tf || ""));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
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

class OvernightHistory {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || "";
    this.apiSecret = opts.apiSecret || "";
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.cache = new Map();
    this.lastRequestAt = 0;
    this.lastStatus = this.apiKey && this.apiSecret ? "idle" : "not_configured";
  }

  health() {
    return {
      configured: !!(this.apiKey && this.apiSecret),
      cacheSize: this.cache.size,
      lastRequestAt: this.lastRequestAt ? new Date(this.lastRequestAt).toISOString() : null,
      lastStatus: this.lastStatus,
      source: SOURCE,
    };
  }

  async getWallDate(sym, tf, dateStr, nowMs = Date.now()) {
    const symbol = String(sym || "").trim().toUpperCase();
    if (!this.apiKey || !this.apiSecret) {
      this.lastStatus = "not_configured";
      return empty("not_configured", "Alpaca overnight credentials are not configured on Quote Hub");
    }
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
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
    if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.value;

    const startMs = etWallToUtcMs(dateStr, 0);
    const nextDate = nextIsoDate(dateStr);
    const wallEndMs = nextDate ? etWallToUtcMs(nextDate, 0) : NaN;
    // Alpaca historical data can lag live trading. Never ask the historical endpoint for the
    // most recent 15 minutes; that keeps current-day reads inside the documented delayed lane.
    const endMs = Math.min(wallEndMs, nowMs - HISTORICAL_DELAY_MS);
    if (!finite(startMs) || !finite(endMs) || endMs <= startMs) {
      const value = empty("empty");
      this.cache.set(cacheKey, { at: nowMs, value });
      this.lastStatus = value.status;
      return value;
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

    let response;
    this.lastRequestAt = nowMs;
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
    } catch (error) {
      const value = empty(
        "unavailable",
        error instanceof Error ? `alpaca-boats: ${error.message}` : "alpaca-boats network error",
      );
      this.cache.set(cacheKey, { at: nowMs, value });
      this.lastStatus = value.status;
      return value;
    }

    if (!response || !response.ok) {
      const value = empty("unavailable", `alpaca-boats ${response && response.status ? response.status : "error"}`);
      this.cache.set(cacheKey, { at: nowMs, value });
      this.lastStatus = value.status;
      return value;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      const value = empty("unavailable", "alpaca-boats invalid JSON");
      this.cache.set(cacheKey, { at: nowMs, value });
      this.lastStatus = value.status;
      return value;
    }

    const raw = payload && payload.bars && Array.isArray(payload.bars[symbol])
      ? payload.bars[symbol]
      : [];
    const bars = [];

    for (const b of raw) {
      const ms = Date.parse(String(b && b.t || ""));
      const o = Number(b && b.o);
      const h = Number(b && b.h);
      const l = Number(b && b.l);
      const c = Number(b && b.c);
      const v = Number(b && (b.v == null ? 0 : b.v));
      if (!Number.isFinite(ms) || ![o, h, l, c, v].every(Number.isFinite)) continue;

      const display = etParts(ms);
      // Defense in depth: this lane owns ONLY true overnight. If the provider feed ever changes,
      // pre/RTH/post prints cannot leak into the overlay and overwrite the canonical Massive lane.
      if (!(display.minuteOfDay < 4 * 60 || display.minuteOfDay >= 20 * 60)) continue;
      if (display.date !== dateStr) continue;
      bars.push([display.displayEpoch, o, h, l, c, v]);
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
    this.cache.set(cacheKey, { at: nowMs, value });
    this.lastStatus = value.status;
    return value;
  }
}

module.exports = {
  OvernightHistory,
  alpacaTimeframe,
  etParts,
  etWallToUtcMs,
};
