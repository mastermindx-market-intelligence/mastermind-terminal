"use strict";
// Mastermind Quote Hub — localhost-only crypto + delayed-US fan-out.
//
// Contract §2: 127.0.0.1:3100 only, own systemd unit, auto-restart.
//   GET /health  → feed states + map size + manifest mtime
//   GET /quotes?syms=CSV → {SYM:{...quote…}} (present entries only)
// Never public; Next routes proxy it.
//
// Feeds v1:
//   (a) crypto: OKX UTC-0 spot/perpetual ws-feed primary, Coinbase rolling-24h fallback
//       (one writer at a time; both sockets stay warm for fast failover)
//   (b) US: Polygon aggregate dynamic per-symbol subs — delayed AM.* by default, live A.*
//       when HUB_POLYGON_CLUSTER=live and RT-entitled (auto-demotes on denial), LRU 500,
//       chg vs session anchor
//   (c) macro: futures / caret indices / FX / DX-Y.NYB via lib/macrofeed.js — Sina global-futures
//       snapshot (near-live, basis LIVE) with a Yahoo-spark leg (DELAYED_15M) for what Sina does
//       not carry. Macro symbols bypass the Store, Polygon and the AnchorCache entirely.
//
// prevClose fix (2026-07-09): the manifest baseline is stale all day (swaps at ~03:00 UTC).
// An AnchorCache keyed by (sym, ET-session-date) resolves prevClose from:
//   (a) per-symbol daily file (last completed bar), (b) Polygon REST /v2/aggs/prev,
//   (c) manifest fallback with stale_anchor:true. The key rolls on ET-date change so a
//   long-running process CANNOT serve yesterday's anchor — cache miss forces re-resolve.
//
// Env kill-switches read at boot: HUB_DISABLE_US=1 / HUB_DISABLE_CRYPTO=1.

const http = require("node:http");
const path = require("node:path");

const log = require("./lib/log");
const { Store } = require("./lib/store");
const { AnchorCache } = require("./lib/anchor");
const { Coinbase } = require("./lib/coinbase");
const { OKX } = require("./lib/okx");
const { Polygon } = require("./lib/polygon");
const { ExtFeed } = require("./lib/extfeed");
const { MacroFeed } = require("./lib/macrofeed");
const { SnapshotFeed } = require("./lib/snapshot");
const {
  classify,
  isMacroSymbol,
  isDailyOnlySymbol,
  applyDemand,
  buildQuotesResponse,
} = require("./lib/quotes");

const HOST = "127.0.0.1";
const PORT = parseInt(process.env.HUB_PORT || "3100", 10);
const MANIFEST_PATH =
  process.env.MANIFEST_PATH ||
  "/opt/terminal/terminal/public/data/manifest.json";
// Per-symbol daily files live next to the manifest.
const DATA_DIR =
  process.env.HUB_DATA_DIR ||
  path.dirname(MANIFEST_PATH);

const DISABLE_US = process.env.HUB_DISABLE_US === "1";
const DISABLE_CRYPTO = process.env.HUB_DISABLE_CRYPTO === "1";
// Extended-hours feed (ext fields on US quotes outside RTH).
// Kill-switch: EXT_FEED_DISABLE=1. Requires ALPACA_API_KEY + ALPACA_API_SECRET for ws leg;
// falls back to Yahoo unofficial REST polling if keys absent.
const extFeed = new ExtFeed({
  alpacaKey: process.env.ALPACA_API_KEY || "",
  alpacaSecret: process.env.ALPACA_API_SECRET || "",
});

// Macro feed (futures / indices / FX / dollar index). Keyless — no env required.
// Kill-switch: MACRO_FEED_DISABLE=1 (read inside the constructor).
const macroFeed = new MacroFeed();

// REST snapshot leg — today's session for US symbols the aggregate stream is not carrying.
// The stream idle-sweeps subscriptions after 30 minutes, so this is the normal state for
// anything outside the flagship 37; without this leg those symbols fall back to the
// NIGHTLY manifest and display the previous session's close. Kill-switch:
// HUB_DISABLE_SNAPSHOT=1 (reverts to exactly the pre-2026-08-07 behaviour).
//
// HUB_REALTIME_QUOTES=1 additionally puts the leg in real-time mode: an 8s poll and a
// last-trade parse. It does NOT make the output claim to be real-time — snapshot.verdict()
// measures print age against the wall clock and the store stamps the basis from that. With the
// flag off, this file behaves exactly as it did before 2026-08-08.
const snapshotFeed = new SnapshotFeed({
  apiKey: process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || "",
  disabled: process.env.HUB_DISABLE_SNAPSHOT === "1",
  realtime: process.env.HUB_REALTIME_QUOTES === "1",
});

