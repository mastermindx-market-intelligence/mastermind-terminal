"use strict";
// Polygon US equities/ETF feed — delayed cluster by default, real-time when entitled.
//
// Verified live: auth_success then aggregate subscription acks. The delayed cluster uses AM
// (per-minute, ~15 min behind); the live cluster uses A (per-second OHLC). Contract §2:
// DYNAMIC per-symbol subs — subscribe on
// first request, LRU cap 500, unsubscribe after ~30 min idle. Day o/h/l/vol accumulated from
// either aggregate channel;
// chg vs manifest prev-close.
//
// Cluster select: HUB_POLYGON_CLUSTER=live → wss://socket.polygon.io (basis LIVE). A key that
// is NOT real-time-entitled still gets auth_success there, then a status:"error" frame
// ("You don't have access real-time data…") — we demote to the delayed cluster for the rest of
// the process and reconnect, so a plan downgrade can never blank the US feed.
//
// Aggregate message fields: ev=A|AM, sym, o, h, l, c, v, s(start ms), e(end ms).
// We key the day accumulator on the ET trading date (same formatter family as
// intradaySources.ts:etDisplay) so a UTC-midnight rollover doesn't reset the US day mid-session.
//
// NEVER logs the API key. auth_failed → mark unhealthy, US absent from /quotes (Next → manifest EOD),
// no crash.

const WebSocket = require("ws");
const { randomUUID } = require("node:crypto");
const log = require("./log");
const { classifySession, etDate } = require("./usSession");

const URL_LIVE = "wss://socket.polygon.io/stocks";
const URL_DELAYED = "wss://delayed.polygon.io/stocks";
const WANT_LIVE = process.env.HUB_POLYGON_CLUSTER === "live";
const LRU_CAP = 500;
const IDLE_UNSUB_MS = 30 * 60 * 1000; // 30 min
const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_BACKOFF_MS = 30 * 1000;
const MAX_PARAMS_PER_FRAME = 50; // batch subscribe/unsubscribe frames
const REALTIME_AGG_MAX_LAG_MS = 2 * 60 * 1000;

// Optional transport evidence only. These caps bound retained payload, not ws/JSON
// allocations, process RSS, or copies retained by a reader. No production call
// constructs this buffer; local sequence never establishes native completeness.
const FRAME_CAPTURE_STATES = new WeakMap();
const POLYGON_FRAME_CAPTURES = new WeakMap();
const FRAME_MAX_BYTES = 2 * 1024 * 1024;
const QUEUE_MAX_BYTES = 8 * 1024 * 1024;
const QUEUE_MAX_FRAMES = 128;
const RAW_MAX_FRAGMENTS = 128; // Bounds inspection even for empty fragments.
const WALL_MAX_MS = 8_640_000_000_000_000; // JavaScript's representable Date range.
const MONOTONIC_MAX_NS = (1n << 63n) - 1n;
const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype);
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY, "byteLength").get;
const BYTE_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY, "byteOffset").get;
const BACKING_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY, "buffer").get;
const ARRAY_BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const COPY_BYTES = Uint8Array.prototype.set;

class FrameCaptureError extends Error {
  constructor(code) {
    super("Frame capture: " + code);
    this.name = "FrameCaptureError";
    this.code = code;
  }
}

function captureState(buffer) {
  const state = FRAME_CAPTURE_STATES.get(buffer);
  if (!state) throw new FrameCaptureError("INVALID_BUFFER");
  return state;
}

function positiveLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new FrameCaptureError("INVALID_LIMIT");
  }
  return value;
}

function reasonCode(reason) {
  if (typeof reason !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reason)) {
    throw new FrameCaptureError("INVALID_REASON");
  }
  return reason;
}

function terminateCapture(state, reason, closed = false) {
  if (!state.firstGap) state.firstGap = { reason, afterSequence: state.lastSequence };
  if (closed) state.state = "CLOSED";
  else if (state.state === "OPEN") state.state = "GAP";
}

