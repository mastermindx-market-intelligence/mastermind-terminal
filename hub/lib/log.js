"use strict";
// Leveled logger → stdout → journald. NEVER logs the Polygon key.
// Rate-limits repetitive reconnect-style messages (1st + every 10th) so a flapping
// upstream can't drown the journal, and tallies routine high-volume events (subscription
// LRU evictions) into one INFO summary per key per window.

const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const THRESHOLD = LEVELS[(process.env.HUB_LOG_LEVEL || "INFO").toUpperCase()] ?? LEVELS.INFO;

// Guard against ever emitting the Polygon API key. If it appears verbatim in a
// formatted line, redact it. Cheap belt-and-suspenders on top of "never pass it in".
const SECRET = process.env.POLYGON_API_KEY || "";

// Rate-limit registry: key → count seen. Emit on the 1st and every 10th thereafter.
const _rl = new Map();

// Tally registry: key → { n, last, since, timer } for the window that opened at `since`.
// ExtFeed.demand runs for every US symbol on every /quotes request, so with more than 30
// symbols in play the feeds evict on most calls. One INFO line per eviction wrote ~500k
// syslog lines (~70 MB) a day on the VPS root disk (2026-11-01).
const TALLY_WINDOW_MS = 60_000;
const _tallies = new Map();

function _redact(s) {
  if (SECRET && s.indexOf(SECRET) !== -1) {
    return s.split(SECRET).join("***REDACTED***");
  }
  // Defensive: scrub any apiKey=... / "params":"<long-token>" style leaks regardless of source.
  return s
    .replace(/(apiKey=)[^&\s"']+/gi, "$1***")
    .replace(/("?params"?\s*[:=]\s*"?)[A-Za-z0-9_\-]{16,}("?)/g, "$1***$2");
}

function _fmt(level, args) {
  const parts = args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  });
  const line = `${new Date().toISOString()} [${level}] ${parts.join(" ")}`;
  return _redact(line);
}

function _emit(level, args) {
  if (LEVELS[level] > THRESHOLD) return;
  const line = _fmt(level, args);
  if (level === "ERROR" || level === "WARN") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function _flushTally(key) {
  const t = _tallies.get(key);
  if (!t) return;
  _tallies.delete(key);
  clearTimeout(t.timer);
  _emit("INFO", [key, `x${t.n} in ${TALLY_WINDOW_MS / 1000}s window (last ${t.last})`]);
}

const log = {
  info: (...a) => _emit("INFO", a),
  warn: (...a) => _emit("WARN", a),
  error: (...a) => _emit("ERROR", a),
  // Rate-limited variant for reconnect/backoff spam. `key` groups related messages.
  every: (key, level, ...a) => {
    const n = (_rl.get(key) || 0) + 1;
    _rl.set(key, n);
    if (n === 1 || n % 10 === 0) {
      _emit(level, [...a, `(occurrence #${n})`]);
    }
  },
  // Reset a rate-limit counter (e.g. after a successful connect so the next failure logs).
  resetEvery: (key) => { _rl.delete(key); },
  debug: (...a) => _emit("DEBUG", a),
  // Counted variant for routine high-volume events: each occurrence logs at DEBUG only, and
  // ONE INFO line per key reports the count TALLY_WINDOW_MS after the window's first event.
  tally: (key, item) => {
    _emit("DEBUG", [key, item]);
    let t = _tallies.get(key);
    // The timer normally closes the window; this catches one a stalled event loop left open.
    if (t && Date.now() - t.since >= TALLY_WINDOW_MS) { _flushTally(key); t = null; }
    if (!t) {
      t = { n: 0, last: null, since: Date.now(), timer: setTimeout(() => _flushTally(key), TALLY_WINDOW_MS) };
      // Never keep the process (or a test run) alive just to report a count.
      if (typeof t.timer.unref === "function") t.timer.unref();
      _tallies.set(key, t);
    }
    t.n++;
    t.last = item;
  },
  // Emit every open tally now (tests).
  flushTallies: () => { for (const key of [..._tallies.keys()]) _flushTally(key); },
  TALLY_WINDOW_MS,
};

module.exports = log;
