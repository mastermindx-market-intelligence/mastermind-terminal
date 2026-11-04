"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Polygon } = require("../lib/polygon");
const { classifySession } = require("../lib/usSession");

describe("Polygon regular and extended quote lanes", () => {
  it("never classifies a weekend clock time as RTH", () => {
    const saturday = Date.UTC(2026, 7, 1, 14, 0); // 10:00 ET
    assert.equal(classifySession(saturday), "overnight");
  });

  it("routes premarket aggregates only to the extended feed", () => {
    const quotes = [];
    const extended = [];
    const polygon = new Polygon(
      { setQuote: (...args) => quotes.push(args), quotes: new Map() },
      "test-key",
      { ingest: (...args) => extended.push(args) },
    );
    const start = Date.UTC(2026, 6, 30, 13, 0); // 09:00 ET
    polygon._onAM({ ev: "AM", sym: "NVDA", o: 170, h: 171, l: 169, c: 170.5, v: 10, s: start, e: start + 59999 });

    assert.equal(quotes.length, 0, "premarket aggregate must not mutate the regular quote");
    assert.equal(extended.length, 1);
    assert.equal(extended[0][0], "NVDA");
    assert.equal(extended[0][1].session, "pre");
    assert.equal(extended[0][1].price, 170.5);
  });

  it("keeps RTH aggregates in the regular quote lane", () => {
    const quotes = [];
    const extended = [];
    const polygon = new Polygon(
      { setQuote: (...args) => quotes.push(args), quotes: new Map() },
      "test-key",
      { ingest: (...args) => extended.push(args) },
    );
    const start = Date.UTC(2026, 6, 30, 14, 0); // 10:00 ET
    polygon._onAM({ ev: "AM", sym: "NVDA", o: 172, h: 173, l: 171, c: 172.5, v: 20, s: start, e: start + 59999 });

    assert.equal(extended.length, 0);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0][1].last, 172.5);
    assert.equal(quotes[0][1].regularSession, "rth");
    assert.equal(quotes[0][1].regularSessionDate, "2026-07-30");
  });

  it("publishes measured one-second OHLC from the live A.* lane", () => {
    const quotes = [];
    const polygon = new Polygon(
      { setQuote: (...args) => quotes.push(args), quotes: new Map() },
      "test-key",
      { ingest: () => {} },
    );
    polygon.cluster = "live";
    const realNow = Date.now;
    const start = Date.UTC(2026, 6, 30, 14, 0, 7); // 10:00:07 ET
    Date.now = () => start + 1_050;
    try {
      polygon._onA({
        ev: "A", sym: "NVDA", o: 172, h: 172.4, l: 171.9, c: 172.25,
        v: 20, av: 12_345, op: 170, s: start, e: start + 999,
      });
    } finally {
      Date.now = realNow;
    }

    assert.equal(quotes.length, 1);
    assert.equal(quotes[0][1].basis, "REALTIME");
    assert.equal(quotes[0][1].last, 172.25);
    assert.equal(quotes[0][1].tickOpen, 172);
    assert.equal(quotes[0][1].tickHigh, 172.4);
    assert.equal(quotes[0][1].tickLow, 171.9);
    assert.equal(quotes[0][1].tickClose, 172.25);
    assert.equal(quotes[0][1].tickStartMs, start);
    assert.equal(quotes[0][1].asOfMs, start + 999);
    assert.equal(quotes[0][1].lagMs, 51);
  });

  it("subscribes A.* on live and AM.* on delayed without duplicate sockets", () => {
    const frames = [];
    const store = {
      setQuote: () => {}, quotes: new Map(),
      markSubscribed: () => {},
      manifest: { lastBySym: new Map() },
    };
    const polygon = new Polygon(store, "test-key", null);
    polygon._send = (frame) => frames.push(frame);

    polygon.cluster = "live";
    polygon.ensureSubscribed("AAPL");
    assert.equal(frames.at(-1).params, "A.AAPL");

    polygon.cluster = "delayed";
    polygon.ensureSubscribed("MSFT");
    assert.equal(frames.at(-1).params, "AM.MSFT");
  });
});

// Original-frame capture is opt-in and tested with synthetic bytes only. Every
// ordinary Polygon below is unstarted; the callback-wiring fixture uses a VM-local
// fake WebSocket with timers tripwired, never a real socket or persisted payload.
const { FrameCaptureBuffer, FrameCaptureError } = require("../lib/polygon");
const FRAME_EPOCH = Date.UTC(2026, 6, 30, 14, 0);

function frameClocks(n = 1) {
  return { receivedAtMs: FRAME_EPOCH + n, monotonicNs: BigInt(n) };
}

