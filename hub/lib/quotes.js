"use strict";
// lib/quotes.js — symbol routing + GET /quotes response assembly.
//
// Extracted from hub.js so the response CONTRACT is unit-testable: hub.js boots an
// HTTP server and starts feed timers at require() time, so it can never be imported
// by a test. Everything here is pure apart from the injected feed objects.
//
// RESPONSE CONTRACT (unchanged by the macro merge):
//   flat { SYM: { ...quote } } — present entries only, missing symbols simply absent.
//
// ROUTING
//   daily-only (FRED series ids)     → NOTHING. No feed, no placeholder, absent from the
//                                       response so the caller serves the manifest EOD row.
//   macro (=F, =X, ^INDEX, DX-Y.NYB) → MacroFeed, which owns its own prevClose/chg
//                                       and never touches the Store or AnchorCache.
//   crypto (-USD) / us               → Store (+ ExtFeed merge for US outside RTH).
//   cn / hk / ca                     → not served (absent from the response).

const { isMacroSymbol } = require("./macrofeed");

/**
 * FRED series that print ONCE A DAY and have no live leg on this box at all.
 *
 * Bare series ids match neither isMacroSymbol nor any classify() branch, so they fell through
 * to "us" and were treated as US equities: a Polygon `AM.DFII10` subscription (one of 500 LRU
 * slots on a ticker Polygon does not carry), one of the 30 SHARED Alpaca/Webull ext slots, and
 * — worst — a store placeholder served as source "polygon-delayed" / basis "DELAYED_15M" /
 * ts:now. That is a 15-minute-freshness claim on a once-a-day print, and ChartPanel's
 * spliceDaily turned it into a synthetic flat bar dated today.
 *
 * Served from NOWHERE instead. Absent from /quotes → the terminal falls back to the manifest's
 * real daily close.
 *
 * KEEP IN SYNC with terminal/lib/macroSymbols.ts DAILY_ONLY — adding a FRED series means adding
 * it to BOTH routers (see the pointer beside _FRED_RATES in ingest/macro_catalog.py).
 */
const DAILY_ONLY = new Set(["DFII10", "DFII5", "T10YIE", "T5YIE"]);

/**
 * True when sym is a daily-print-only series with no live leg.
 * @param {string} sym
 * @returns {boolean}
 */
function isDailyOnlySymbol(sym) {
  if (!sym || typeof sym !== "string") return false;
  return DAILY_ONLY.has(sym.trim().toUpperCase());
}

/**
 * Market taxonomy, mirrored from intradaySources.ts. Only crypto & us are served
 * from the Store; macro symbols are routed by isMacroSymbol BEFORE this is consulted
 * (a bare `CL=F` or `^GSPC` would otherwise fall through to "us").
 *
 * @param {string} sym
 * @returns {'cn'|'hk'|'ca'|'crypto'|'us'}
 */
function classify(sym) {
  if (/\.(SS|SZ)$/i.test(sym)) return "cn";
  if (/\.HK$/i.test(sym)) return "hk";
  if (/\.TO$/i.test(sym)) return "ca";
  if (/-USD$/i.test(sym)) return "crypto";
  return "us";
}

/**
 * Parse the closed `view` query vocabulary (spec §5.2/§5.4, R1A-T).
 *
 * `full` is the ONLY default — an absent value is exactly `full`. Anything else that is
 * not the single literal "full" or "regular" (unknown, blank, repeated, conflicting, or a
 * non-array caller) is refused with `null` so hub.js can answer HTTP 400 with an opaque
 * error. This must run — and be validated — before syms are parsed, so a request with an
 * invalid view is rejected even when `syms` is empty.
 *
 * @param {unknown} rawValues  `url.searchParams.getAll("view")` — an array of every
 *                              repeated `view=` value on the query string.
 * @returns {"full"|"regular"|null}
 */
function parseQuoteView(rawValues) {
  if (!Array.isArray(rawValues)) return null;
  if (rawValues.length === 0) return "full";
  if (rawValues.length !== 1) return null;
  const value = String(rawValues[0] || "").trim().toLowerCase();
  return value === "full" || value === "regular" ? value : null;
}