function captureStatus(state) {
  return {
    generation: state.generation,
    state: state.state,
    sourceContinuity: "UNQUALIFIED",
    receiptPrecision: "ms",
    limits: { ...state.limits, maxRawFragments: RAW_MAX_FRAGMENTS },
    capturedFrames: state.lastSequence,
    capturedBytes: state.capturedBytes,
    queuedFrames: state.queue.length,
    queuedBytes: state.queuedBytes,
    acknowledgedThrough: state.acknowledgedThrough,
    deliveredThrough: state.deliveredThrough,
    firstGap: state.firstGap ? { ...state.firstGap } : null,
  };
}

// ws text/default binary messages are Buffers. Its optional ArrayBuffer and
// fragments modes also preserve bytes; Blob is asynchronous and unsupported.
// A JS string can never be promoted back into evidence of original bytes.
function rawViews(raw, maxBytes) {
  const parts = Array.isArray(raw) ? raw : [raw];
  const partCount = parts.length;
  if (!Number.isSafeInteger(partCount) || partCount < 0 || partCount > RAW_MAX_FRAGMENTS) {
    throw new FrameCaptureError("FRAME_SHAPE");
  }
  const views = [];
  let total = 0;
  for (let i = 0; i < partCount; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(parts, String(i));
    if (!descriptor || !("value" in descriptor)) throw new FrameCaptureError("FRAME_SHAPE");
    const part = descriptor.value;
    let backing, offset, length;
    if (Buffer.isBuffer(part)) {
      backing = BACKING_BUFFER.call(part);
      offset = BYTE_OFFSET.call(part);
      length = BYTE_LENGTH.call(part);
      ARRAY_BUFFER_LENGTH.call(backing); // Refuse shared or detached backing.
    } else if (!Array.isArray(raw) && part instanceof ArrayBuffer) {
      backing = part;
      offset = 0;
      length = ARRAY_BUFFER_LENGTH.call(part);
    } else {
      throw new FrameCaptureError("FRAME_TYPE");
    }
    if (length > maxBytes - total) throw new FrameCaptureError("FRAME_TOO_LARGE");
    total += length;
    views.push(new Uint8Array(backing, offset, length));
  }
  return { views, total };
}

function captureFrame(state, raw, clocks) {
  if (state.state !== "OPEN") {
    return { accepted: false, generation: state.generation, reason: state.firstGap.reason };
  }
  try {
    if (!clocks || typeof clocks !== "object") throw new FrameCaptureError("CLOCK_INVALID");
    const { receivedAtMs, monotonicNs } = clocks;
    if (!Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0 || receivedAtMs > WALL_MAX_MS ||
        typeof monotonicNs !== "bigint" || monotonicNs < 0n || monotonicNs > MONOTONIC_MAX_NS) {
      throw new FrameCaptureError("CLOCK_INVALID");
    }
    if (state.lastReceivedAtMs !== null &&
        (receivedAtMs < state.lastReceivedAtMs || monotonicNs < state.lastMonotonicNs)) {
      throw new FrameCaptureError("CLOCK_REGRESSION");
    }
    const { views, total } = rawViews(raw, state.limits.maxFrameBytes);
    if (state.queue.length >= state.limits.maxQueueFrames ||
        total > state.limits.maxQueueBytes - state.queuedBytes) {
      throw new FrameCaptureError("QUEUE_OVERFLOW");
    }
    if (state.lastSequence >= state.limits.maxCapturedFrames ||
        total > state.limits.maxCapturedBytes - state.capturedBytes) {
      throw new FrameCaptureError("COUNTER_LIMIT");
    }
    // Every shape/clock/byte/counter bound is complete before payload allocation.
    const bytes = Buffer.allocUnsafeSlow(total);
    let offset = 0;
    for (const view of views) {
      COPY_BYTES.call(bytes, view, offset);
      offset += BYTE_LENGTH.call(view);
    }
    const sequence = state.lastSequence + 1;
    state.queue.push({ sequence, bytes, receivedAtMs, monotonicNs: monotonicNs.toString() });
    state.lastSequence = sequence;
    state.capturedBytes += total;
    state.queuedBytes += total;
    state.lastReceivedAtMs = receivedAtMs;
    state.lastMonotonicNs = monotonicNs;
    return { accepted: true, generation: state.generation, sequence };
  } catch (error) {
    const reason = error instanceof FrameCaptureError ? error.code : "CAPTURE_ERROR";
    terminateCapture(state, reason);
    return { accepted: false, generation: state.generation, reason };
  }
}