function captureText(buffer, text, n = 1) {
  return buffer.capture(Buffer.from(text), frameClocks(n));
}

function readFrames(buffer, extra = {}) {
  return buffer.readBatch({
    generation: buffer.generation,
    afterSequence: buffer.status().acknowledgedThrough,
    ...extra,
  });
}

function codeIs(fn, code) {
  assert.throws(fn, (error) => error instanceof FrameCaptureError && error.code === code);
}

function unstartedPolygon(frameCapture) {
  const calls = { quotes: [], extended: [], sent: [], reconnects: 0 };
  const store = {
    quotes: new Map(),
    setQuote: (sym, quote) => {
      calls.quotes.push([sym, quote]);
      store.quotes.set(sym, { ...store.quotes.get(sym), ...quote });
    },
    markSubscribed: () => {},
    manifest: { lastBySym: new Map() },
  };
  const polygon = new Polygon(store, "synthetic-key", {
    ingest: (...args) => calls.extended.push(args),
  }, frameCapture === undefined ? undefined : { frameCapture });
  polygon._connect = () => { throw new Error("real connection forbidden"); };
  polygon._send = (frame) => calls.sent.push(frame);
  polygon._scheduleReconnect = () => { calls.reconnects++; };
  return { polygon, calls, store };
}

describe("FrameCaptureBuffer byte ownership and bounded transport evidence", () => {
  it("keeps exact number spellings and the whole mixed frame before JSON conversion", () => {
    const capture = new FrameCaptureBuffer();
    const { polygon, calls } = unstartedPolygon(capture);
    const text = '[{"ev":"T","p":1.2300000000000000000001,"q":9007199254740993},' +
      '{"ev":"Q","bp":1e-9,"ap":2.00},' +
      '{"ev":"AM","sym":"NVDA","c":172.50,"o":172,"h":173,"l":171,"v":20,"s":' +
      FRAME_EPOCH + ',"e":' + (FRAME_EPOCH + 59999) + '},' +
      '{"ev":"status","status":"success","message":"subscribed"}]';
    const input = Buffer.from(text);
    polygon._receiveRawFrame(input);
    input.fill(0);
    const batch = readFrames(capture);
    assert.equal(batch.frames.length, 1);
    assert.equal(batch.frames[0].bytes.toString(), text);
    assert.equal(calls.quotes.length, 1);
    assert.equal(calls.quotes[0][1].last, 172.5);
    assert.equal(batch.receiptPrecision, "ms");
    assert.ok(Number.isSafeInteger(batch.frames[0].receivedAtMs));
    assert.match(batch.frames[0].monotonicNs, /^[0-9]+$/);
    assert.equal(batch.sourceContinuity, "UNQUALIFIED");
  });

  it("isolates the entire backing store of both input and returned buffers", () => {
    const capture = new FrameCaptureBuffer();
    const input = Buffer.allocUnsafeSlow(16);
    input.write("original", 4);
    const slice = input.subarray(4, 12);
    capture.capture(slice, frameClocks());
    new Uint8Array(input.buffer).fill(0);
    const first = readFrames(capture);
    assert.equal(first.frames[0].bytes.toString(), "original");
    new Uint8Array(first.frames[0].bytes.buffer).fill(120);
    first.frames[0].receivedAtMs = -1;
    first.frames.push({ sequence: 99 });
    first.limits.maxQueueBytes = Infinity;
    const again = readFrames(capture);
    assert.equal(again.frames.length, 1);
    assert.equal(again.frames[0].bytes.toString(), "original");
    assert.equal(again.frames[0].receivedAtMs, FRAME_EPOCH + 1);
    assert.equal(again.limits.maxQueueBytes, 8 * 1024 * 1024);
    assert.notEqual(again.frames[0].bytes.buffer, first.frames[0].bytes.buffer);
  });

  it("owns ArrayBuffer and bounded Buffer-fragment inputs without reserialization", () => {
    const ab = new Uint8Array([91, 49, 46, 48, 48, 93]).buffer;
    const capture = new FrameCaptureBuffer();
    assert.equal(capture.capture(ab, frameClocks()).accepted, true);
    new Uint8Array(ab).fill(0);
    const left = Buffer.from('{"x":');
    const right = Buffer.from('1e+2}');
    assert.equal(capture.capture([left, right], frameClocks(2)).accepted, true);
    left.fill(0); right.fill(0);
    assert.deepEqual(readFrames(capture).frames.map((f) => f.bytes.toString()), ["[1.00]", '{"x":1e+2}']);
  });

  for (const raw of ["[1]", new Uint8Array([49]), { toString: () => "1" }, new Blob(["1"])]) {
    it("refuses non-original or asynchronous shape " + Object.prototype.toString.call(raw), () => {
      const capture = new FrameCaptureBuffer();
      assert.equal(capture.capture(raw, frameClocks()).reason, "FRAME_TYPE");
      assert.equal(capture.status().state, "GAP");
      assert.equal(capture.status().capturedFrames, 0);
    });
  }

  it("preflights fragment count and accessors without invoking them or allocating payload", () => {
    const capture = new FrameCaptureBuffer();
    const many = Array.from({ length: 129 }, () => Buffer.alloc(0));
    assert.equal(capture.capture(many, frameClocks()).reason, "FRAME_SHAPE");
    let getterCalled = false;
    const accessor = [];
    Object.defineProperty(accessor, 0, { get() { getterCalled = true; throw new Error("getter"); } });
    const other = new FrameCaptureBuffer();
    assert.equal(other.capture(accessor, frameClocks()).reason, "FRAME_SHAPE");
    assert.equal(getterCalled, false);
    const exact = new FrameCaptureBuffer();
    assert.equal(exact.capture(Array.from({ length: 128 }, () => Buffer.alloc(0)), frameClocks()).accepted, true);
  });

  it("enforces exact 2MiB frame and 8MiB retained-payload boundaries without eviction", () => {
    const capture = new FrameCaptureBuffer();
    const exact = Buffer.alloc(2 * 1024 * 1024, 65);
    for (let n = 1; n <= 4; n++) assert.equal(capture.capture(exact, frameClocks(n)).accepted, true);
    assert.equal(capture.status().queuedBytes, 8 * 1024 * 1024);
    assert.equal(capture.capture(Buffer.from("x"), frameClocks(5)).reason, "QUEUE_OVERFLOW");
    const batch = readFrames(capture);
    assert.equal(batch.frames.length, 4);
    assert.equal(batch.bytes, 8 * 1024 * 1024);
    for (const frame of batch.frames) {
      assert.equal(frame.bytes.length, exact.length);
      assert.equal(frame.bytes[0], 65);
      assert.equal(frame.bytes.at(-1), 65);
    }
    const oversized = new FrameCaptureBuffer();
    assert.equal(oversized.capture(Buffer.alloc(exact.length + 1), frameClocks()).reason, "FRAME_TOO_LARGE");
    assert.equal(oversized.status().queuedBytes, 0);
  });

  it("enforces the exact128-frame queue boundary independently of bytes", () => {
    const capture = new FrameCaptureBuffer();
    for (let n = 1; n <= 128; n++) assert.equal(captureText(capture, "x", n).accepted, true);
    assert.equal(captureText(capture, "x", 129).reason, "QUEUE_OVERFLOW");
    const batch = readFrames(capture);
    assert.equal(batch.frames.length, 128);
    assert.equal(batch.frames[0].sequence, 1);
    assert.equal(batch.frames.at(-1).sequence, 128);
  });

  for (const [name, maximum] of [
    ["maxFrameBytes", 2 * 1024 * 1024], ["maxQueueBytes", 8 * 1024 * 1024],
    ["maxQueueFrames", 128], ["maxCapturedFrames", Number.MAX_SAFE_INTEGER],
    ["maxCapturedBytes", Number.MAX_SAFE_INTEGER],
  ]) {
    it("permits only downward positive integer configuration for " + name, () => {
      for (const value of [0, -1, 0.5, NaN, Infinity, maximum + 1, "1"]) {
        codeIs(() => new FrameCaptureBuffer({ [name]: value }), "INVALID_LIMIT");
      }
      assert.equal(new FrameCaptureBuffer({ [name]: 1 }).status().limits[name], 1);
    });
  }

  it("checks byte/counter admission before allocating and records allocation failure as a gap", () => {
    const capture = new FrameCaptureBuffer({ maxFrameBytes: 1 });
    const two = Buffer.from("xx");
    const alloc = Buffer.allocUnsafeSlow;
    let allocations = 0;
    Buffer.allocUnsafeSlow = () => { allocations++; throw new Error("synthetic allocation fault"); };
    try {
      assert.equal(capture.capture(two, frameClocks()).reason, "FRAME_TOO_LARGE");
      assert.equal(allocations, 0);
      const second = new FrameCaptureBuffer();
      assert.equal(second.capture(two, frameClocks()).reason, "CAPTURE_ERROR");
      assert.equal(allocations, 1);
      assert.equal(second.status().capturedFrames, 0);
    } finally {
      Buffer.allocUnsafeSlow = alloc;
    }
  });

  for (const options of [{ maxCapturedFrames: 2 }, { maxCapturedBytes: 2 }]) {
    it("exhausts lifetime counters across ACK without reset or unsafe addition " + JSON.stringify(options), () => {
      const capture = new FrameCaptureBuffer(options);
      for (let n = 1; n <= 2; n++) {
        captureText(capture, "x", n);
        readFrames(capture);
        capture.ackThrough({ generation: capture.generation, throughSequence: n });
      }
      assert.equal(captureText(capture, "x", 3).reason, "COUNTER_LIMIT");
      assert.equal(capture.status().capturedFrames, 2);
      assert.equal(capture.status().capturedBytes, 2);
      assert.equal(capture.status().queuedBytes, 0);
    });
  }

  it("bounds receipt to a real Date instant and keeps monotonic precision separate", () => {
    const capture = new FrameCaptureBuffer();
    assert.equal(capture.capture(Buffer.from("0"), { receivedAtMs: 0, monotonicNs: 0n }).accepted, true);
    assert.equal(capture.capture(Buffer.from("1"), {
      receivedAtMs: 8_640_000_000_000_000, monotonicNs: (1n << 63n) - 1n,
    }).accepted, true);
    const frames = readFrames(capture).frames;
    assert.equal(new Date(frames[1].receivedAtMs).toISOString(), "+275760-09-13T00:00:00.000Z");
    assert.equal(frames[1].monotonicNs, "9223372036854775807");
  });

  for (const clocks of [
    null, {}, { receivedAtMs: NaN, monotonicNs: 1n },
    { receivedAtMs: Infinity, monotonicNs: 1n }, { receivedAtMs: -1, monotonicNs: 1n },
    { receivedAtMs: 0.1, monotonicNs: 1n }, { receivedAtMs: "1", monotonicNs: 1n },
    { receivedAtMs: 8_640_000_000_000_001, monotonicNs: 1n },
    { receivedAtMs: Number.MAX_SAFE_INTEGER, monotonicNs: 1n },
    { receivedAtMs: 1, monotonicNs: 1 }, { receivedAtMs: 1, monotonicNs: -1n },
    { receivedAtMs: 1, monotonicNs: 1n << 63n },
  ]) {
    it("terminates on invalid clocks " + String(clocks && clocks.receivedAtMs) + "/" +
      String(clocks && clocks.monotonicNs), () => {
      const capture = new FrameCaptureBuffer();
      assert.equal(capture.capture(Buffer.from("x"), clocks).reason, "CLOCK_INVALID");
      assert.equal(captureText(capture, "valid", 2).accepted, false);
      assert.equal(capture.status().capturedFrames, 0);
    });
  }

  for (const changed of ["wall", "monotonic"]) {
    it("makes " + changed + " rollback permanent while accepting equal clocks", () => {
      const capture = new FrameCaptureBuffer();
      const clock = { receivedAtMs: 100, monotonicNs: 100n };
      capture.capture(Buffer.from("a"), clock);
      assert.equal(capture.capture(Buffer.from("b"), clock).accepted, true);
      assert.equal(capture.capture(Buffer.from("c"), changed === "wall"
        ? { ...clock, receivedAtMs: 99 } : { ...clock, monotonicNs: 99n }).reason, "CLOCK_REGRESSION");
      assert.equal(capture.capture(Buffer.from("d"), { receivedAtMs: 101, monotonicNs: 101n }).accepted, false);
      assert.equal(readFrames(capture).frames.length, 2);
    });
  }

  it("uses FIFO delivered cursors, bounded copies and explicit ACK, with replay before ACK", () => {
    const capture = new FrameCaptureBuffer();
    ["aa", "bbb", "c"].forEach((text, i) => captureText(capture, text, i + 1));
    const generation = capture.generation;
    codeIs(() => capture.readBatch({ generation, afterSequence: 1 }), "INVALID_CURSOR");
    codeIs(() => capture.ackThrough({ generation, throughSequence: 1 }), "INVALID_ACK");
    const first = capture.readBatch({ generation, afterSequence: 0, maxFrames: 2, maxBytes: 4 });
    assert.deepEqual(first.frames.map((f) => f.bytes.toString()), ["aa"]);
    assert.equal(first.nextSequence, 1);
    assert.equal(first.hasMore, true);
    assert.deepEqual(capture.readBatch({ generation, afterSequence: 0, maxFrames: 1 }).frames.map((f) => f.sequence), [1]);
    const second = capture.readBatch({ generation, afterSequence: 1, maxFrames: 1 });
    assert.deepEqual(second.frames.map((f) => f.bytes.toString()), ["bbb"]);
    capture.ackThrough({ generation, throughSequence: 1 });
    assert.equal(capture.status().queuedBytes, 4);
    assert.equal(capture.ackThrough({ generation, throughSequence: 1 }).queuedBytes, 4);
    codeIs(() => capture.readBatch({ generation, afterSequence: 0 }), "INVALID_CURSOR");
    const last = capture.readBatch({ generation, afterSequence: 2 });
    assert.equal(last.hasMore, false);
    assert.equal(last.nextSequence, 3);
    capture.ackThrough({ generation, throughSequence: 3 });
    assert.equal(capture.status().queuedFrames, 0);
    assert.equal(capture.status().capturedBytes, 6);
  });

  it("refuses insufficient byte budgets, bad generations, unsafe cursors and unread ACKs without mutation", () => {
    const capture = new FrameCaptureBuffer();
    captureText(capture, "long");
    const generation = capture.generation;
    const before = capture.status();
    codeIs(() => capture.readBatch({ generation, afterSequence: 0, maxBytes: 3 }), "READ_FRAME_TOO_LARGE");
    for (const afterSequence of [-1, NaN, Infinity, 0.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
      codeIs(() => capture.readBatch({ generation, afterSequence }), "INVALID_CURSOR");
    }
    for (const throughSequence of [-1, 1, NaN, Infinity, "0"]) {
      codeIs(() => capture.ackThrough({ generation, throughSequence }), "INVALID_ACK");
    }
    codeIs(() => capture.readBatch({ generation: "other", afterSequence: 0 }), "GENERATION_MISMATCH");
    codeIs(() => capture.ackThrough({ generation: "other", throughSequence: 0 }), "GENERATION_MISMATCH");
    for (const options of [{ maxFrames: 129 }, { maxBytes: 8 * 1024 * 1024 + 1 }, { maxFrames: 0 }, { maxBytes: NaN }]) {
      codeIs(() => capture.readBatch({ generation, afterSequence: 0, ...options }), "INVALID_LIMIT");
    }
    assert.deepEqual(capture.status(), before);
  });

  it("keeps an unread prefix if a defensive read copy fails", () => {
    const capture = new FrameCaptureBuffer();
    captureText(capture, "a");
    captureText(capture, "b", 2);
    const before = capture.status();
    const alloc = Buffer.allocUnsafeSlow;
    let allocations = 0;
    Buffer.allocUnsafeSlow = (size) => {
      if (++allocations === 2) throw new Error("read-copy fault");
      return alloc(size);
    };
    try {
      assert.throws(() => readFrames(capture), /read-copy fault/);
    } finally {
      Buffer.allocUnsafeSlow = alloc;
    }
    assert.deepEqual(capture.status(), before);
    codeIs(() => capture.ackThrough({ generation: capture.generation, throughSequence: 1 }), "INVALID_ACK");
    assert.equal(readFrames(capture).frames.length, 2);
  });

  it("retains the first gap and finite evidence after ACK drains a terminal queue", () => {
    const capture = new FrameCaptureBuffer({ maxQueueFrames: 1 });
    captureText(capture, "a");
    captureText(capture, "b", 2);
    capture.markGap("LATER_GAP");
    readFrames(capture);
    const status = capture.ackThrough({ generation: capture.generation, throughSequence: 1 });
    assert.deepEqual(status.firstGap, { reason: "QUEUE_OVERFLOW", afterSequence: 1 });
    status.firstGap.reason = "MUTATED";
    assert.equal(capture.status().firstGap.reason, "QUEUE_OVERFLOW");
    capture.close("LATER_CLOSE");
    assert.equal(capture.status().state, "CLOSED");
    assert.equal(captureText(capture, "c", 3).reason, "QUEUE_OVERFLOW");
    assert.equal(readFrames(capture).frames.length, 0);
    assert.equal(readFrames(capture).firstGap.reason, "QUEUE_OVERFLOW");
    codeIs(() => capture.markGap("x".repeat(1000)), "INVALID_REASON");
  });

  it("requires a fresh genuine instance, an immutable generation and no manual append after binding", () => {
    const capture = new FrameCaptureBuffer();
    const second = new FrameCaptureBuffer();
    assert.notEqual(capture.generation, second.generation);
    assert.throws(() => { capture.generation = second.generation; }, TypeError);
    codeIs(() => unstartedPolygon({ capture() {} }), "INVALID_BUFFER");
    codeIs(() => unstartedPolygon(new Proxy(capture, {})), "INVALID_BUFFER");
    unstartedPolygon(capture);
    codeIs(() => captureText(capture, "manual"), "BOUND_CAPTURE");
    codeIs(() => unstartedPolygon(capture), "ALREADY_BOUND");
    captureText(second, "manual");
    codeIs(() => unstartedPolygon(second), "USED_GENERATION");
    const closed = new FrameCaptureBuffer();
    closed.close();
    codeIs(() => unstartedPolygon(closed), "USED_GENERATION");
  });

  it("ignores subclass and instance callbacks while keeping private caps and terminal state", () => {
    class CallbackTrap extends FrameCaptureBuffer {
      capture() { throw new Error("callback injected"); }
      close() { throw new Error("callback injected"); }
      markGap() { throw new Error("callback injected"); }
    }
    const capture = new CallbackTrap({ maxFrameBytes: 1 });
    const { polygon } = unstartedPolygon(capture);
    capture.capture = () => { throw new Error("own callback injected"); };
    polygon._receiveRawFrame(Buffer.from("null"));
    assert.equal(capture.status().firstGap.reason, "FRAME_TOO_LARGE");
    assert.doesNotThrow(() => polygon._onSocketClose(1006));
    assert.doesNotThrow(() => polygon.stop());
    assert.equal(capture.status().state, "CLOSED");
  });
});

describe("Polygon raw dispatcher capture and incumbent service parity", () => {
  it("does no monotonic/capture work when the fourth argument is absent", () => {
    const { polygon, calls } = unstartedPolygon();
    const original = process.hrtime.bigint;
    process.hrtime.bigint = () => { throw new Error("capture must be off"); };
    try {
      polygon._receiveRawFrame(Buffer.from(JSON.stringify({
        ev: "AM", sym: "NVDA", c: 123, s: FRAME_EPOCH, e: FRAME_EPOCH + 59999,
      })));
    } finally {
      process.hrtime.bigint = original;
    }
    assert.equal(calls.quotes.length, 1);
    assert.equal(calls.quotes[0][1].last, 123);
    assert.equal(Object.hasOwn(polygon.health(), "frameCapture"), false);
  });

  it("keeps A/AM, extended lanes, stale rejection and subscription behavior identical on and off", () => {
    const original = Date.now;
    Date.now = () => FRAME_EPOCH + 1050;
    try {
      const off = unstartedPolygon();
      const capture = new FrameCaptureBuffer();
      const on = unstartedPolygon(capture);
      const frames = [
        { ev: "A", sym: "LIVE", o: 170, h: 172, l: 169, c: 171, v: 20, s: FRAME_EPOCH, e: FRAME_EPOCH + 999 },
        { ev: "A", sym: "OLD", o: 170, h: 172, l: 169, c: 171, v: 20, s: FRAME_EPOCH - 180000, e: FRAME_EPOCH - 179001 },
        { ev: "AM", sym: "MINUTE", o: 10, h: 12, l: 9, c: 11, v: 2, s: FRAME_EPOCH, e: FRAME_EPOCH + 59999 },
        { ev: "AM", sym: "PRE", c: 20, s: FRAME_EPOCH - 3600000, e: FRAME_EPOCH - 3540001 },
      ];
      for (const fixture of [off, on]) {
        fixture.polygon.cluster = "live";
        fixture.polygon._receiveRawFrame(Buffer.from(JSON.stringify(frames)));
        fixture.polygon.ensureSubscribed("AAPL");
        fixture.polygon.cluster = "delayed";
        fixture.polygon.ensureSubscribed("MSFT");
      }
      assert.deepEqual(on.calls, off.calls);
      assert.deepEqual(on.polygon.health(), off.polygon.health());
      assert.equal(on.calls.quotes.length, 2);
      assert.equal(on.calls.extended.length, 1);
      assert.deepEqual(on.calls.sent.map((f) => f.params), ["A.AAPL", "AM.MSFT"]);
      assert.equal(capture.status().capturedFrames, 1);
    } finally {
      Date.now = original;
    }
  });

  it("preserves actual status handling including broad live entitlement demotion", () => {
    for (const enabled of [false, true]) {
      const capture = enabled ? new FrameCaptureBuffer() : undefined;
      const { polygon, calls, store } = unstartedPolygon(capture);
      let terminated = 0;
      polygon.ws = { terminate: () => { terminated++; } };
      polygon.cluster = "live";
      polygon.ensureSubscribed("AAPL");
      polygon._receiveRawFrame(Buffer.from('[{"ev":"status","status":"connected"},' +
        '{"ev":"status","status":"auth_success"},{"ev":"status","status":"success","message":"subscribed"}]'));
      assert.equal(polygon.authed, true);
      assert.equal(polygon.authFailed, false);
      assert.equal(calls.sent.at(-1).params, "A.AAPL");
      store.quotes.set("AAPL", { source: "polygon-live-second", last: 123, asOfMs: 1, lagMs: 0, tickOpen: 122 });
      polygon._receiveRawFrame(Buffer.from('{"ev":"status","status":"error","message":"subscription denied"}'));
      assert.equal(polygon.cluster, "delayed");
      assert.equal(store.quotes.get("AAPL").last, 123);
      assert.equal(store.quotes.get("AAPL").asOfMs, undefined);
      assert.equal(store.quotes.get("AAPL").tickOpen, undefined);
      assert.equal(store.quotes.get("AAPL").basis, "DELAYED_15M");
      assert.equal(terminated, 1);
      polygon._receiveRawFrame(Buffer.from('{"ev":"status","status":"auth_failed","message":"synthetic"}'));
      assert.equal(polygon.isHealthy(), false);
      if (capture) assert.equal(capture.status().capturedFrames, 3);
    }
  });

  it("retains malformed JSON, never heals the parse gap, and keeps later AM service alive", () => {
    const capture = new FrameCaptureBuffer();
    const { polygon, calls } = unstartedPolygon(capture);
    polygon._receiveRawFrame(Buffer.from('[{"p":1.00}'));
    polygon._receiveRawFrame(Buffer.from(JSON.stringify({
      ev: "AM", sym: "NVDA", c: 124, s: FRAME_EPOCH, e: FRAME_EPOCH + 59999,
    })));
    const batch = readFrames(capture);
    assert.equal(batch.frames[0].bytes.toString(), '[{"p":1.00}');
    assert.deepEqual(batch.firstGap, { reason: "PARSE_LOSS", afterSequence: 1 });
    assert.equal(batch.capturedFrames, 1);
    assert.equal(calls.quotes.length, 1);
    capture.ackThrough({ generation: capture.generation, throughSequence: 1 });
    assert.equal(readFrames(capture).firstGap.reason, "PARSE_LOSS");
  });

  it("records unsupported string input as a gap while preserving the old string parser behavior", () => {
    const capture = new FrameCaptureBuffer();
    const { polygon, calls } = unstartedPolygon(capture);
    polygon._receiveRawFrame(JSON.stringify({
      ev: "AM", sym: "NVDA", c: 125, s: FRAME_EPOCH, e: FRAME_EPOCH + 59999,
    }));
    assert.equal(calls.quotes.length, 1);
    assert.equal(capture.status().firstGap.reason, "FRAME_TYPE");
    assert.equal(capture.status().capturedFrames, 0);
  });

  it("isolates monotonic sampling failure and invalid receipt values from valid AM dispatch", () => {
    const originalMono = process.hrtime.bigint;
    const originalNow = Date.now;
    try {
      for (const invalid of [false, true]) {
        const capture = new FrameCaptureBuffer();
        const { polygon, calls } = unstartedPolygon(capture);
        process.hrtime.bigint = invalid ? () => 1n : () => { throw new Error("clock unavailable"); };
        Date.now = invalid ? () => 8_640_000_000_000_001 : originalNow;
        polygon._receiveRawFrame(Buffer.from(JSON.stringify({
          ev: "AM", sym: "NVDA", c: 126, s: FRAME_EPOCH, e: FRAME_EPOCH + 59999,
        })));
        assert.equal(calls.quotes.length, 1);
        assert.equal(capture.status().firstGap.reason, invalid ? "CLOCK_INVALID" : "CAPTURE_ERROR");
      }
    } finally {
      process.hrtime.bigint = originalMono;
      Date.now = originalNow;
    }
  });

  it("marks dispatch loss and rethrows the identical incumbent error", () => {
    const capture = new FrameCaptureBuffer();
    const { polygon } = unstartedPolygon(capture);
    const expected = new Error("incumbent sink failed");
    polygon._onMessage = () => { throw expected; };
    assert.throws(() => polygon._receiveRawFrame(Buffer.from('[{"ev":"AM"}]')), (error) => error === expected);
    assert.deepEqual(readFrames(capture).firstGap, { reason: "DISPATCH_LOSS", afterSequence: 1 });
  });

  it("terminates on stop/close without automatic recovery on later auth or frames", () => {
    const capture = new FrameCaptureBuffer();
    const { polygon, calls } = unstartedPolygon(capture);
    polygon._receiveRawFrame(Buffer.from("null"));
    polygon.ws = { terminate: () => polygon._onSocketClose(1000) };
    polygon.stop();
    polygon.stop();
    assert.equal(capture.status().state, "CLOSED");
    assert.equal(capture.status().firstGap.reason, "STOPPED");
    polygon._receiveRawFrame(Buffer.from('{"ev":"status","status":"auth_success"}'));
    assert.equal(polygon.authed, true, "incumbent status behavior still runs");
    assert.equal(capture.status().capturedFrames, 1);
    readFrames(capture);
    capture.ackThrough({ generation: capture.generation, throughSequence: 1 });
    assert.equal(capture.status().firstGap.reason, "STOPPED");
    assert.equal(calls.reconnects, 1);
  });

  it("wires the actual websocket callbacks to raw capture and permanent close, using only a fake socket", () => {
    const fs = require("node:fs");
    const vm = require("node:vm");
    const { createRequire } = require("node:module");
    const filename = require.resolve("../lib/polygon");
    const originalRequire = createRequire(filename);
    const sockets = [];
    class SyntheticSocket {
      static OPEN = 1;
      constructor(url) { this.url = url; this.handlers = new Map(); sockets.push(this); }
      on(event, fn) { this.handlers.set(event, fn); }
      emit(event, arg) { this.handlers.get(event)?.(arg); }
      send() { throw new Error("no send expected in fixture"); }
      terminate() { this.emit("close", 1006); }
    }
    const module = { exports: {} };
    const forbiddenTimer = () => { throw new Error("timer or network path forbidden"); };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      module, Buffer, process,
      require: (name) => name === "ws" ? SyntheticSocket : originalRequire(name),
      setInterval: forbiddenTimer, setTimeout: forbiddenTimer,
      clearInterval: forbiddenTimer, clearTimeout: forbiddenTimer,
    }, { filename });
    const capture = new module.exports.FrameCaptureBuffer();
    const polygon = new module.exports.Polygon({ quotes: new Map() }, "synthetic", null, { frameCapture: capture });
    let reconnects = 0;
    polygon._scheduleReconnect = () => { reconnects++; };
    polygon._connect();
    assert.equal(sockets.length, 1);
    sockets[0].emit("message", Buffer.from('[{"ev":"status","status":"success","n":1.000}]'));
    const before = capture.readBatch({ generation: capture.generation, afterSequence: 0 });
    assert.equal(before.frames[0].bytes.toString(), '[{"ev":"status","status":"success","n":1.000}]');
    sockets[0].emit("close", 1006);
    assert.equal(capture.status().firstGap.reason, "SOCKET_CLOSED");
    assert.equal(capture.status().state, "CLOSED");
    assert.equal(reconnects, 1);
    polygon._connect();
    assert.equal(sockets.length, 2);
    sockets[1].emit("message", Buffer.from("null"));
    assert.equal(capture.status().capturedFrames, 1);
    assert.equal(capture.status().firstGap.reason, "SOCKET_CLOSED");

    const errorCapture = new module.exports.FrameCaptureBuffer();
    const errorPolygon = new module.exports.Polygon({ quotes: new Map() }, "synthetic", null, { frameCapture: errorCapture });
    errorPolygon._scheduleReconnect = () => { reconnects++; };
    errorPolygon._connect();
    sockets[2].emit("error", new Error("synthetic transport fault"));
    assert.equal(errorCapture.status().state, "GAP");
    assert.equal(errorCapture.status().firstGap.reason, "SOCKET_ERROR");
    sockets[2].emit("message", Buffer.from("null"));
    assert.equal(errorCapture.status().capturedFrames, 0);
    sockets[2].emit("close", 1006);
    assert.equal(errorCapture.status().state, "CLOSED");
    assert.equal(errorCapture.status().firstGap.reason, "SOCKET_ERROR");
  });
});