/**
 * Run the per-request DEMAND pass: subscribe/warm every leg that will be asked to answer.
 *
 * Lives here rather than in hub.js so the routing it encodes is unit-testable — requiring
 * hub.js boots an HTTP server and every feed timer. hub.js calls this and nothing else.
 *
 * @param {string[]} syms
 * @param {number} nowMs
 * @param {object} deps
 * @param {object} [deps.polygon]      Polygon feed (US only)
 * @param {object} [deps.anchorCache]  AnchorCache, warmed fire-and-forget
 * @param {object} [deps.extFeed]      ExtFeed (US only)
 * @param {object} [deps.macroFeed]    MacroFeed (macro only)
 * @param {boolean} [deps.disableUS]   HUB_DISABLE_US
 * @param {object} [options]
 * @param {boolean} [options.includeExtended]  Default true (existing `full` behavior).
 *   `false` (`view=regular`) skips `extFeed.demand()` entirely, in every session — this
 *   branch is NOT clock-gated. SnapshotFeed/Polygon/AnchorCache demand is unaffected.
 */
function applyDemand(syms, nowMs, deps = {}, options = {}) {
  const { polygon, anchorCache, extFeed, macroFeed, snapshotFeed, disableUS } = deps;
  const includeExtended = options.includeExtended !== false;
  if (!Array.isArray(syms)) return;
  for (const sym of syms) {
    // Daily-only FRED series have NO leg here: not Polygon (no such ticker), not the ext feed
    // (a once-a-day print has no extended session), not the macro feed. Demanding one only
    // burns a shared LRU slot — 500 for Polygon, 30 for ext, both global across all users.
    if (isDailyOnlySymbol(sym)) continue;
    if (isMacroSymbol(sym)) {
      // macro → MacroFeed only. Polygon has no futures/index/FX entitlement here and the
      // AnchorCache has no daily file for them.
      if (macroFeed) macroFeed.demand(sym);
      continue;
    }
    if (classify(sym) !== "us") continue;
    // The REST snapshot leg is demanded for EVERY US symbol, independent of the Polygon
    // WebSocket's health and of `disableUS`: it is precisely the symbols the stream is not
    // carrying — idle-swept, LRU-evicted, or never yet delivered a bar — that would
    // otherwise fall back to the nightly manifest and show the previous session. It also
    // runs unconditionally of `includeExtended` — view=regular still needs a regular-session
    // print.
    if (snapshotFeed) snapshotFeed.demand(sym, nowMs);
    if (disableUS || !polygon || !polygon.isHealthy()) continue;
    polygon.ensureSubscribed(sym);
    // Fire-and-forget: resolve the anchor so the cache is warm for the next request.
    if (anchorCache) anchorCache.resolve(sym, nowMs).catch(() => {});
    // Demand ext subscription (LRU tracking, no-op when the feed is disabled or in RTH) —
    // but NEVER for view=regular: this is the first of the two closure boundaries. A public
    // 60s regular-view poll over up to 58 names must not churn the shared 30-slot ExtFeed LRU.
    if (includeExtended && extFeed) extFeed.demand(sym);
  }
}

/**
 * Assemble the /quotes response for a symbol list.
 *
 * @param {string[]} syms
 * @param {number} nowMs
 * @param {object} deps
 * @param {object} [deps.store]      Store instance (crypto + us)
 * @param {object} [deps.macroFeed]  MacroFeed instance
 * @param {object} [deps.extFeed]    ExtFeed instance, forwarded to store.getQuotes
 * @param {object} [options]
 * @param {boolean} [options.includeExtended]  Default true (existing `full` behavior).
 *   `false` (`view=regular`) is the SECOND closure boundary: `extFeed` is never forwarded
 *   to `store.getQuotes` (so the Store cannot merge a fresh ext read), AND every `ext*` key
 *   is stripped from every row of the assembled response in one final pass — including a
 *   legacy/poisoned Store row that already carried ext* keys from an earlier full-view
 *   request. The strip runs AFTER both the Store and macroFeed legs have joined `out`, and
 *   copies rather than mutates rows the Store may hold shared references to.
 * @returns {Object<string,object>} flat { SYM: quote }
 */
