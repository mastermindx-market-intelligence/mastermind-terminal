"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- pure Node evidence validation */

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, readdirSync, realpathSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { PNG } = require("pngjs");

const SCHEMA = "briefs.active-inbox.capture.v1";
const CONTRACT = "briefs.explicit-language.v1";
const MANIFEST = "capture.json";
const PACKET_PATH = "terminal/docs/pr-crops/b-f11-7-active-inbox";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = ["list", "empty"].flatMap(kind => Object.entries(VIEWPORTS).flatMap(([viewport, size]) =>
  ["en", "zh"].map(lang => ({ kind, viewport, lang,
    file: `${kind}-${size.width}${lang === "zh" ? "-zh" : ""}.png` }))));
const SOURCE_FILES = [
  "terminal/components/briefs/BriefsInbox.tsx",
  "terminal/components/briefs/briefs.module.css",
  "terminal/lib/briefs.ts",
  "terminal/components/alerts/AlertsCockpit.tsx",
  "terminal/components/alerts/alerts.module.css",
  "terminal/components/alerts/AlertsCockpitMount.tsx",
  "terminal/app/(shell)/alerts/page.tsx",
  "terminal/lib/i18n.tsx",
  "terminal/app/globals.css",
  "terminal/e2e/tools/capture_b_f11_7_recurring_briefs.cjs",
  "terminal/e2e/tools/briefs_inbox_capture_contract.cjs",
  "terminal/e2e/tools/capture_ci_evidence.cjs",
  "terminal/next.config.ts",
  "terminal/package.json",
  "terminal/package-lock.json",
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function regularBytes(path) {
  assert.equal(realpathSync(path), resolve(path), `Symlink evidence input: ${path}`);
  assert.ok(lstatSync(path).isFile(), `Evidence input is not a regular file: ${path}`);
  return readFileSync(path);
}

function sourceHashes(repo) {
  return Object.fromEntries(SOURCE_FILES.map(path => [path, sha256(regularBytes(join(repo, path)))]));
}

function lockedVersions(repo) {
  const lock = JSON.parse(regularBytes(join(repo, "terminal/package-lock.json")).toString("utf8"));
  return { next: lock.packages["node_modules/next"].version,
    playwright: lock.packages["node_modules/@playwright/test"].version };
}

function pngSize(bytes) {
  // Decode the entire image, including CRC/data validation. A PNG header alone
  // cannot qualify a truncated or corrupt screenshot.
  const png = PNG.sync.read(bytes, { checkCRC: true });
  assert.ok(png.width > 0 && png.height > 0);
  assert.equal(png.data.length, png.width * png.height * 4);
  return { width: png.width, height: png.height };
}

function validateInboxPacket(packet, currentSources, versions, readImage) {
  assert.equal(packet.schema, SCHEMA, "Current active-inbox schema required");
  assert.equal(packet.scope, "active-inbox");
  assert.equal(packet.theme, "dark");
  assert.equal(packet.producerActivation, false);
  assert.equal(packet.productionAcceptance, false);
  assert.equal(packet.contract, CONTRACT);
  assert.equal(packet.captureFlag, "TERMINAL_E2E_FIXTURE");
  assert.equal(packet.mechanism, "playwright-locator-screenshot");
  assert.match(packet.checkout.commit, /^[0-9a-f]{40}$/);
  assert.match(packet.checkout.tree, /^[0-9a-f]{40}$/);
  assert.ok(Number.isFinite(Date.parse(packet.capturedAt)), "Capture time required");
  assert.match(packet.runtime.node, /^v\d+\.\d+\.\d+$/);
  assert.equal(packet.runtime.next, versions.next, "Captured Next runtime differs from source lock");
  assert.equal(packet.runtime.playwright, versions.playwright);
  assert.deepEqual(Object.keys(packet.sources).sort(), [...SOURCE_FILES].sort());
  for (const path of SOURCE_FILES) {
    assert.match(packet.sources[path], /^[0-9a-f]{64}$/);
    assert.equal(packet.sources[path], currentSources[path], `${path} changed without a current capture`);
  }
  assert.deepEqual(packet.cleanup, { contextsClosed: 8, browserClosed: true, serverSettled: true });
  assert.ok(Array.isArray(packet.cases));
  assert.equal(packet.cases.length, SHOTS.length, "All eight active inbox cases are required");
  assert.equal(new Set(packet.cases.map(row => row.file)).size, SHOTS.length, "Duplicate inbox case");
  assert.deepEqual(packet.cases.map(row => row.file).sort(), SHOTS.map(row => row.file).sort());
  for (const shot of SHOTS) {
    const row = packet.cases.find(item => item.file === shot.file);
    assert.equal(row.kind, shot.kind);
    assert.equal(row.lang, shot.lang);
    assert.equal(row.route, "/alerts");
    assert.deepEqual(row.viewport, VIEWPORTS[shot.viewport]);
    assert.equal(row.deviceScaleFactor, 1);
    assert.equal(row.proof.settled, true);
    assert.equal(row.proof.rows, shot.kind === "list" ? 2 : 0);
    assert.equal(row.proof.missRows, shot.kind === "list" ? 1 : 0);
    assert.equal(row.proof.pinnedRows, shot.kind === "list" ? 1 : 0);
    assert.equal(row.proof.subscriptionControls, 0);
    assert.equal(row.proof.unexpectedWrites, 0);
    assert.equal(row.proof.devIndicators, 0);
    assert.deepEqual(row.proof.browserErrors, []);
    assert.ok(Number.isInteger(row.proof.contractReads) && row.proof.contractReads >= 1);
    assert.ok(typeof row.proof.text === "string" && row.proof.text.length > 20);
    assert.equal(row.proof.textSha256, sha256(Buffer.from(row.proof.text)));
    const bytes = readImage(shot.file);
    assert.equal(sha256(bytes), row.image.sha256, `${shot.file}: image hash changed`);
    const size = pngSize(bytes);
    assert.deepEqual(size, { width: row.image.width, height: row.image.height });
    for (const key of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(row.crop[key]));
    assert.ok(row.crop.width > 0 && row.crop.height > 0);
    for (const key of ["x", "y"]) assert.ok(Number.isFinite(row.scrollOffset?.[key]),
      `${shot.file}: observed document scroll offsets required`);
    // Playwright 1.61.1 encloses both document-space edges at scale 1.
    // A fractional origin can add two edge pixels; width/height tolerances
    // both reject valid crops and accept incorrectly padded/cropped images.
    const x = row.crop.x + row.scrollOffset.x, y = row.crop.y + row.scrollOffset.y;
    const raster = {
      width: Math.ceil(x + row.crop.width - 0.001) - Math.floor(x + 0.001),
      height: Math.ceil(y + row.crop.height - 0.001) - Math.floor(y + 0.001),
    };
    assert.deepEqual(size, raster, `${shot.file}: exact document-edge crop differs`);
  }
  return packet;
}

function readInboxPacket(repo, directory = join(repo, PACKET_PATH)) {
  assert.equal(realpathSync(directory), resolve(directory), "Symlink packet directory");
  assert.deepEqual(readdirSync(directory).sort(), [MANIFEST, ...SHOTS.map(shot => shot.file)].sort(),
    "Only the complete current inbox packet may be selected");
  const packet = JSON.parse(regularBytes(join(directory, MANIFEST)).toString("utf8"));
  return validateInboxPacket(packet, sourceHashes(repo), lockedVersions(repo),
    file => regularBytes(join(directory, file)));
}

module.exports = { SCHEMA, CONTRACT, MANIFEST, PACKET_PATH, VIEWPORTS, SHOTS, SOURCE_FILES,
  sha256, regularBytes, sourceHashes, lockedVersions, pngSize, validateInboxPacket, readInboxPacket };
