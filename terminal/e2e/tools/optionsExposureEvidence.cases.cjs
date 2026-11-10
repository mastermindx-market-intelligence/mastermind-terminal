"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const reader = require("./optionsExposureEvidence.cjs");
const owner = require("./capture_ci_evidence.cjs");

function legacyFixture(run) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "eod-declaration-boundary-"));
  const packet = path.join(repo, owner.EOD_PACKET);
  fs.mkdirSync(packet, { recursive: true });
  const hashes = owner.EOD_LAYOUT_FILES.map(file => {
    const bytes = Buffer.from("isolated fixture: " + file);
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), bytes);
    return "  " + file + ': "' + createHash("sha256").update(bytes).digest("hex") + '"';
  });
  const producer = path.join(repo, owner.EOD_PRODUCER);
  fs.mkdirSync(path.dirname(producer), { recursive: true });
  fs.writeFileSync(producer, "// Isolated fixture; never executed.\n");
  for (const name of owner.EOD_CROPS)
    fs.writeFileSync(path.join(packet, name), Buffer.from("89504e470d0a1a0a00", "hex"));
  const manifest = "# isolated legacy fixture\nlayoutFiles:\n" + hashes.join("\n") +
    "\nfiles:\n" + owner.EOD_CROPS.map(file => "  - " + file).join("\n") + "\n";
  fs.writeFileSync(path.join(packet, "EVIDENCE.yml"), manifest);
  try { run(repo, packet, manifest); } finally { fs.rmSync(repo, { recursive: true, force: true }); }
}

test("an undeclared legacy packet retains the existing owner capture decision", () => legacyFixture(repo => {
  assert.equal(reader.optionalQualifiedOptionsExposurePacket(repo, "eod", owner.EOD_CROPS), null);
  const packet = owner.eodPacket(repo);
  assert.equal(packet.plan.required, false);
  assert.equal(packet.files.length, 126);
}));

for (const operation of ["exposure-source-compatibility-20261105", "options-source-compatibility-20261105",
  "combined-source-compatibility-20261105"]) {
  test("qualified history cannot silently fall back after its declaration disappears: " + operation, () =>
    legacyFixture((repo, packet, manifest) => {
      fs.mkdirSync(path.join(packet, "operations", operation), { recursive: true });
      assert.throws(() => owner.eodPacket(repo), /MISSING_PACKET_DECLARATION/);
      assert.equal(fs.readFileSync(path.join(packet, "EVIDENCE.yml"), "utf8"), manifest);
    }));
}

test("a corrupt declared successor is refused before the raw root can be reused or overwritten", () =>
  legacyFixture((repo, packet, manifest) => {
    const corrupt = "exposureMasterIntegration20261109:\n  revision: invalid\n\n" + manifest;
    fs.writeFileSync(path.join(packet, "EVIDENCE.yml"), corrupt);
    assert.throws(() => owner.eodPacket(repo), /ENOENT|INTEGRATION_PACKET_DIGEST/);
    assert.equal(fs.readFileSync(path.join(packet, "EVIDENCE.yml"), "utf8"), corrupt);
  }));