function exactGeneration(state, generation) {
  if (generation !== state.generation) throw new FrameCaptureError("GENERATION_MISMATCH");
}

class FrameCaptureBuffer {
  constructor({
    maxFrameBytes = FRAME_MAX_BYTES,
    maxQueueBytes = QUEUE_MAX_BYTES,
    maxQueueFrames = QUEUE_MAX_FRAMES,
    maxCapturedFrames = Number.MAX_SAFE_INTEGER,
    maxCapturedBytes = Number.MAX_SAFE_INTEGER,
  } = {}) {
    const limits = {
      maxFrameBytes: positiveLimit(maxFrameBytes, FRAME_MAX_BYTES),
      maxQueueBytes: positiveLimit(maxQueueBytes, QUEUE_MAX_BYTES),
      maxQueueFrames: positiveLimit(maxQueueFrames, QUEUE_MAX_FRAMES),
      maxCapturedFrames: positiveLimit(maxCapturedFrames, Number.MAX_SAFE_INTEGER),
      maxCapturedBytes: positiveLimit(maxCapturedBytes, Number.MAX_SAFE_INTEGER),
    };
    const generation = randomUUID();
    Object.defineProperty(this, "generation", { value: generation, enumerable: true });
    FRAME_CAPTURE_STATES.set(this, {
      generation, limits, state: "OPEN", firstGap: null, bound: false,
      queue: [], queuedBytes: 0, capturedBytes: 0, lastSequence: 0,
      acknowledgedThrough: 0, deliveredThrough: 0,
      lastReceivedAtMs: null, lastMonotonicNs: null,
    });
  }

  capture(raw, clocks = {}) {
    const state = captureState(this);
    if (state.bound) throw new FrameCaptureError("BOUND_CAPTURE");
    return captureFrame(state, raw, clocks);
  }

  status() { return captureStatus(captureState(this)); }

  markGap(reason = "EXPLICIT_GAP") {
    const state = captureState(this);
    terminateCapture(state, reasonCode(reason));
    return captureStatus(state);
  }

  close(reason = "CLOSED") {
    const state = captureState(this);
    terminateCapture(state, reasonCode(reason), true);
    return captureStatus(state);
  }

  readBatch({ generation, afterSequence, maxFrames, maxBytes } = {}) {
    const state = captureState(this);
    exactGeneration(state, generation);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < state.acknowledgedThrough ||
        afterSequence > state.deliveredThrough) {
      throw new FrameCaptureError("INVALID_CURSOR");
    }
    maxFrames = positiveLimit(maxFrames === undefined ? state.limits.maxQueueFrames : maxFrames, QUEUE_MAX_FRAMES);
    maxBytes = positiveLimit(maxBytes === undefined ? state.limits.maxQueueBytes : maxBytes, QUEUE_MAX_BYTES);
    const frames = [];
    let bytes = 0;
    let nextSequence = afterSequence;
    const start = afterSequence - state.acknowledgedThrough;
    for (let i = start; i < state.queue.length && frames.length < maxFrames; i++) {
      const frame = state.queue[i];
      if (frame.bytes.length > maxBytes - bytes) {
        if (!frames.length) throw new FrameCaptureError("READ_FRAME_TOO_LARGE");
        break;
      }
      const copy = Buffer.allocUnsafeSlow(frame.bytes.length);
      COPY_BYTES.call(copy, frame.bytes);
      frames.push({ ...frame, bytes: copy });
      bytes += frame.bytes.length;
      nextSequence = frame.sequence;
    }
    // A failed copy cannot advance the delivered prefix or consume the originals.
    state.deliveredThrough = Math.max(state.deliveredThrough, nextSequence);
    return {
      ...captureStatus(state), frames, bytes, nextSequence,
      hasMore: nextSequence < state.lastSequence,
    };
  }

  ackThrough({ generation, throughSequence } = {}) {
    const state = captureState(this);
    exactGeneration(state, generation);
    if (!Number.isSafeInteger(throughSequence) || throughSequence < state.acknowledgedThrough ||
        throughSequence > state.deliveredThrough) {
      throw new FrameCaptureError("INVALID_ACK");
    }
    const count = throughSequence - state.acknowledgedThrough;
    for (let i = 0; i < count; i++) state.queuedBytes -= state.queue[i].bytes.length;
    state.queue.splice(0, count);
    state.acknowledgedThrough = throughSequence;
    return captureStatus(state);
  }
}

