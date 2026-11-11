"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { startServer, stopServer, withCaptureResources } = require("./capture_f12_b5_2_team_workspaces.cjs");

function owned(pid = 73123) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => assert.fail("PID fallback must never run");
  return startServer({ spawnProcess: () => child });
}

function controls(onSignal = () => {}) {
  const calls = [];
  let timer;
  let clears = 0;
  const options = {
    signalGroup: (pid, signal) => {
      calls.push([pid, signal]);
      assert.equal(signal, "SIGTERM");
      return onSignal(pid, signal);
    },
    setTimer: (callback) => { timer = callback; return 17; },
    clearTimer: (id) => { assert.equal(id, 17); clears += 1; },
  };
  return { options, calls, expire: () => timer(), clears: () => clears };
}

test("shutdown sends one signal and waits for close, not exit", async () => {
  const child = owned();
  const c = controls();
  const result = stopServer(child, c.options);
  let settled = false;
  result.then(() => { settled = true; });
  child.emit("exit", null, "SIGTERM");
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(c.calls, [[-73123, "SIGTERM"]]);
  child.emit("close", null, "SIGTERM");
  assert.deepEqual(await result, { code: null, signal: "SIGTERM" });
  assert.equal(c.clears(), 1);
  assert.equal(stopServer(child, c.options), result);
  assert.equal(c.calls.length, 1);
});

test("already closed owned child is not signalled", async () => {
  const child = owned();
  const c = controls();
  child.emit("close", 0, null);
  assert.deepEqual(await stopServer(child, c.options), { code: 0, signal: null });
  assert.deepEqual(c.calls, []);
});

for (const code of ["EPERM", "EACCES", "EIO"]) {
  test(code + " preserves the original error and cannot retry after later close", async () => {
    const child = owned();
    const error = Object.assign(new Error(code), { code });
    const c = controls(() => { throw error; });
    const result = stopServer(child, c.options);
    await assert.rejects(result, (actual) => actual === error);
    child.emit("close", null, "SIGTERM");
    const again = stopServer(child, c.options);
    assert.equal(again, result);
    await assert.rejects(again, (actual) => actual === error);
    assert.deepEqual(c.calls, [[-73123, "SIGTERM"]]);
  });
}

