"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- synthetic Node packet contract tests */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, dirname } = require("node:path");
const { PNG } = require("pngjs");
const { SCHEMA, CONTRACT, PACKET_PATH, MANIFEST, SHOTS, VIEWPORTS, SOURCE_FILES, sha256,
  sourceHashes, validateInboxPacket, readInboxPacket } = require("./briefs_inbox_capture_contract.cjs");

const versions = { next: "16.4.6", playwright: "1.61.1" };
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