function buildQuotesResponse(syms, nowMs, deps = {}, options = {}) {
  const { store, macroFeed, extFeed, snapshotFeed } = deps;
  const includeExtended = options.includeExtended !== false;
  const out = {};
  if (!Array.isArray(syms) || syms.length === 0) return out;

  const storeSyms = [];
  const macroSyms = [];
  for (const sym of syms) {
    // Never served — and specifically never served the Store's manifest-derived placeholder,
    // which would stamp a once-a-day FRED print with ts:now and basis DELAYED_15M.
    if (isDailyOnlySymbol(sym)) continue;
    if (isMacroSymbol(sym)) {
      macroSyms.push(sym);
      continue;
    }
    const m = classify(sym);
    if (m === "crypto" || m === "us") storeSyms.push(sym);
  }

  if (store && storeSyms.length) {
    // view=regular passes `null` in place of extFeed: the Store never attempts an ext
    // read/merge for this request (closure boundary 1 on the response side — boundary 1
    // on the demand side is applyDemand's `includeExtended && extFeed` guard above).
    const served = store.getQuotes(storeSyms, nowMs, includeExtended ? extFeed : null, snapshotFeed);
    for (const sym of Object.keys(served)) out[sym] = served[sym];
  }

  // Macro quotes come straight from the feed — they carry prevClose/chg/basis
  // themselves and are never written into the Store.
  if (macroFeed && macroSyms.length) {
    const served = macroFeed.getAll(macroSyms, nowMs);
    for (const sym of Object.keys(served)) out[sym] = served[sym];
  }

  if (!includeExtended) {
    // Closure boundary 2: strip every ext* key from every row, unconditionally — this is
    // the FINAL pass over `out`, after every leg (Store + macroFeed) has joined, so it
    // catches a legacy Store row that already carries ext* keys even though no ExtFeed was
    // ever consulted for this request. Copy rather than mutate: `out[sym]` may be a
    // reference the Store persists internally (store.quotes.set(sym, fresh)).
    for (const sym of Object.keys(out)) {
      const row = out[sym];
      const clean = {};
      for (const key of Object.keys(row)) {
        if (!key.startsWith("ext")) clean[key] = row[key];
      }
      out[sym] = clean;
    }
  }

  return out;
}

const MAX_SYMS_PER_REQUEST_DEFAULT = Infinity;

/**
 * Route + assemble one GET /quotes request end-to-end — the endpoint-level seam.
 *
 * Lives here rather than in hub.js for exactly the same reason applyDemand/
 * buildQuotesResponse do: requiring hub.js boots an HTTP server and every feed timer, so
 * hub.js can never be required by a test. hub.js's handleQuotes() is a thin wrapper that
 * extracts the raw URLSearchParams and calls this — nothing else — so this IS the real
 * wiring a production request runs, not a parallel test-only reimplementation. That is
 * what lets a mutation to the view-vocabulary dispatch (e.g. "unknown view silently
 * becomes full", "default view becomes regular") be caught by a test that never boots a
 * server or opens a socket (spec §5.5's mandatory endpoint-level coverage).
 *
 * View is parsed and validated BEFORE the empty-syms early return, so
 * `?syms=&view=bogus` is HTTP 400, never an empty 200.
 *
 * @param {URLSearchParams} searchParams
 * @param {number} nowMs
 * @param {object} deps    forwarded verbatim to applyDemand/buildQuotesResponse
 * @param {number} [maxSyms]  symbol-count cap (hub.js's MAX_SYMS_PER_REQUEST); requests
 *   over the cap are truncated, matching the pre-existing hub.js behavior.
 * @returns {{status:number, body:object}}
 */
function handleQuotesRequest(searchParams, nowMs, deps = {}, maxSyms = MAX_SYMS_PER_REQUEST_DEFAULT) {
  const view = parseQuoteView(searchParams.getAll("view"));
  if (view == null) return { status: 400, body: { error: "invalid view" } };
  const options = { includeExtended: view === "full" };

  const raw = searchParams.get("syms") || "";
  let syms = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (syms.length === 0) return { status: 200, body: {} };
  if (syms.length > maxSyms) syms = syms.slice(0, maxSyms);

  applyDemand(syms, nowMs, deps, options);
  const out = buildQuotesResponse(syms, nowMs, deps, options);
  return { status: 200, body: out };
}

module.exports = {
  classify,
  isMacroSymbol,
  isDailyOnlySymbol,
  DAILY_ONLY,
  parseQuoteView,
  applyDemand,
  buildQuotesResponse,
  handleQuotesRequest,
};
