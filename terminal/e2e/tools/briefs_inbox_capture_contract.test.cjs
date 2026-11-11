"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- synthetic Node packet contract tests */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, dirname } = require("node:path");
const { runInNewContext } = require("node:vm");
const { PNG } = require("pngjs");
const { installInboxPreferences } = require("./capture_b_f11_7_recurring_briefs.cjs");
const { SCHEMA, CONTRACT, PACKET_PATH, MANIFEST, SHOTS, VIEWPORTS, SOURCE_FILES, sha256,
  sourceHashes, validateInboxPacket, readInboxPacket } = require("./briefs_inbox_capture_contract.cjs");

const versions = { next: "16.4.6", playwright: "1.61.1" };
for (const lang of ["en", "zh"]) for (const rootExists of [false, true]) {
  test(`serialized ${lang} preferences tolerate HTML root initially ${rootExists ? "present" : "absent"}`, () => {
    const storage = new Map(), attributes = new Map(), listeners = [];
    const root = { setAttribute: (key, value) => attributes.set(key, value) };
    const document = { documentElement: rootExists ? root : null,
      addEventListener: (name, callback, options) => listeners.push({ name, callback, options }) };
    // Execute the same standalone function Playwright serializes, before a
    // parser-created document element exists. This launches no browser.
    runInNewContext(`(${installInboxPreferences.toString()})(${JSON.stringify(lang)})`, {
      document, localStorage: { setItem: (key, value) => storage.set(key, value) },
    });
    assert.deepEqual(Object.fromEntries(storage), { "mm.lang": lang, theme: "dark", theme_auto: "0" });
    if (!rootExists) {
      assert.equal(attributes.size, 0);
      assert.equal(listeners.length, 1);
      assert.equal(listeners[0].name, "DOMContentLoaded");
      assert.equal(listeners[0].options.once, true);
      document.documentElement = root;
      listeners[0].callback();
    } else assert.equal(listeners.length, 0);
    assert.deepEqual(Object.fromEntries(attributes), {
      "data-theme": "dark", "data-lang": lang, lang: lang === "zh" ? "zh-CN" : "en",
    });
  });
}

function fixture() {
  const image = new PNG({ width: 3, height: 2 });
  image.data.fill(255);
  const bytes = PNG.sync.write(image);
  const sources = Object.fromEntries(SOURCE_FILES.map(path => [path, sha256(Buffer.from("synthetic " + path))]));
  const text = "Synthetic packet-validator fixture; this is not browser evidence.";
  const packet = {
    schema: SCHEMA, scope: "active-inbox", theme: "dark", contract: CONTRACT,
    producerActivation: false, productionAcceptance: false, captureFlag: "TERMINAL_E2E_FIXTURE",
    mechanism: "playwright-locator-screenshot", capturedAt: "2026-11-11T00:00:00.000Z",
    checkout: { commit: "a".repeat(40), tree: "b".repeat(40) },
    runtime: { node: process.version, ...versions }, sources,
    cleanup: { contextsClosed: 8, browserClosed: true, serverSettled: true },
    cases: SHOTS.map(shot => ({ file: shot.file, kind: shot.kind, lang: shot.lang, route: "/alerts",
      viewport: VIEWPORTS[shot.viewport], deviceScaleFactor: 1,
      crop: { x: 0, y: 0, width: 3, height: 2 },
      scrollOffset: { x: 0, y: 0 },
      image: { width: 3, height: 2, sha256: sha256(bytes) },
      proof: { settled: true, rows: shot.kind === "list" ? 2 : 0,
        missRows: shot.kind === "list" ? 1 : 0, pinnedRows: shot.kind === "list" ? 1 : 0,
        subscriptionControls: 0, unexpectedWrites: 0, devIndicators: 0, browserErrors: [],
        contractReads: 1, text, textSha256: sha256(Buffer.from(text)) },
    })),
  };
  return { packet, sources: structuredClone(sources), bytes };
}

test("accepts the exact synthetic eight-case matrix with separately bound crop geometry", () => {
  const { packet, sources, bytes } = fixture();
  assert.equal(validateInboxPacket(packet, sources, versions, () => bytes).cases.length, 8);
});

for (const example of [
  { name: "recorded desktop fractional edges", crop: { x: 80, y: 581.84375, width: 1340, height: 253.3125 },
    scrollOffset: { x: 0, y: 0 }, width: 1340, height: 255 },
  { name: "recorded mobile rectangle with synthetic integer scroll", file: "list-390.png",
    crop: { x: 20, y: 472.6875, width: 350, height: 371.53125 },
    scrollOffset: { x: 0, y: 267 }, width: 350, height: 373 },
  { name: "fractional document scroll offsets", crop: { x: 0.4, y: 0.6, width: 2.7, height: 1.2 },
    scrollOffset: { x: 0.3, y: 0.25 }, width: 4, height: 3 },
  { name: "subpixel epsilon at integer edges", crop: { x: 10.0001, y: 20.9999, width: 2.9998, height: 1.0002 },
    scrollOffset: { x: 0, y: 0 }, width: 3, height: 1 },
]) {
  test("accepts exact raster enclosure for " + example.name, () => {
    const { packet, sources, bytes } = fixture();
    const row = packet.cases.find(item => item.file === (example.file || "list-1440.png"));
    row.crop = example.crop;
    row.scrollOffset = example.scrollOffset;
    const image = new PNG({ width: example.width, height: example.height });
    image.data.fill(255);
    const raster = PNG.sync.write(image);
    row.image = { width: example.width, height: example.height, sha256: sha256(raster) };
    assert.equal(validateInboxPacket(packet, sources, versions,
      file => file === row.file ? raster : bytes).cases.length, 8);
  });
}

