"use strict";
const { completedSessionDate } = require("./snapshot");
// lib/anchor.js — session prevClose anchor resolution for US equities.
//
// Root cause: the nightly pipeline rebuilds manifest.json over ~4 hours and ATOMICALLY
// swaps it only at the very end (~03:00 UTC). For the entire RTH session the manifest
// `last`/`chg` reflects YESTERDAY's close, so deriving prevClose = manifestLast /
// (1 + manifestChg/100) produces the close two days ago — an off-by-one-session error.
//
// Fix: key every anchor by (sym, session_date). The session_date is the ET calendar date
// for which this anchor is the "previous close" (i.e. the prior trading day). A process
// alive across a session boundary gets a cache MISS on the new key and re-resolves fresh.
//
// Resolution order (per brief §2):
//   (a) Per-symbol daily file — last completed bar whose date < today-ET (yesterday's
//       close during RTH; today's close after the daily file rolls for after-hours).
//   (b) Polygon REST /v2/aggs/ticker/<SYM>/prev — cheap, cache per session.
//   (c) Manifest-derived as last resort; emits stale_anchor:true.
//
// AH semantics (per brief §3): after market close on a session day where today's bar is
// already in the daily file, the returned object carries:
//   close      — the official session close (index 4 of the last bar)
//   afterHours — the latest delayed print when it differs from close by >$0.01
//   anchor_source — "daily_file" | "polygon_prev" | "manifest"
//
// All async I/O is fire-and-forget during the synchronous quote-serve path; callers that
// need accurate chg should await resolveAnchor() before emitting the quote.

const fs = require("fs");
const https = require("https");
const log = require("./log");

// A daily bar can roll from "yesterday is the tail" to "today is the tail" without
// changing the ET session-date cache key. Re-stat active symbols often enough to catch
// that same-session atomic swap, while still bounding filesystem work across clients.
const DAILY_FILE_CHECK_MIN_INTERVAL = 5 * 1000;

