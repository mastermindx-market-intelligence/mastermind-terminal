"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// A packet that locks the capture control at a stale hash cannot validate its
// own crops and orders a needless recapture of that packet. The lock must name
// the committed control byte-for-byte; renew it by recapturing the packet with
// its own producer, never by editing the hash here.
test("every packet that locks the capture control records the committed control hash", () => {
  const repo = path.resolve(__dirname, "../../..");
  const control = "terminal/e2e/tools/capture_ci_evidence.cjs";
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, control))).digest("hex");
  const crops = path.join(repo, "terminal/docs/pr-crops");
  const holders = [];
  for (const packet of fs.readdirSync(crops)) {
    const manifest = path.join(crops, packet, "EVIDENCE.yml");
    if (!fs.existsSync(manifest)) continue;
    const lines = fs.readFileSync(manifest, "utf8").split(/\r?\n/);
    const start = lines.indexOf("layoutFiles:");
    if (start < 0) continue;
    for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) {
      const row = /^  (\S+): "?([0-9a-f]{64})"?$/.exec(lines[i]);
      if (row && row[1] === control) holders.push({packet, file: "EVIDENCE.yml", expected: row[2]});
    }
  }
  // Packets whose own vitest suite validates a capture.json source map hold the
  // same lock; an inventory of EVIDENCE.yml alone let a stale one reach CI.
  for (const packet of fs.readdirSync(crops)) {
    const packetFile = path.join(crops, packet, "capture.json");
    if (!fs.existsSync(packetFile)) continue;
    const sources = JSON.parse(fs.readFileSync(packetFile, "utf8")).sources;
    if (sources && typeof sources[control] === "string") {
      holders.push({packet, file: "capture.json", expected: sources[control]});
    }
  }
  assert.ok(holders.length > 0, "no packet locks " + control + "; the lock inventory is broken");
  for (const holder of holders) {
    assert.equal(holder.expected, actual,
      holder.packet + "/" + holder.file + " locks " + control + " at a stale hash — recapture that packet with its own producer");
  }
});

