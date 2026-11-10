"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { capturePanel, clipForPanel, publishPacket } = require("./portfolioEvidenceCapture.cjs");

const snapshot = (overrides = {}) => ({
  rect: { x: 50, y: 826, width: 1340, height: 367 },
  viewport: { width: 1440, height: 900 },
  documentSize: { width: 1440, height: 2000 },
  clippedBy: [], content: "Complete requested condition", ...overrides,
});
const png = (width, height) => {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
function fixture(t, { states = [snapshot()], after, screenshot, indicator = () => 0 } = {}) {
  let now = 0, index = 0, captured = false;
  const screenshots = [];
  t.mock.method(Date, "now", () => now);
  const target = {
    first() { return this; }, async waitFor() {}, async scrollIntoViewIfNeeded() {},
    async evaluate() {
      if (captured && after) return after;
      const value = typeof states === "function" ? states(index) : states[Math.min(index, states.length - 1)];
      index += 1; return structuredClone(value);
    },
  };
  const page = {
    viewportSize: () => ({ width: 1440, height: 900 }), async evaluate() {},
    async waitForTimeout(ms) { now += ms; },
    locator: () => ({ count: async () => indicator(captured) }),
    async screenshot(options) {
      captured = true; screenshots.push(options);
      return screenshot ? screenshot(options) : png(options.clip.width, options.clip.height);
    },
  };
  return { page, target, screenshots, samples: () => index };
}

test("keeps the original 1372 by 399 panel below the 900px viewport", () => {
  assert.deepEqual(clipForPanel(snapshot(), 16), { x: 34, y: 810, width: 1372, height: 399 });
  assert.deepEqual(clipForPanel(snapshot({ rect: { x: 50, y: 826, width: 1340, height: 1000 } }), 16),
    { x: 34, y: 810, width: 1372, height: 1032 });
});

test("resets stability when position moves without a height change", async t => {
  const moved = snapshot(), earlier = snapshot({ rect: { ...moved.rect, y: 505 } });
  const f = fixture(t, { states: [earlier, earlier, moved, moved, moved, moved] });
  const result = await capturePanel(f.page, f.target, { name: "moving-y", pad: 16 });
  assert.ok(f.samples() >= 7);
  assert.equal(result.bytes.readUInt32BE(20), 399);
  assert.equal(f.screenshots.length, 1);
  assert.equal(f.screenshots[0].fullPage, true);
  assert.equal(Object.hasOwn(f.screenshots[0], "path"), false);
  assert.deepEqual(result.geometry.requestedViewport, { width: 1440, height: 900 });
});

test("continuous motion times out before capturing", async t => {
  const f = fixture(t, { states: i => snapshot({ rect: { x: 50, y: 826 + i, width: 1340, height: 367 } }) });
  await assert.rejects(capturePanel(f.page, f.target, { name: "never-stable", timeoutMs: 500 }), /did not settle/);
  assert.equal(f.screenshots.length, 0);
});

for (const [name, after] of [
  ["position", snapshot({ rect: { x: 50, y: 827, width: 1340, height: 367 } })],
  ["content", snapshot({ content: "Different condition" })],
]) test("rejects " + name + " changing during screenshot", async t => {
  const f = fixture(t, { after });
  await assert.rejects(capturePanel(f.page, f.target, { name, pad: 16 }), /changed during capture/);
});

for (const clippedBy of [[{ tag: "DIV", vertical: true }], [{ tag: "DIV", horizontal: true }], [{ tag: "SELF" }]]) {
  test("refuses native overflow clipping " + JSON.stringify(clippedBy), async t => {
    const f = fixture(t, { states: [snapshot({ clippedBy })] });
    await assert.rejects(capturePanel(f.page, f.target, { name: "clipped" }), /clipped by an overflow ancestor/);
    assert.equal(f.screenshots.length, 0);
  });
}

test("rejects a viewport-truncated PNG", async t => {
  const f = fixture(t, { screenshot: options => png(options.clip.width, 90) });
  await assert.rejects(capturePanel(f.page, f.target, { name: "truncated", pad: 16 }), /PNG height was truncated/);
});

test("rejects malformed PNG bytes", async t => {
  const f = fixture(t, { screenshot: () => Buffer.alloc(24) });
  await assert.rejects(capturePanel(f.page, f.target, { name: "invalid" }), /Expected a PNG/);
});

test("refuses an indicator before screenshot", async t => {
  const f = fixture(t, { indicator: () => 1 });
  await assert.rejects(capturePanel(f.page, f.target, { name: "indicator" }), /indicator is mounted/);
  assert.equal(f.screenshots.length, 0);
});

test("refuses an indicator appearing during screenshot", async t => {
  const f = fixture(t, { indicator: captured => captured ? 1 : 0 });
  await assert.rejects(capturePanel(f.page, f.target, { name: "late-indicator" }), /indicator is mounted/);
});

test("incomplete or invalid packets leave existing files untouched", () => {
  const out = mkdtempSync(join(tmpdir(), "portfolio-packet-contract-"));
  try {
    writeFileSync(join(out, "a.png"), "previous image");
    writeFileSync(join(out, "EVIDENCE.yml"), "previous manifest");
    const a = { file: "a.png", bytes: png(20, 20) }, b = { file: "b.png", bytes: png(20, 20) };
    for (const [captures, manifest] of [
      [[a], "qualified"], [[a, a], "qualified"], [[a, { ...b, file: "c.png" }], "qualified"],
      [[a, { ...b, bytes: Buffer.alloc(0) }], "qualified"], [[a, b], undefined], [[a, b], ""],
    ]) {
      assert.throws(() => publishPacket(out, captures, ["a.png", "b.png"], manifest));
      assert.equal(readFileSync(join(out, "a.png"), "utf8"), "previous image");
      assert.equal(readFileSync(join(out, "EVIDENCE.yml"), "utf8"), "previous manifest");
      assert.deepEqual(readdirSync(out).sort(), ["EVIDENCE.yml", "a.png"]);
    }
    publishPacket(out, [b, a], ["a.png", "b.png"], "qualified manifest");
    assert.equal(readFileSync(join(out, "EVIDENCE.yml"), "utf8"), "qualified manifest");
    assert.equal(readFileSync(join(out, "b.png")).readUInt32BE(16), 20);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