function bindFrameCapture(polygon, buffer) {
  const state = captureState(buffer);
  if (state.bound) throw new FrameCaptureError("ALREADY_BOUND");
  if (state.state !== "OPEN" || state.lastSequence !== 0) throw new FrameCaptureError("USED_GENERATION");
  state.bound = true;
  POLYGON_FRAME_CAPTURES.set(polygon, state);
}

class Polygon {
  constructor(store, apiKey, extFeed, { frameCapture = null } = {}) {
    if (frameCapture !== null) bindFrameCapture(this, frameCapture);
    this.store = store;
    this.apiKey = apiKey || "";
    this.extFeed = extFeed || null;
    // Effective cluster; starts from env, demoted (permanently for this process) on RT-denied.
    this.cluster = WANT_LIVE ? "live" : "delayed";
    this.ws = null;
    this.authed = false;
    this.authFailed = false;
    this.attempt = 0;
    this.stopped = false;

    /** @type {Map<string,{lastReq:number, subscribedAt:number}>} insertion-ordered = LRU */
    this.subs = new Map();
    /** @type {Map<string,{date:string, open:number, high:number, low:number, vol:number, last:number}>} */
    this.dayAcc = new Map();

    this.reconnectTimer = null;
    this.sweepTimer = null;
    this.lastMsgAt = 0;
  }

  start() {
    this.stopped = false;
    this._connect();
    this.sweepTimer = setInterval(() => this._sweepIdle(), SWEEP_INTERVAL_MS);
  }

  stop() {
    const capture = POLYGON_FRAME_CAPTURES.get(this);
    if (capture) terminateCapture(capture, "STOPPED", true);
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    if (this.ws) { try { this.ws.terminate(); } catch {} this.ws = null; }
    this.authed = false;
  }

  isAuthed() { return this.authed; }
  isHealthy() { return this.authed && !this.authFailed; }

