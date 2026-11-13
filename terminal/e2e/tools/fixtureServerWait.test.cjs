"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { waitForFixtureServer } = require("./fixtureServerWait.cjs");
test("pending fetch is aborted inside the original absolute budget", async () => {
  let calls = 0, aborted = false;
  const started = Date.now();
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(waitForFixtureServer("http://fixture.invalid", 25, () => true, (_url, { signal }) => {
      calls++;
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }));
    }), /within 25ms/);
  } finally { clearInterval(keepAlive); }
  assert.equal(calls, 1); assert.equal(aborted, true); assert.ok(Date.now() - started < 1000);
});
test("successful response and ownership are both required", async () => {
  let checks = 0;
  await waitForFixtureServer("http://fixture.invalid", 50, () => { checks++; return true; }, async (_url, options) => {
    assert.equal(options.redirect, "manual"); assert.ok(options.signal instanceof AbortSignal); return { status: 200 };
  });
  assert.equal(checks, 2);
});
test("exited owned child prevents dispatch", async () => {
  let calls = 0;
  await assert.rejects(waitForFixtureServer("http://fixture.invalid", 50, () => { throw new Error("CAPTURE_SERVER_EXITED"); }, async () => { calls++; }), /CAPTURE_SERVER_EXITED/);
  assert.equal(calls, 0);
});
test("not-ready child consumes the same deadline with zero fetches", async () => {
  let calls = 0;
  await assert.rejects(waitForFixtureServer("http://fixture.invalid", 20, () => false, async () => { calls++; }), /within 20ms/);
  assert.equal(calls, 0);
});

test("fetch ignoring abort still settles at the same deadline", async () => {
  let signal;
  await assert.rejects(waitForFixtureServer("http://fixture.invalid", 20, () => true, (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  }), /within 20ms/);
  assert.equal(signal.aborted, true);
});
test("successful return clears deadline timer instead of later aborting", async () => {
  let signal;
  await waitForFixtureServer("http://fixture.invalid", 20, () => true, async (_url, options) => {
    signal = options.signal; return { status: 200 };
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, false);
});