describe("FrameCaptureBuffer stable fragment inspection bound", () => {
  it("uses one validated count even when later length reads would expand the array", () => {
    for (const initialCount of [0, 1, 128]) {
      const underlying = Array.from({ length: 129 }, () => Buffer.alloc(0));
      let lengthReads = 0;
      let inspected = 0;
      const raw = new Proxy(underlying, {
        get(target, key, receiver) {
          if (key === "length") return ++lengthReads === 1 ? initialCount : 129;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          if (/^[0-9]+$/.test(String(key))) inspected++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const capture = new FrameCaptureBuffer();
      assert.equal(capture.capture(raw, frameClocks()).accepted, true);
      assert.equal(lengthReads, 1, "the admitted count must remain stable for the whole read");
      assert.equal(inspected, initialCount);
      assert.ok(inspected <= 128, "inspection must never reach a129th fragment");
      assert.equal(capture.status().capturedBytes, 0);
      assert.equal(capture.status().firstGap, null);
    }
  });

  it("rejects unsafe or out-of-range reported counts before inspecting fragments", () => {
    for (const partCount of [-1, 0.5, NaN, Infinity, 129, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      let inspected = 0;
      const raw = new Proxy([Buffer.from("x")], {
        get(target, key, receiver) {
          return key === "length" ? partCount : Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          if (/^[0-9]+$/.test(String(key))) inspected++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const capture = new FrameCaptureBuffer();
      assert.equal(capture.capture(raw, frameClocks()).reason, "FRAME_SHAPE");
      assert.equal(inspected, 0);
      assert.equal(capture.status().capturedFrames, 0);
      assert.equal(capture.status().state, "GAP");
    }
  });
});