for (const dimension of ["width", "height"]) for (const delta of [-1, 1]) {
  test(`rejects a ${delta > 0 ? "padded" : "cropped"} one-pixel ${dimension} even with matching PNG metadata`, () => {
    const { packet, sources, bytes } = fixture();
    const row = packet.cases[0];
    const size = { width: 3, height: 2, [dimension]: row.image[dimension] + delta };
    const image = new PNG(size);
    image.data.fill(255);
    const raster = PNG.sync.write(image);
    row.image = { ...size, sha256: sha256(raster) };
    assert.throws(() => validateInboxPacket(packet, sources, versions,
      file => file === row.file ? raster : bytes));
  });
}

const mutations = {
  "historical packet schema": packet => { packet.schema = "historical"; },
  "historical scope": packet => { packet.scope = "mixed-subscriptions"; },
  "producer activation": packet => { packet.producerActivation = true; },
  "production acceptance": packet => { packet.productionAcceptance = true; },
  "unclosed browser": packet => { packet.cleanup.browserClosed = false; },
  "unsettled server": packet => { packet.cleanup.serverSettled = false; },
  "incomplete context cleanup": packet => { packet.cleanup.contextsClosed = 7; },
  "missing case": packet => { packet.cases.pop(); },
  "duplicate case": packet => { packet.cases[7] = structuredClone(packet.cases[0]); },
  "path outside the exact inventory": packet => { packet.cases[0].file = "../escape.png"; },
  "extra case": packet => { packet.cases.push(structuredClone(packet.cases[0])); },
  "source drift": packet => { packet.sources[SOURCE_FILES[0]] = "0".repeat(64); },
  "undeclared source": packet => { packet.sources["terminal/other.ts"] = "0".repeat(64); },
  "image hash drift": packet => { packet.cases[0].image.sha256 = "0".repeat(64); },
  "image dimension drift": packet => { packet.cases[0].image.width = 99; },
  "crop dimension drift": packet => { packet.cases[0].crop.width = 99; },
  "missing document scroll offsets": packet => { delete packet.cases[0].scrollOffset; },
  "non-finite document scroll offset": packet => { packet.cases[0].scrollOffset.y = Infinity; },
  "fractional scroll offset changes raster enclosure": packet => { packet.cases[0].scrollOffset.y = 0.5; },
  "viewport drift": packet => { packet.cases[0].viewport = { width: 390, height: 844 }; },
  "runtime drift": packet => { packet.runtime.next = "0.0.0"; },
  "missing contract": packet => { delete packet.contract; },
  "no contract read": packet => { packet.cases[0].proof.contractReads = 0; },
  "fractional contract read count": packet => { packet.cases[0].proof.contractReads = 1.5; },
  "unexpected mutation": packet => { packet.cases[0].proof.unexpectedWrites = 1; },
  "subscription controls": packet => { packet.cases[0].proof.subscriptionControls = 1; },
  "hidden development indicator": packet => { packet.cases[0].proof.devIndicators = 1; },
  "browser error": packet => { packet.cases[0].proof.browserErrors = ["fixture error"]; },
  "unsettled inbox": packet => { packet.cases[0].proof.settled = false; },
  "changed state text": packet => { packet.cases[0].proof.text = "Different state after the screenshot."; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test("rejects " + name, () => {
    const { packet, sources, bytes } = fixture();
    mutate(packet);
    assert.throws(() => validateInboxPacket(packet, sources, versions, () => bytes));
  });
}

for (const kind of ["truncated", "corrupt"]) {
  test("decodes and rejects a " + kind + " PNG even when its recorded hash matches", () => {
    const { packet, sources, bytes } = fixture();
    const bad = kind === "truncated" ? bytes.subarray(0, 24) : Buffer.from(bytes);
    if (kind === "corrupt") bad[bad.length - 5] ^= 1;
    packet.cases[0].image.sha256 = sha256(bad);
    assert.throws(() => validateInboxPacket(packet, sources, versions,
      file => file === packet.cases[0].file ? bad : bytes));
  });
}

function onDisk(t) {
  const root = mkdtempSync(join(tmpdir(), "briefs-packet-contract-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of SOURCE_FILES) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "synthetic " + path);
  }
  writeFileSync(join(root, "terminal/package-lock.json"), JSON.stringify({ packages: {
    "node_modules/next": { version: versions.next },
    "node_modules/@playwright/test": { version: versions.playwright },
  } }));
  const { packet, bytes } = fixture();
  packet.sources = sourceHashes(root);
  const directory = join(root, PACKET_PATH);
  mkdirSync(directory, { recursive: true });
  for (const shot of SHOTS) writeFileSync(join(directory, shot.file), bytes);
  writeFileSync(join(directory, MANIFEST), JSON.stringify(packet));
  return { root, directory, bytes };
}

test("reads only a complete regular-file packet on disk", t => {
  const { root } = onDisk(t);
  assert.equal(readInboxPacket(root).cases.length, 8);
});
test("rejects an extra file in the selected packet directory", t => {
  const { root, directory } = onDisk(t);
  writeFileSync(join(directory, "incomplete.json"), "{}");
  assert.throws(() => readInboxPacket(root));
});
test("rejects a symlink image instead of following it", t => {
  const { root, directory, bytes } = onDisk(t);
  const outside = join(root, "owned-test-image.png");
  writeFileSync(outside, bytes);
  unlinkSync(join(directory, SHOTS[0].file));
  symlinkSync(outside, join(directory, SHOTS[0].file));
  assert.throws(() => readInboxPacket(root), /Symlink evidence input/);
});
test("rejects a symlink packet directory", t => {
  const { root, directory } = onDisk(t);
  const alias = join(root, "packet-alias");
  symlinkSync(directory, alias);
  assert.throws(() => readInboxPacket(root, alias), /Symlink packet directory/);
});
