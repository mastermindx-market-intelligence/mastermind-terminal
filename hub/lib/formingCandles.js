"use strict";

// A chart-only materialization of Polygon A windows. REST owns a closed-minute
// prefix; the socket owns a disjoint suffix. Never add a second to an opaque
// REST minute. The consumer resamples UTC components with its existing calendar.
const { randomUUID } = require("node:crypto");
const { etDate } = require("./usSession");
const MINUTE = 60_000;
const SECOND_RETENTION_MS = 5 * MINUTE;
const IDLE_MS = 10 * MINUTE;
const MAX_SYMBOLS = 64;
const MAX_MINUTES = 1440;

function validBar(b) {
  return b && Number.isSafeInteger(b.t) && b.t > 0 &&
    [b.o, b.h, b.l, b.c].every(n => Number.isFinite(n) && n > 0) &&
    Number.isFinite(b.v) && b.v >= 0 &&
    b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c) && b.h >= b.l;
}
function fold(rows) {
  if (!rows.length) return null;
  const ordered = rows.slice().sort((a, b) => a.t - b.t);
  return { t: ordered[0].t, o: ordered[0].o, h: Math.max(...ordered.map(b => b.h)),
    l: Math.min(...ordered.map(b => b.l)), c: ordered[ordered.length - 1].c,
    v: ordered.reduce((n, b) => n + b.v, 0) };
}
const same = (a, b) => a && ["t", "o", "h", "l", "c", "v"].every(k => a[k] === b[k]);
const tuple = b => [b.t, b.o, b.h, b.l, b.c, b.v];

class FormingCandles {
  constructor({ fetchMinutes = null, now = Date.now } = {}) {
    this.fetchMinutes = fetchMinutes;
    this.now = now;
    this.states = new Map();
  }

  demand(sym, now = this.now()) {
    for (const [key, value] of this.states) {
      if (now - value.demandAt > IDLE_MS) this.states.delete(key);
    }
    let s = this.states.get(sym);
    if (!s || s.day !== etDate(now)) {
      while (this.states.size >= MAX_SYMBOLS) this.states.delete(this.states.keys().next().value);
      s = { generation: randomUUID(), generationStartedMs: now, revision: 0, day: etDate(now), demandAt: now,
        streamFromMs: null, throughMs: 0, prefixThroughMs: 0, prefix: new Map(),
        minutes: new Map(), seconds: new Map(), lastSeedAttempt: 0, inflight: null,
        dirtyPrefix: false, dirtyRevision: 0 };
      this.states.set(sym, s);
    }
    s.demandAt = now;
    // Insertion order is demand LRU; existing readers never reset the stream seam.
    this.states.delete(sym);
    this.states.set(sym, s);
    this.seed(sym, s, now);
    return s;
  }

  invalidate(sym) {
    if (sym == null) this.states.clear();
    else this.states.delete(sym);
  }

  ingest(sym, bar, endMs, receivedAt = this.now()) {
    const s = this.states.get(sym);
    if (!s || s.day !== etDate(bar.t) || !validBar(bar) ||
        bar.t % 1000 !== 0 || endMs < bar.t || endMs > bar.t + 1000) return;
    if (s.streamFromMs == null) {
      // A complete A packet says what happened in that second. It does not
      // establish that any earlier second was observed before subscription.
      s.streamFromMs = Math.ceil(receivedAt / 1000) * 1000;
    }
    const minute = Math.floor(bar.t / MINUTE) * MINUTE;
    const prior = s.seconds.get(bar.t);
    if (same(prior, bar)) return;
    if (bar.t < s.prefixThroughMs) {
      // A correction to a REST-owned window cannot be delta-added to its seed.
      s.seconds.set(bar.t, { ...bar });
      s.dirtyPrefix = true;
      s.dirtyRevision++;
      s.revision++;
      this.seed(sym, s, receivedAt);
      return;
    }
    s.seconds.set(bar.t, { ...bar });
    s.throughMs = Math.max(s.throughMs, endMs);
    const rows = [...s.seconds.values()].filter(b => Math.floor(b.t / MINUTE) * MINUTE === minute);
    const value = fold(rows);
    s.minutes.set(minute, { ...value, t: minute });
    s.revision++;
    const oldest = Math.floor((s.throughMs - SECOND_RETENTION_MS) / MINUTE) * MINUTE;
    for (const t of s.seconds.keys()) if (t < oldest) s.seconds.delete(t);
    // A session is bounded. Fail closed rather than silently evicting a prefix
    // and continuing to claim complete coverage.
    if (s.minutes.size > MAX_MINUTES) this.invalidate(sym);
  }

  seed(sym, s, now) {
    if (!this.fetchMinutes || s.inflight || now - s.lastSeedAttempt < 5_000) return;
    // Allow a small publication grace and explicitly exclude the forming minute.
    const boundary = Math.floor((now - 2_000) / MINUTE) * MINUTE;
    const seam = s.streamFromMs == null ? boundary : Math.ceil(s.streamFromMs / MINUTE) * MINUTE;
    const target = Math.min(boundary, seam);
    if (!s.dirtyPrefix && s.prefixThroughMs >= target) return;
    s.lastSeedAttempt = now;
    const dirtyRevision = s.dirtyRevision;
    s.inflight = Promise.resolve().then(() => this.fetchMinutes(sym, s.day, target))
      .then(rows => {
        if (this.states.get(sym) !== s || !Array.isArray(rows) || rows.length > MAX_MINUTES) return;
        const prefix = new Map();
        for (const b of rows) {
          if (!validBar(b) || b.t % MINUTE !== 0 || b.t >= target || etDate(b.t) !== s.day ||
              prefix.has(b.t)) return;
          prefix.set(b.t, { ...b });
        }
        s.prefix = prefix;
        s.prefixThroughMs = target;
        // A source correction arriving during the fetch owes another repair.
        s.dirtyPrefix = s.dirtyRevision !== dirtyRevision;
        for (const t of s.minutes.keys()) if (t < target) s.minutes.delete(t);
        // Retain recent seconds independently for second-resolution charts.
        s.revision++;
      }).catch(() => { /* Preserve the last measured prefix; next chart demand retries. */ })
      .finally(() => { if (this.states.get(sym) === s) s.inflight = null; });
  }

  snapshot(sym, now = this.now()) {
    const s = this.states.get(sym);
    if (!s || s.day !== etDate(now) || s.streamFromMs == null || !s.throughMs) return null;
    const minutes = [...s.prefix.values(), ...s.minutes.values()].sort((a, b) => a.t - b.t);
    return { version: 1, source: "polygon-live-second", generation: s.generation,
      revision: s.revision, generationStartedMs: s.generationStartedMs, sessionDate: s.day, asOfMs: s.throughMs,
      prefixThroughMs: s.prefixThroughMs, streamFromMs: s.streamFromMs,
      dirtyPrefix: s.dirtyPrefix, minutes: minutes.map(tuple),
      seconds: [...s.seconds.values()].sort((a, b) => a.t - b.t).map(tuple) };
  }
}

module.exports = { FormingCandles, validBar, fold };