  _backoffMs() {
    const base = Math.min(MAX_BACKOFF_MS, Math.pow(2, this.attempt) * 1000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(1000, Math.round(base + jitter));
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const wait = this._backoffMs();
    this.attempt++;
    log.every("polygon-reconnect", "WARN", "polygon reconnect in", `${wait}ms`, `attempt=${this.attempt}`);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this._connect(); }, wait);
  }

  _connect() {
    if (this.stopped) return;
    if (!this.apiKey) {
      log.error("polygon: POLYGON_API_KEY missing — US feed disabled");
      this.authFailed = true;
      return;
    }
    let ws;
    try { ws = new WebSocket(this.cluster === "live" ? URL_LIVE : URL_DELAYED); } catch (e) {
      log.error("polygon ws construct failed", e.message); this._scheduleReconnect(); return;
    }
    this.ws = ws;
    this.authed = false;

    ws.on("open", () => {
      this.lastMsgAt = Date.now();
      log.info("polygon connected — authenticating", `cluster=${this.cluster}`);
      // NEVER let the key reach the logger: pass it only into the frame.
      try { ws.send(JSON.stringify({ action: "auth", params: this.apiKey })); } catch (e) {
        log.error("polygon auth send failed", e.message);
      }
    });

    ws.on("message", (raw) => this._receiveRawFrame(raw));

    ws.on("error", (error) => this._onSocketError(error));

    ws.on("close", (code) => this._onSocketClose(code));
  }

  _receiveRawFrame(raw) {
    this.lastMsgAt = Date.now();
    const capture = POLYGON_FRAME_CAPTURES.get(this);
    if (capture && capture.state === "OPEN") {
      try {
        captureFrame(capture, raw, {
          receivedAtMs: this.lastMsgAt,
          monotonicNs: process.hrtime.bigint(),
        });
      } catch {
        terminateCapture(capture, "CAPTURE_ERROR");
      }
    }
    let arr;
    try { arr = JSON.parse(raw.toString()); } catch {
      if (capture) terminateCapture(capture, "PARSE_LOSS");
      return;
    }
    if (!Array.isArray(arr)) arr = [arr];
    try {
      for (const msg of arr) this._onMessage(msg);
    } catch (error) {
      if (capture) terminateCapture(capture, "DISPATCH_LOSS");
      throw error; // Preserve the incumbent dispatch error, never a successful empty result.
    }
  }

  _onSocketError(error) {
    const capture = POLYGON_FRAME_CAPTURES.get(this);
    if (capture) terminateCapture(capture, "SOCKET_ERROR");
    log.every("polygon-error", "WARN", "polygon ws error", error && error.message);
  }

  _onSocketClose(code) {
    const capture = POLYGON_FRAME_CAPTURES.get(this);
    if (capture) terminateCapture(capture, "SOCKET_CLOSED", true);
    this.authed = false;
    log.every("polygon-close", "WARN", "polygon ws closed", `code=${code}`);
    this._scheduleReconnect();
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.ev === "status") {
      if (msg.status === "auth_success") {
        this.authed = true;
        this.authFailed = false;
        this.attempt = 0;
        log.info("polygon auth_success — replaying subs", `n=${this.subs.size}`);
        log.resetEvery("polygon-reconnect");
        this._replaySubs();
      } else if (msg.status === "auth_failed") {
        this.authFailed = true;
        this.authed = false;
        log.error("polygon auth_failed — US feed unhealthy (manifest EOD fallback)", msg.message || "");
      } else if (msg.status === "error" && this.cluster === "live" && /real.?time|not (?:authoriz|entitle)|access|subscri/i.test(msg.message || "")) {
        // RT entitlement denied arrives AFTER auth_success (not as auth_failed): demote to the
        // delayed cluster for the rest of the process and reconnect (close → _scheduleReconnect;
        // _replaySubs re-subscribes everything on the delayed socket). The match is deliberately
        // broad — free-text wording from a third party (Polygon → Massive rebrand in flight); a
        // false-positive demote only costs latency, a miss silently blanks the whole US feed.
        this.cluster = "delayed";
        log.error("polygon real-time denied — demoting to delayed cluster", msg.message || "");
        // Quotes already stamped live must not linger overclaiming until their next delayed AM bar.
        for (const q of this.store.quotes.values()) {
          if (q && String(q.source || "").startsWith("polygon-live")) {
            q.source = "polygon-delayed";
            q.basis = "DELAYED_15M";
            q.live = false;
            delete q.asOfMs; delete q.lagMs;
            delete q.tickOpen; delete q.tickHigh; delete q.tickLow; delete q.tickClose;
            delete q.tickVol; delete q.tickStartMs; delete q.tickEndMs;
          }
        }
        try { this.ws.terminate(); } catch {}
      } else if (msg.status === "connected") {
        // handshake ack; wait for auth
      }
      // 'success' acks for subscribe/unsubscribe are informational; do not log the key (none present).
      return;
    }
    if (msg.ev === "AM") this._onAM(msg);
    else if (msg.ev === "A") this._onA(msg);
  }

  // Massive's A.* feed is the authoritative one-second candle source. A successfully received
  // packet on the live cluster is still not labelled real-time by configuration alone: its own
  // end timestamp must be close to the wall clock. The exact one-second OHLC rides alongside the
  // quote so the browser can grow the active candle without reconstructing a bar from a day close.
  _onA(m) {
    const sym = m.sym;
    if (!sym || this.cluster !== "live") return;
    const o = Number(m.o), h = Number(m.h), l = Number(m.l), c = Number(m.c), v = Number(m.v);
    if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) return;
    const startMs = Number(m.s) || Number(m.e) || Date.now();
    const endMs = Number(m.e) || startMs;
    const now = Date.now();
    const lagMs = Math.max(0, now - endMs);
    // A buffered/old packet is not evidence of a live tape. The delayed cluster never subscribes
    // A.* at all; this second guard protects reconnect/catch-up edge cases on the live socket.
    if (endMs - now > 5_000 || lagMs > REALTIME_AGG_MAX_LAG_MS) return;
    const session = classifySession(startMs);

    if (session !== "rth") {
      this.extFeed?.ingest(sym, {
        price: c,
        ts: Math.floor(endMs / 1000),
        session,
        source: "polygon-live-second",
        basis: "LIVE",
      });
      return;
    }

    const date = etDate(startMs);
    let acc = this.dayAcc.get(sym);
    const officialOpen = Number(m.op);
    const accumulatedVol = Number(m.av);
    if (!acc || acc.date !== date) {
      acc = {
        date,
        open: Number.isFinite(officialOpen) && officialOpen > 0 ? officialOpen : o,
        high: h,
        low: l,
        vol: Number.isFinite(accumulatedVol) && accumulatedVol >= 0
          ? accumulatedVol
          : Number.isFinite(v) && v >= 0 ? v : 0,
        last: c,
      };
    } else {
      acc.high = Math.max(acc.high, h);
      acc.low = Math.min(acc.low, l);
      acc.last = c;
      if (Number.isFinite(accumulatedVol) && accumulatedVol >= 0) acc.vol = accumulatedVol;
      else if (Number.isFinite(v) && v >= 0) acc.vol += v;
    }
    this.dayAcc.set(sym, acc);

    this.store.setQuote(sym, {
      last: c,
      open: acc.open,
      high: acc.high,
      low: acc.low,
      vol: acc.vol,
      ts: Math.floor(endMs / 1000),
      live: true,
      source: "polygon-live-second",
      market: "us",
      basis: "REALTIME",
      asOfMs: endMs,
      lagMs,
      regularSessionDate: date,
      regularSession: "rth",
      tickOpen: o,
      tickHigh: h,
      tickLow: l,
      tickClose: c,
      tickVol: Number.isFinite(v) && v >= 0 ? v : 0,
      tickStartMs: startMs,
      tickEndMs: endMs,
    });
  }

  _onAM(m) {
    const sym = m.sym;
    if (!sym) return;
    const c = Number(m.c);
    if (!Number.isFinite(c)) return;
    const o = Number(m.o), h = Number(m.h), l = Number(m.l), v = Number(m.v);
    const startMs = Number(m.s) || Number(m.e) || Date.now();
    const endMs = Number(m.e) || Date.now();
    const session = classifySession(startMs);
    const live = this.cluster === "live";

    // Polygon AM includes pre/post aggregates. Route them into the explicit
    // extended lane so they never mutate regular LAST/OHLC/volume.
    if (session !== "rth") {
      this.extFeed?.ingest(sym, {
        price: c,
        ts: Math.floor(endMs / 1000),
        session,
        source: live ? "polygon-live" : "polygon-delayed",
        basis: live ? "LIVE" : "DELAYED_15M",
      });
      return;
    }

    const date = etDate(startMs);

    let acc = this.dayAcc.get(sym);
    if (!acc || acc.date !== date) {
      // ET-date rollover (or first AM of the day) → reset accumulator.
      acc = {
        date,
        open: Number.isFinite(o) ? o : c,
        high: Number.isFinite(h) ? h : c,
        low: Number.isFinite(l) ? l : c,
        vol: Number.isFinite(v) ? v : 0,
        last: c,
      };
    } else {
      if (Number.isFinite(h)) acc.high = Math.max(acc.high, h);
      if (Number.isFinite(l)) acc.low = Math.min(acc.low, l);
      if (Number.isFinite(v)) acc.vol += v;
      acc.last = c;
    }
    this.dayAcc.set(sym, acc);

    this.store.setQuote(sym, {
      last: acc.last,
      open: acc.open,
      high: acc.high,
      low: acc.low,
      vol: acc.vol,
      ts: Math.floor(endMs / 1000),
      live,
      source: live ? "polygon-live" : "polygon-delayed",
      market: "us",
      basis: live ? "LIVE" : "DELAYED_15M",
      regularSessionDate: date,
      regularSession: "rth",
    });
  }

  // Ensure a symbol is subscribed; write a manifest-derived placeholder immediately so /quotes
  // never flashes empty in the ≤15-min pre-first-AM window.
  ensureSubscribed(sym) {
    const now = Date.now();
    const existing = this.subs.get(sym);
    if (existing) {
      existing.lastReq = now;
      // Re-insert to move to MRU end of insertion order.
      this.subs.delete(sym);
      this.subs.set(sym, existing);
      return;
    }

    // LRU-evict the least-recently-requested if at cap.
    while (this.subs.size >= LRU_CAP) {
      const oldestKey = this.subs.keys().next().value;
      if (oldestKey === undefined) break;
      this.subs.delete(oldestKey);
      this.store.markSubscribed(oldestKey, false);
      this._send({ action: "unsubscribe", params: `${this._aggregateChannel()}.${oldestKey}` });
      log.info("polygon LRU-evicted", oldestKey);
    }

    this.subs.set(sym, { lastReq: now, subscribedAt: now });
    this.store.markSubscribed(sym, true);
    this._writePlaceholder(sym);
    this._send({ action: "subscribe", params: `${this._aggregateChannel()}.${sym}` });
  }

  _writePlaceholder(sym) {
    // Only if we have no live entry yet: seed from the manifest so the header shows something.
    const existing = this.store.quotes.get(sym);
    if (existing && String(existing.source || "").startsWith("polygon-") && existing.last != null) return;
    // Seed last = MANIFEST last (EOD close). setQuote derives prevClose from prevCloseBySym and
    // recomputes chg — reproducing the manifest's day-change (not a flat 0) until the first
    // aggregate bar lands, at which point the tape price/chg take over. Off-hours the header thus
    // keeps showing the session's ±% exactly like the pre-hub EOD fallback did.
    const manifestLast = this.store.manifest.lastBySym.get(sym);
    if (manifestLast == null) return;
    // Placeholder is EOD-derived, so it always carries the delayed labels even on the live
    // cluster — the first measured aggregate upgrades it to LIVE; off-hours it never overclaims.
    this.store.setQuote(sym, {
      last: manifestLast,
      ts: Math.floor(Date.now() / 1000),
      live: false,
      source: "polygon-delayed",
      market: "us",
      basis: "DELAYED_15M",
      regularSession: "closed",
    });
  }

  _replaySubs() {
    // Batch resubscribe on (re)auth, ≤50 params per frame.
    const syms = [...this.subs.keys()];
    for (let i = 0; i < syms.length; i += MAX_PARAMS_PER_FRAME) {
      const chunk = syms.slice(i, i + MAX_PARAMS_PER_FRAME);
      const channel = this._aggregateChannel();
      const params = chunk.map((s) => `${channel}.${s}`).join(",");
      this._send({ action: "subscribe", params });
    }
  }

  _sweepIdle() {
    const now = Date.now();
    const toUnsub = [];
    for (const [sym, meta] of this.subs) {
      if (now - meta.lastReq > IDLE_UNSUB_MS) toUnsub.push(sym);
    }
    for (let i = 0; i < toUnsub.length; i += MAX_PARAMS_PER_FRAME) {
      const chunk = toUnsub.slice(i, i + MAX_PARAMS_PER_FRAME);
      for (const s of chunk) { this.subs.delete(s); this.store.markSubscribed(s, false); }
      const channel = this._aggregateChannel();
      this._send({ action: "unsubscribe", params: chunk.map((s) => `${channel}.${s}`).join(",") });
    }
    if (toUnsub.length) log.info("polygon idle-swept", toUnsub.length, "subs (>30m idle)");
  }

  _send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authed) return;
    try { this.ws.send(JSON.stringify(frame)); } catch (e) {
      log.warn("polygon send failed", e.message);
    }
  }

  _aggregateChannel() { return this.cluster === "live" ? "A" : "AM"; }

  health() {
    return {
      authed: this.authed,
      authFailed: this.authFailed,
      cluster: this.cluster,
      aggregateChannel: this._aggregateChannel(),
      wantLive: WANT_LIVE,
      subs: this.subs.size,
      lruCap: LRU_CAP,
      lastMsgAt: this.lastMsgAt ? new Date(this.lastMsgAt).toISOString() : null,
      attempt: this.attempt,
    };
  }
}

module.exports = { Polygon, etDate, FrameCaptureBuffer, FrameCaptureError };
