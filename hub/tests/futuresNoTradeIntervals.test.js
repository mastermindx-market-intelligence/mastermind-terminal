"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, BASE } = require("./fixtures/futuresCapture");
const { buildFuturesWorkspacePublication } = require("../lib/futuresWorkspaceProjection");
const nanos = ms => String(BigInt(ms) * 1000000n);
test("observed book intervals survive a minute with no captured executions", () => {
  const { capture, selection } = fixture();
  capture.trades[1] = { ...capture.trades[1], eventTimeNs: nanos(BASE + 121000),
    receiveTimeNs: nanos(BASE + 121000), availableAtNs: nanos(BASE + 121000) };
  capture.publication = { basis: "historical", sourceAsOfMs: BASE + 180000,
    publishedAtMs: BASE + 180100, freshUntilMs: BASE + 185000 };
  selection.cutoffsMs = [BASE + 180000];
  const result = buildFuturesWorkspacePublication(capture, selection);
  assert.equal(result.status, "ok");
  const frames = result.source.views[0].frames;
  assert.equal(frames.length, 3, "do not drop a valid depth minute just because footprint has no execution bar");
  assert.equal(frames[1].bar.kind, "no_captured_trades");
  assert.equal(frames[1].bar.openTicks, null); assert.equal(frames[1].bar.highTicks, null);
  assert.equal(frames[1].bar.closeTicks, null); assert.equal(frames[1].bar.lowTicks, null);
  assert.equal(frames[1].bar.total, 0); assert.deepEqual(frames[1].bar.cells, []);
  assert.equal(frames[1].bar.cvdKnown, 12); assert.equal(frames[1].bar.cvd, null);
  assert.equal(frames[1].depth.coverage, "full");
  assert.equal(frames.reduce((n, f) => n + f.bar.total, 0), 20);
});
test("a book-only window still renders its observed liquidity, not a fictitious price candle", () => {
  const { capture, selection } = fixture(); capture.trades = []; capture.tradeCoverage = "complete";
  const result = buildFuturesWorkspacePublication(capture, selection);
  assert.equal(result.status, "ok");
  const frames = result.source.views.at(-1).frames;
  assert.equal(frames.length, 2);
  for (const f of frames) {
    assert.equal(f.bar.kind, "no_captured_trades"); assert.equal(f.bar.openTicks, null);
    assert.equal(f.bar.total, 0); assert.equal(f.bar.cvdKnown, 0); assert.equal(f.bar.cvd, 0);
    assert.equal(f.depth.coverage, "full");
  }
});

test("leading and trailing empty intervals retain unknown-side cumulative quality", () => {
  const { capture, selection } = fixture(); capture.tradeCoverage = "complete";
  capture.trades = [{ ...capture.trades[0], aggressor: "unknown", eventTimeNs: nanos(BASE + 61000),
    receiveTimeNs: nanos(BASE + 61000), availableAtNs: nanos(BASE + 61000) }];
  capture.publication = { basis: "historical", sourceAsOfMs: BASE + 180000,
    publishedAtMs: BASE + 180100, freshUntilMs: BASE + 185000 };
  selection.cutoffsMs = [BASE + 180000];
  const result = buildFuturesWorkspacePublication(capture, selection); assert.equal(result.status, "ok");
  const frames = result.source.views[0].frames;
  assert.equal(frames.length, 3); assert.equal(frames[0].bar.kind, "no_captured_trades");
  assert.equal(frames[2].bar.kind, "no_captured_trades");
  assert.deepEqual(frames.map(f => f.bar.cvd), [0, null, null]);
  assert.deepEqual(frames.map(f => f.bar.cvdKnown), [0, 0, 0]);
  assert.equal(frames.reduce((n, f) => n + f.bar.total, 0), 12);
});
