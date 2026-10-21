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
    this.activeSeeds = 0;
  }

  demand(sym, now = this.now()) {
    for (const [key, value] of this.states) {
      if (now - value.demandAt > IDLE_MS) this.states.delete(key);
    }
    let s = this.states.get(sym);
    if (!s || s.day !== etDate(now)) {
      if (s) this.states.delete(sym);
      // Preserve hot chart coverage at capacity. Evicting a still-demanded symbol
      // would reset its seed cooldown and churn REST on every round-robin poll.
      if (this.states.size >= MAX_SYMBOLS) return null;
      s = { generation: randomUUID(), generationStartedMs: now, revision: 0, day: etDate(now), demandAt: now,
        streamFromMs: null, throughMs: 0, prefixThroughMs: 0, prefix: new Map(),
        minutes: new Map(), seconds: new Map(), lastSeedAttempt: 0, inflight: null,
        dirtyPrefix: false, dirtyRevision: 0, inflightTargetMs: 0, repairThroughMs: 0 };
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
    const oldest = Math.floor((s.throughMs - SECOND_RETENTION_MS) / MINUTE) * MINUTE;
    if (bar.t < oldest && bar.t >= s.prefixThroughMs) {
      // The minute is still retained, but its individual seconds have expired.
      // It is now opaque: repair it from REST instead of replacing it with one
      // late second and losing the other contributions.
      s.repairThroughMs = Math.max(s.repairThroughMs, minute + MINUTE);
      s.dirtyPrefix = true; s.dirtyRevision++; s.revision++;
      this.seed(sym, s, receivedAt);
      return;
    }
    // A fetch can absorb a minute that is still live-owned when it starts.
    // Any changed component below its target fences the response, including
    // initial seeding and prefix extension, not only an already-owned prefix.
    if (bar.t < s.prefixThroughMs || (s.inflight && bar.t < s.inflightTargetMs)) {
      s.dirtyPrefix = true;
      s.dirtyRevision++;
    }
    if (bar.t < s.prefixThroughMs) {
      // A correction to a REST-owned window cannot be delta-added to its seed.
      if (bar.t >= oldest) s.seconds.set(bar.t, { ...bar });
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
    const retainFrom = Math.floor((s.throughMs - SECOND_RETENTION_MS) / MINUTE) * MINUTE;
    for (const t of s.seconds.keys()) if (t < retainFrom) s.seconds.delete(t);
    // A session is bounded. Fail closed rather than silently evicting a prefix
    // and continuing to claim complete coverage.
    if (s.minutes.size > MAX_MINUTES) this.invalidate(sym);
  }

  seed(sym, s, now) {
    if (!this.fetchMinutes || s.inflight || this.activeSeeds >= 4 || now - s.lastSeedAttempt < 5_000) return;
    // Allow a small publication grace and explicitly exclude the forming minute.
    const boundary = Math.floor((now - 2_000) / MINUTE) * MINUTE;
    const seam = Math.max(s.repairThroughMs,
      s.streamFromMs == null ? boundary : Math.ceil(s.streamFromMs / MINUTE) * MINUTE);
    const target = Math.min(boundary, seam);
    if (!s.dirtyPrefix && s.prefixThroughMs >= target) return;
    s.lastSeedAttempt = now;
    const dirtyRevision = s.dirtyRevision;
    s.inflightTargetMs = target;
    this.activeSeeds++;
    s.inflight = Promise.resolve().then(() => this.fetchMinutes(sym, s.day, target))
      .then(rows => {
        if (this.states.get(sym) !== s || !Array.isArray(rows) || rows.length > MAX_MINUTES) return;
        if (s.dirtyRevision !== dirtyRevision) {
          // The socket changed a component this response would absorb. Keep
          // its newer live ownership intact; partial labeling alone would not
          // justify overwriting an already observed wick/close with older REST.
          s.dirtyPrefix = true;
          return;
        }
        const prefix = new Map();
        for (const b of rows) {
          if (!validBar(b) || b.t % MINUTE !== 0 || b.t >= target || etDate(b.t) !== s.day ||
              prefix.has(b.t)) return;
          prefix.set(b.t, { ...b });
        }
        s.prefix = prefix;
        s.prefixThroughMs = target;
        s.dirtyPrefix = false;
        for (const t of s.minutes.keys()) if (t < target) s.minutes.delete(t);
        // Retain recent seconds independently for second-resolution charts.
        s.revision++;
      }).catch(() => { /* Preserve the last measured prefix; next chart demand retries. */ })
      .finally(() => {
        this.activeSeeds--;
        if (this.states.get(sym) === s) { s.inflight = null; s.inflightTargetMs = 0; }
      });
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