const MAX_SYMS_PER_REQUEST = 200;
const FAILOVER_MS = 60 * 1000; // OKX unhealthy for 60s → Coinbase rolling-24h fallback
const OKX_WARMUP_MS = 5 * 1000; // require a short clean OKX window before switching primary

// ── Feed coordinator: exactly one crypto feed writes at a time ──
const coordinator = { cryptoPrimary: "coinbase" };

// ── Anchor cache: session-date–keyed prevClose resolution ──
// Must be created before Store so getManifest can reference store.manifest.
let store; // forward ref needed for getManifest closure
const anchorCache = new AnchorCache({
  dataDir: DATA_DIR,
  apiKey: process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || "",
  getManifest: () => store ? store.manifest : null,
});

store = new Store(MANIFEST_PATH, anchorCache);
store.loadManifestIfStale(true); // force initial load at boot

let coinbase = null;
let okx = null;
let polygon = null;

// classify() / isMacroSymbol() / buildQuotesResponse() live in lib/quotes.js so the
// response contract can be unit-tested (this file boots servers at require time).

// ── Crypto primary supervisor ──
// Start on Coinbase so a cold boot has a useful quote immediately. Once OKX has a clean,
// sustained connection it becomes primary and supplies the UTC-0 basis. If OKX goes quiet,
// Coinbase remains warm and takes over only after a bounded outage window.
let okxUnhealthySince = 0;
let okxHealthySince = 0;
function superviseCrypto() {
  if (DISABLE_CRYPTO || !coinbase || !okx) return;
  const now = Date.now();
  const okxHealthy = okx.isHealthy();

  if (okxHealthy) {
    okxUnhealthySince = 0;
    if (okxHealthySince === 0) okxHealthySince = now;
    if (now - okxHealthySince >= OKX_WARMUP_MS && coordinator.cryptoPrimary !== "okx") {
      coordinator.cryptoPrimary = "okx";
      log.info("crypto primary → OKX spot/UTC-0; perpetual lane attached");
    }
    return;
  }

  okxHealthySince = 0;
  if (okxUnhealthySince === 0) okxUnhealthySince = now;
  if (now - okxUnhealthySince >= FAILOVER_MS && coinbase.isHealthy() && coordinator.cryptoPrimary !== "coinbase") {
    coordinator.cryptoPrimary = "coinbase";
    log.warn("crypto failover → Coinbase rolling-24h (OKX unhealthy >60s)");
  }
}

// ── HTTP handlers ──
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}

function handleHealth(res) {
  const ok =
    (DISABLE_CRYPTO || (coinbase && coinbase.isConnected()) || (okx && okx.isConnected())) &&
    (DISABLE_US || (polygon && polygon.isHealthy()));
  sendJSON(res, 200, {
    ok: !!ok,
    port: PORT,
    quotes: store.quotes.size,
    manifest: {
      path: MANIFEST_PATH,
      mtime: store.manifest.mtimeMs ? new Date(store.manifest.mtimeMs).toISOString() : null,
      symbols: store.manifest.syms.size,
    },
    anchorCache: {
      size: anchorCache._cache.size,
      dataDir: DATA_DIR,
    },
    cryptoPrimary: coordinator.cryptoPrimary,
    coinbase: coinbase ? coinbase.health() : { disabled: DISABLE_CRYPTO },
    okx: okx ? okx.health() : { disabled: DISABLE_CRYPTO },
    polygon: polygon ? polygon.health() : { disabled: DISABLE_US },
    extFeed: extFeed.health(),
    macroFeed: macroFeed.health(),
    snapshotFeed: snapshotFeed.stats(),
    ts: Math.floor(Date.now() / 1000),
  });
}