// ET date formatter — same logic as polygon.js:etDate.
const ET_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
});
function etDate(ms) {
  const p = {};
  for (const part of ET_DATE_FMT.formatToParts(ms)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

// Is now-ET inside regular trading hours (09:30–16:00)?
function isRTH(nowMs) {
  const d = new Date(nowMs);
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(d);
  const p = {};
  for (const part of et) p[part.type] = Number(part.value);
  const mins = p.hour * 60 + p.minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// Parse a daily-file bar array [date, open, high, low, close, vol].
function parseBar(b) {
  if (!Array.isArray(b) || b.length < 5) return null;
  return { date: b[0], open: b[1], high: b[2], low: b[3], close: b[4], vol: b[5] ?? 0 };
}

class AnchorCache {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir   — directory containing <SYM>.json daily files
   * @param {string} opts.apiKey    — Polygon API key (may be empty → skip REST fallback)
   * @param {() => object} opts.getManifest — returns the current manifest object
   */
  constructor({ dataDir, apiKey, getManifest }) {
    this.dataDir = dataDir;
    this.apiKey = apiKey || "";
    this.getManifest = getManifest;

    // cache: Map< `${sym}::${sessionDate}` → { prevClose, close?, afterHours?, anchor_source, stale_anchor? } >
    // sessionDate = ET date for which this entry is the prevClose (today's ET date during the session).
    this._cache = new Map();
    // in-flight Polygon REST promises to avoid parallel requests for the same sym.
    this._inflight = new Map();
    // Accepted daily-file identity + last stat time for each session key. The file
    // normally swaps once after the close; tracking dev/ino/size/mtime catches both
    // atomic rename and in-place replacement without statting on every quote read.
    this._dailyVersions = new Map();
    this._dailyCheckedAt = new Map();
  }

  // Synchronous fast path: returns the anchor for (sym, today-ET) or null.
  // A bounded file-version check refreshes a cached anchor when today's bar rolls.
  get(sym, nowMs) {
    const sessionDate = etDate(nowMs);
    const key = `${sym}::${sessionDate}`;
    const hit = this._cache.get(key) || null;
    if (!hit) return null;

    const lastCheck = this._dailyCheckedAt.get(key) || 0;
    if (nowMs - lastCheck < DAILY_FILE_CHECK_MIN_INTERVAL) return hit;
    this._dailyCheckedAt.set(key, nowMs);

    const currentVersion = this._dailyFileVersion(sym);
    const acceptedVersion = this._dailyVersions.get(key);
    if (currentVersion === acceptedVersion) return hit;

    // _fromDailyFile is synchronous (all of its I/O is readFileSync/statSync), so
    // the first request after a roll receives the corrected close immediately.
    const refreshed = this._fromDailyFile(sym, sessionDate, nowMs);
    if (!refreshed) return hit; // corrupt/in-flight replacement: retain last-good and retry
    this._cache.set(key, refreshed);
    log.info("anchor refreshed after daily-file roll", sym, `sessionDate=${sessionDate}`);
    return refreshed;
  }

  // Async: ensure anchor for (sym, today-ET) is resolved and return it.
  // Safe to call concurrently for the same sym — in-flight coalesces.
  async resolve(sym, nowMs) {
    const sessionDate = etDate(nowMs);
    const key = `${sym}::${sessionDate}`;
    const hit = this.get(sym, nowMs);
    if (hit) return hit;

    // Coalesce concurrent resolves for the same key.
    if (this._inflight.has(key)) return this._inflight.get(key);

    const p = this._resolve(sym, sessionDate, nowMs).then((anchor) => {
      this._cache.set(key, anchor);
      this._inflight.delete(key);
      return anchor;
    }).catch((e) => {
      this._inflight.delete(key);
      log.warn("anchor.resolve error", sym, e && e.message);
      const fallback = this._manifestFallback(sym);
      this._cache.set(key, fallback);
      return fallback;
    });
    this._inflight.set(key, p);
    return p;
  }

  // Prune stale sessions (keys whose sessionDate != today-ET). Call hourly.
  prune(nowMs) {
    const today = etDate(nowMs);
    let pruned = 0;
    for (const k of this._cache.keys()) {
      if (!k.endsWith(`::${today}`)) { this._cache.delete(k); pruned++; }
    }
    for (const k of this._dailyVersions.keys()) {
      if (!k.endsWith(`::${today}`)) this._dailyVersions.delete(k);
    }
    for (const k of this._dailyCheckedAt.keys()) {
      if (!k.endsWith(`::${today}`)) this._dailyCheckedAt.delete(k);
    }
    if (pruned) log.info("anchor cache pruned", pruned, "stale sessions");
  }

  // ── Internal ──

  async _resolve(sym, sessionDate, nowMs) {
    // (a) Daily file
    const fromFile = this._fromDailyFile(sym, sessionDate, nowMs);
    if (fromFile) return fromFile;

    // (b) Polygon REST
    if (this.apiKey) {
      const fromRest = await this._fromPolygonPrev(sym).catch(() => null);
      if (fromRest) return fromRest;
    }

    // (c) Manifest fallback
    return this._manifestFallback(sym);
  }

  _dailyFileVersion(sym) {
    try {
      const st = fs.statSync(`${this.dataDir}/${sym}.json`);
      return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      return null;
    }
  }

  _fromDailyFile(sym, sessionDate, nowMs) {
    const fpath = `${this.dataDir}/${sym}.json`;
    const key = `${sym}::${sessionDate}`;
    this._dailyCheckedAt.set(key, nowMs);
    const versionBefore = this._dailyFileVersion(sym);
    if (versionBefore == null) {
      this._dailyVersions.set(key, null);
      return null;
    }
    let raw;
    try {
      raw = fs.readFileSync(fpath, "utf8");
    } catch {
      return null; // file absent
    }

    // If an atomic replacement raced our read, reject this pass and retry after
    // the bounded check interval rather than pairing old contents with a new stamp.
    const versionAfter = this._dailyFileVersion(sym);
    if (versionAfter !== versionBefore) return null;

    let data;
    try { data = JSON.parse(raw); } catch { return null; }

    const bars = (data && data.bars) || [];
    if (bars.length < 2) return null;

    // Find the last two usable bars.
    // "Last completed bar whose date < today-ET" = the bar immediately before today's bar.
    // If today's bar is already present (daily file rolled), prevClose = second-to-last bar's close;
    // if today's bar is absent (RTH, file hasn't rolled yet), prevClose = last bar's close.
    const parsedBars = bars.map(parseBar).filter(Boolean);
    if (parsedBars.length < 2) return null;

    const last = parsedBars[parsedBars.length - 1];
    const prev = parsedBars[parsedBars.length - 2];

    let prevClose, todayClose, afterHours, prevSessionChg;

    if (last.date === sessionDate) {
      // Today's bar is present in the file — post-close / after-hours scenario.
      // prevClose = second-to-last bar (yesterday).
      prevClose = prev.close;
      todayClose = last.close;
      // afterHours: only meaningful outside RTH. We don't have a live AH print in the
      // daily file itself (it only carries EOD close); callers inject the AM-feed last.
      // Emit close field so the caller can set afterHours from the live quote.
      afterHours = null; // will be overlaid by polygon.js AM last
      // prevSessionChg: today's bar is already the reference; compute vs yesterday.
      // (today's official close − yesterday's close) / yesterday's close × 100
      if (prevClose && Number.isFinite(prevClose) && prevClose !== 0) {
        prevSessionChg = (todayClose - prevClose) / prevClose * 100;
      }
    } else {
      // Daily file hasn't rolled for today yet (typical during RTH or overnight).
      // prevClose = last bar's close (= yesterday's close).
      prevClose = last.close;
      todayClose = null;
      // prevSessionChg: yesterday's move = (last bar − second-to-last bar) / second-to-last.
      // This is used by getQuotes overnight (no live session print) to show the last
      // completed session's change instead of a flat 0.00%.
      if (prev.close && Number.isFinite(prev.close) && prev.close !== 0) {
        prevSessionChg = (last.close - prev.close) / prev.close * 100;
      }
    }

    if (!prevClose || !Number.isFinite(prevClose)) return null;

    const anchor = { prevClose, anchor_source: "daily_file" };
    // Preserve actual bar identity separately from the rolled regular anchor.
    // Today's row can be incomplete before the calendar close; it is never the
    // completed reference merely because its date equals today's ET date.
    const completedDate = completedSessionDate(nowMs);
    const ordered = parsedBars.every((bar, i) =>
      typeof bar.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bar.date) &&
      bar.date <= sessionDate && (!i || parsedBars[i - 1].date < bar.date));
    const completed = ordered && parsedBars.find(bar => bar.date === completedDate);
    if (completed && Number.isFinite(completed.close) && completed.close > 0) {
      anchor.completedRegularClose = completed.close;
      anchor.completedRegularSessionDate = completed.date;
      // Existing daily-file reference contract; this is not vendor attribution.
      anchor.completedRegularSource = "daily_file";
    }
    if (todayClose != null) { anchor.close = todayClose; }
    if (afterHours != null) { anchor.afterHours = afterHours; }
    if (prevSessionChg != null && Number.isFinite(prevSessionChg)) {
      anchor.prevSessionChg = prevSessionChg;
    }
    this._dailyVersions.set(key, versionAfter);
    log.every(`anchor-${sym}`, "DEBUG", "anchor from daily_file", sym, `prevClose=${prevClose}`, `sessionDate=${sessionDate}`);
    return anchor;
  }

  async _fromPolygonPrev(sym) {
    return new Promise((resolve, reject) => {
      const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sym)}/prev?adjusted=true&apiKey=${this.apiKey}`;
      const req = https.get(url, { timeout: 5000 }, (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            const result = j && j.results && j.results[0];
            if (!result || !result.c) return resolve(null);
            const prevClose = result.c;
            if (!Number.isFinite(prevClose)) return resolve(null);
            resolve({ prevClose, anchor_source: "polygon_prev" });
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("polygon prev timeout")); });
    });
  }

  _manifestFallback(sym) {
    const manifest = this.getManifest && this.getManifest();
    if (!manifest) return { prevClose: null, anchor_source: "manifest", stale_anchor: true };
    const prevCloseBySym = manifest.prevCloseBySym;
    if (!prevCloseBySym) return { prevClose: null, anchor_source: "manifest", stale_anchor: true };
    const prevClose = prevCloseBySym.get(sym) || null;
    return { prevClose, anchor_source: "manifest", stale_anchor: true };
  }
}

module.exports = { AnchorCache, etDate, isRTH };
