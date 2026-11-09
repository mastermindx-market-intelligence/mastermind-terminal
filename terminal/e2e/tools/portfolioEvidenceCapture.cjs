"use strict";

// Geometry and complete-packet checks shared by the two incumbent Portfolio
// producers. Their native journeys, fixtures and server lifecycle stay outside.
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function measurePanel(element) {
  const r = element.getBoundingClientRect();
  const clips = value => /^(auto|scroll|hidden|clip)$/.test(value);
  const clippedBy = [];
  for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
    const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
    const left = box.left + parent.clientLeft, top = box.top + parent.clientTop;
    const horizontal = clips(style.overflowX) && (r.left < left - 1 || r.right > left + parent.clientWidth + 1);
    const vertical = clips(style.overflowY) && (r.top < top - 1 || r.bottom > top + parent.clientHeight + 1);
    if (horizontal || vertical) clippedBy.push({ tag: parent.tagName, className: parent.className, horizontal, vertical });
  }
  const own = getComputedStyle(element);
  if ((clips(own.overflowX) && element.scrollWidth > element.clientWidth + 1)
    || (clips(own.overflowY) && element.scrollHeight > element.clientHeight + 1)) clippedBy.push({ tag: "SELF" });
  return {
    rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
    viewport: { width: innerWidth, height: innerHeight },
    documentSize: {
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    },
    clippedBy, content: element.textContent,
  };
}

function clipForPanel(snapshot, pad) {
  const r = snapshot.rect;
  assert.ok([r.x, r.y, r.width, r.height, pad].every(Number.isFinite), "Invalid panel geometry");
  assert.ok(r.width > 0 && r.height > 0 && pad >= 0, "Empty panel geometry");
  assert.deepEqual(snapshot.clippedBy, [], "Native panel is clipped by an overflow ancestor");
  const x = Math.max(0, Math.floor(r.x - pad)), y = Math.max(0, Math.floor(r.y - pad));
  const right = Math.min(snapshot.documentSize.width, Math.ceil(r.x + r.width + pad));
  const bottom = Math.min(snapshot.documentSize.height, Math.ceil(r.y + r.height + pad));
  assert.ok(x <= r.x && y <= r.y && right >= r.x + r.width && bottom >= r.y + r.height,
    "Document clip would truncate the panel");
  return { x, y, width: right - x, height: bottom - y };
}

async function assertNoNextIndicator(page, name) {
  const count = await page.locator("[data-nextjs-dev-tools-button]").count();
  assert.equal(count, 0, `${name}: Next.js indicator is mounted; fixture suppression failed`);
}

async function capturePanel(page, locator, { name, pad = 18, minimumHeight = 0, timeoutMs = 5000 } = {}) {
  const target = locator.first();
  const requestedViewport = page.viewportSize();
  assert.ok(requestedViewport, "A fixed capture viewport is required");
  await target.waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(async () => {
    let timer;
    try {
      await Promise.race([document.fonts.ready,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Panel fonts did not settle")), 5000); })]);
    } finally { clearTimeout(timer); }
  });
  await target.scrollIntoViewIfNeeded();
  const deadline = Date.now() + timeoutMs;
  let previous = "", stable = 0, before;
  while (Date.now() < deadline) {
    const snapshot = await target.evaluate(measurePanel);
    const key = JSON.stringify(snapshot);
    stable = key === previous ? stable + 1 : 0;
    previous = key;
    if (stable >= 3) { before = snapshot; break; }
    await page.waitForTimeout(100);
  }
  assert.ok(before, `${name}: panel position, size or content did not settle`);
  assert.deepEqual(before.viewport, requestedViewport, "Capture must preserve the requested viewport");
  assert.ok(before.rect.height >= minimumHeight, `${name}: panel is unexpectedly short`);
  const clip = clipForPanel(before, pad);
  await assertNoNextIndicator(page, name);
  // Buffer first: a moving or truncated image must never become an accepted cell.
  const bytes = await page.screenshot({ fullPage: true, clip, scale: "css", caret: "initial", animations: "allow" });
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "Expected a PNG capture");
  assert.equal(bytes.readUInt32BE(16), clip.width, "PNG width was truncated");
  assert.equal(bytes.readUInt32BE(20), clip.height, "PNG height was truncated");
  assert.deepEqual(await target.evaluate(measurePanel), before, "Layout or content changed during capture");
  assert.deepEqual(page.viewportSize(), requestedViewport, "Capture changed the viewport");
  await assertNoNextIndicator(page, name);
  return { bytes, geometry: { requestedViewport, clip, panel: before.rect, clippedBy: before.clippedBy } };
}

function publishPacket(out, captures, expectedFiles, evidence) {
  assert.equal(typeof evidence, "string", "Capture manifest must be text");
  assert.ok(evidence.trim(), "Capture manifest must not be empty");
  assert.ok(expectedFiles.length > 0 && new Set(expectedFiles).size === expectedFiles.length, "Expected inventory must be nonempty and unique");
  const actual = captures.map(capture => capture.file);
  assert.equal(new Set(actual).size, actual.length, "Duplicate capture cell");
  assert.deepEqual([...actual].sort(), [...expectedFiles].sort(), "Incomplete capture inventory");
  for (const capture of captures) {
    assert.match(capture.file, /^[a-z0-9-]+\.png$/);
    assert.ok(Buffer.isBuffer(capture.bytes) && capture.bytes.length >= 24, "Missing capture bytes");
  }
  mkdirSync(out, { recursive: true });
  for (const capture of captures) writeFileSync(join(out, capture.file), capture.bytes);
  writeFileSync(join(out, "EVIDENCE.yml"), evidence, "utf8");
}

module.exports = { capturePanel, clipForPanel, assertNoNextIndicator, publishPacket };