function handleQuotes(res, url) {
  const raw = url.searchParams.get("syms") || "";
  let syms = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (syms.length === 0) return sendJSON(res, 200, {});
  if (syms.length > MAX_SYMS_PER_REQUEST) syms = syms.slice(0, MAX_SYMS_PER_REQUEST);

  // Lazily refresh manifest (rate-limited internally).
  store.loadManifestIfStale(false);

  const now = Date.now();

  // Demand pass (routing lives in lib/quotes.js so it can be unit-tested).
  //   daily-only → nothing at all. A FRED series id must never reach polygon.ensureSubscribed /
  //                anchorCache.resolve / extFeed.demand / macroFeed.demand: no leg carries it,
  //                and each one would spend a globally-shared LRU slot on a once-a-day print.
  //   macro      → MacroFeed only (Polygon has no futures/index/FX entitlement here, and the
  //                AnchorCache has no daily file for them).
  //   us         → Polygon sub + warm the anchor cache + ext LRU tracking.
  applyDemand(syms, now, {
    polygon, anchorCache, extFeed, macroFeed, snapshotFeed, disableUS: DISABLE_US,
  });

  // macro → served from MacroFeed; crypto/us → served from the Store; cn/hk/ca → absent.
  // Response contract is unchanged: a flat { SYM: quote } object, present entries only.
  const out = buildQuotesResponse(syms, now, { store, macroFeed, extFeed, snapshotFeed });
  sendJSON(res, 200, out);
}

const server = http.createServer((req, res) => {
  // DNS-rebind defense: only accept loopback Host headers.
  const host = (req.headers.host || "").toLowerCase();
  const hostOk =
    host === `127.0.0.1:${PORT}` ||
    host === `localhost:${PORT}` ||
    host === "127.0.0.1" ||
    host === "localhost";
  if (!hostOk) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    return sendJSON(res, 400, { error: "bad url" });
  }

  if (req.method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });

  try {
    if (url.pathname === "/health") return handleHealth(res);
    if (url.pathname === "/quotes") return handleQuotes(res, url);
    return sendJSON(res, 404, { error: "not found" });
  } catch (e) {
    log.error("request handler error", url.pathname, e && e.message);
    return sendJSON(res, 500, { error: "internal" });
  }
});

// ── Boot sequence ──
function boot() {
  log.info(
    "hub booting",
    `port=${PORT}`,
    `manifest=${MANIFEST_PATH}`,
    `dataDir=${DATA_DIR}`,
    `disableUS=${DISABLE_US}`,
    `disableCrypto=${DISABLE_CRYPTO}`
  );

  if (!DISABLE_CRYPTO) {
    coinbase = new Coinbase(store, coordinator);
    okx = new OKX(store, coordinator);
    coinbase.start();
    okx.start(); // warm the UTC-0 primary and its perpetual companion lane
  } else {
    log.warn("HUB_DISABLE_CRYPTO=1 — crypto feeds off");
  }

  if (!DISABLE_US) {
    const apiKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || "";
    polygon = new Polygon(store, apiKey, extFeed);
    polygon.start(); // authenticates; no subs until first /quotes request
  } else {
    log.warn("HUB_DISABLE_US=1 — US feed off");
  }

  // Extended-hours feed (alpaca overnight ws / webull / yahoo fallback).
  extFeed.start();

  // Macro feed (sina near-live + yahoo-spark delayed). No subs until first /quotes demand.
  macroFeed.start();

  server.listen(PORT, HOST, () => {
    log.info("hub READY", `listening on ${HOST}:${PORT}`);
  });

  server.on("error", (e) => {
    log.error("http server error", e && e.message);
    process.exit(1);
  });

  // Background intervals: prune stale entries + supervise crypto failover + prune anchor cache.
  setInterval(() => store.pruneIdle(Date.now()), 60 * 1000);
  setInterval(superviseCrypto, 5 * 1000);
  setInterval(() => anchorCache.prune(Date.now()), 60 * 60 * 1000); // prune stale session keys hourly
}

// Never let an unhandled error take down the loopback service silently.
process.on("uncaughtException", (e) => {
  log.error("uncaughtException", e && e.stack ? e.stack.split("\n")[0] : String(e));
});
process.on("unhandledRejection", (e) => {
  log.error("unhandledRejection", e && e.message ? e.message : String(e));
});

boot();

// Re-exported for test harnesses; the implementations live in lib/quotes.js because
// requiring this file boots the HTTP server and every feed timer.
module.exports = { classify, isMacroSymbol, isDailyOnlySymbol, applyDemand, buildQuotesResponse };
