"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {MANIFESTS, planEvidenceCapture} = require("./plan-evidence-capture.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmx-evidence-scope-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const paths = Array.from({length: 9}, (_, i) => "terminal/components/source-" + i + ".tsx");
  const hashes = paths.map((rel, i) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const bytes = Buffer.from("immutable layout " + i + "\n");
    fs.writeFileSync(file, bytes);
    return crypto.createHash("sha256").update(bytes).digest("hex");
  });
  const render = (lockPaths = paths, lockHashes = hashes) =>
    "metadata: verified\nlayoutFiles:\n" + lockPaths.map((rel, i) =>
      "  " + rel + ': "' + lockHashes[i] + '"').join("\n") + "\nother: metadata\n";
  for (const manifest of MANIFESTS) {
    const file = path.join(root, manifest);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, render());
  }
  return {root, paths, hashes, render, manifest: path.join(root, MANIFESTS[1])};
}

test("exact hash-locked integrated source may omit redundant evidence captures", t => {
  const f = fixture(t);
  const result = planEvidenceCapture(f.root);
  assert.deepEqual(result, {capture: false, reason: "locked-source-match", stale: []});
});

test("a changed layout source requires real current-checkout browser capture", t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, f.paths[3]), "changed on protected base\n");
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true);
  assert.equal(result.reason, "source-drift");
  assert.deepEqual(result.stale, [f.paths[3]]);
});

test("missing layout source never earns a skip", t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, f.paths[0]));
  assert.deepEqual(
    {capture: planEvidenceCapture(f.root).capture, reason: planEvidenceCapture(f.root).reason},
    {capture: true, reason: "fail-closed"}
  );
});

test("missing or malformed evidence manifest conservatively recaptures", t => {
  const f = fixture(t);
  fs.rmSync(f.manifest);
  assert.equal(planEvidenceCapture(f.root).capture, true);
  fs.writeFileSync(f.manifest, "layoutFiles:\n  tampered: x\n");
  assert.equal(planEvidenceCapture(f.root).capture, true);
});

test("conflicting source locks across packets cannot skip capture", t => {
  const f = fixture(t);
  const h = [...f.hashes];
  h[0] = "a".repeat(64);
  fs.writeFileSync(f.manifest, f.render(f.paths, h));
  assert.deepEqual(
    {capture: planEvidenceCapture(f.root).capture, reason: planEvidenceCapture(f.root).reason},
    {capture: true, reason: "fail-closed"}
  );
});

test("unsafe source path cannot escape repository while planning", t => {
  const f = fixture(t);
  const paths = [...f.paths];
  paths[0] = "terminal/../secret";
  fs.writeFileSync(f.manifest, f.render(paths, f.hashes));
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true);
  assert.equal(result.reason, "fail-closed");
});

test("empty or truncated hash inventory never permits skip", t => {
  const f = fixture(t);
  fs.writeFileSync(f.manifest, f.render(f.paths.slice(0, 4), f.hashes));
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true);
  assert.equal(result.reason, "fail-closed");
});