test("ESRCH still requires close and never falls back", async () => {
  const child = owned();
  const c = controls(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
  const result = stopServer(child, c.options);
  let settled = false;
  result.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit("close", 1, null);
  assert.deepEqual(await result, { code: 1, signal: null });
  assert.deepEqual(c.calls, [[-73123, "SIGTERM"]]);
  assert.equal(c.clears(), 1);
});

for (const signalError of [null, "ESRCH"]) {
  test("missing close remains failure: " + (signalError || "signal accepted"), async () => {
    const child = owned();
    const c = controls(() => {
      if (signalError) throw Object.assign(new Error("gone"), { code: signalError });
    });
    const result = stopServer(child, c.options);
    const rejected = assert.rejects(result, { code: "OWNED_SERVER_CLOSE_TIMEOUT" });
    c.expire();
    await rejected;
    assert.equal(c.clears(), 1);
    assert.equal(stopServer(child, c.options), result);
    assert.equal(c.calls.length, 1);
  });
}

test("unowned or changed process identity cannot be signalled", async () => {
  const c = controls();
  await assert.rejects(stopServer({ pid: 73123 }, c.options), /unowned/);
  const child = owned();
  child.pid = 73124;
  await assert.rejects(stopServer(child, c.options), /stable process identity/);
  assert.deepEqual(c.calls, []);
});

test("spawn failure preserves the original error without signalling", async () => {
  const child = owned();
  child.pid = undefined;
  const error = Object.assign(new Error("spawn failed"), { code: "ENOENT" });
  child.emit("error", error);
  child.emit("close", -2, null);
  const c = controls();
  await assert.rejects(stopServer(child, c.options), (actual) => actual === error);
  assert.deepEqual(c.calls, []);
});

test("an owned child error during shutdown remains identifiable", async () => {
  const child = owned();
  const c = controls();
  const result = stopServer(child, c.options);
  const error = Object.assign(new Error("child failure"), { code: "EACCES" });
  child.emit("error", error);
  await assert.rejects(result, (actual) => actual === error);
  child.emit("close", 1, null);
  assert.equal(stopServer(child, c.options), result);
  assert.equal(c.calls.length, 1);
  assert.equal(c.clears(), 1);
});

test("browser launch failure still waits for the owned server close", async () => {
  const child = owned();
  const failure = new Error("browser launch failed");
  const c = controls();
  let captureCalled = false;
  const result = withCaptureResources(() => { captureCalled = true; }, {
    start: () => child,
    launch: async () => { throw failure; },
    stop: (server) => stopServer(server, c.options),
  });
  await Promise.resolve();
  assert.equal(captureCalled, false);
  assert.equal(c.calls.length, 1);
  const rejected = assert.rejects(result, (actual) => actual === failure);
  child.emit("close", null, "SIGTERM");
  await rejected;
});

test("capture failure closes browser and settles server before returning failure", async () => {
  const child = owned();
  const events = [];
  const failure = new Error("capture failed");
  const c = controls(() => { events.push("server signal"); child.emit("close", null, "SIGTERM"); });
  await assert.rejects(withCaptureResources(async () => { throw failure; }, {
    start: () => child,
    launch: async () => ({ close: async () => { events.push("browser close"); } }),
    stop: (server) => stopServer(server, c.options),
  }), (actual) => actual === failure);
  assert.deepEqual(events, ["browser close", "server signal"]);
});

test("browser-close failure cannot skip owned-server settlement", async () => {
  const child = owned();
  const failure = new Error("browser close failed");
  const c = controls(() => child.emit("close", null, "SIGTERM"));
  await assert.rejects(withCaptureResources(async () => "captured", {
    start: () => child,
    launch: async () => ({ close: async () => { throw failure; } }),
    stop: (server) => stopServer(server, c.options),
  }), (actual) => actual === failure);
  assert.equal(c.calls.length, 1);
});

test("capture, browser-close and signal refusal all survive cleanup", async () => {
  const child = owned();
  const captureError = new Error("capture failed");
  const closeError = new Error("browser close failed");
  const refusal = Object.assign(new Error("denied"), { code: "EPERM" });
  const c = controls(() => { throw refusal; });
  await assert.rejects(withCaptureResources(async () => { throw captureError; }, {
    start: () => child,
    launch: async () => ({ close: async () => { throw closeError; } }),
    stop: (server) => stopServer(server, c.options),
  }), (actual) => actual instanceof AggregateError
    && actual.errors.length === 3
    && actual.errors[0] === captureError
    && actual.errors[1] === closeError
    && actual.errors[2] === refusal);
  assert.equal(c.calls.length, 1);
});

test("successful resource scope returns actual close observation", async () => {
  const child = owned();
  const c = controls(() => child.emit("close", null, "SIGTERM"));
  const result = await withCaptureResources(async () => "captured", {
    start: () => child,
    launch: async () => ({ close: async () => {} }),
    stop: (server) => stopServer(server, c.options),
  });
  assert.deepEqual(result, { result: "captured", serverClose: { code: null, signal: "SIGTERM" }, serverPid: 73123 });
});

test("PID one cannot become a process-group signal target", async () => {
  const child = owned(1);
  const c = controls();
  await assert.rejects(stopServer(child, c.options), /stable process identity/);
  assert.deepEqual(c.calls, []);
});

test("server closure before capture prevents the callback and still closes browser", async () => {
  const child = owned();
  const c = controls();
  let captured = false;
  let browserClosed = false;
  await assert.rejects(withCaptureResources(async () => { captured = true; }, {
    start: () => child,
    launch: async () => {
      child.emit("close", 1, null);
      return { close: async () => { browserClosed = true; } };
    },
    stop: (server) => stopServer(server, c.options),
  }), { code: "OWNED_SERVER_PREMATURE_CLOSE" });
  assert.equal(captured, false);
  assert.equal(browserClosed, true);
  assert.deepEqual(c.calls, []);
});

test("server closure during capture cannot become successful proof", async () => {
  const child = owned();
  const c = controls();
  let browserClosed = false;
  await assert.rejects(withCaptureResources(async () => {
    child.emit("close", 1, null);
    return "captured";
  }, {
    start: () => child,
    launch: async () => ({ close: async () => { browserClosed = true; } }),
    stop: (server) => stopServer(server, c.options),
  }), { code: "OWNED_SERVER_PREMATURE_CLOSE" });
  assert.equal(browserClosed, true);
  assert.deepEqual(c.calls, []);
});

test("server closure during browser close remains before the shutdown boundary", async () => {
  const child = owned();
  const c = controls();
  await assert.rejects(withCaptureResources(async () => "captured", {
    start: () => child,
    launch: async () => ({ close: async () => { child.emit("close", 0, null); } }),
    stop: (server) => stopServer(server, c.options),
  }), { code: "OWNED_SERVER_PREMATURE_CLOSE" });
  assert.deepEqual(c.calls, []);
});
