"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const rawContracts = require("../../e2e/tools/gex_failure_capture.cjs").contracts();
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
    const packet = rawContracts.find(packet => manifest === `terminal/docs/pr-crops/${packet.directory}/EVIDENCE.yml`);
    if (packet) {
      const packetHashes = packet.layoutFiles.map(rel => {
        const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), {recursive: true});
        if (!fs.existsSync(target)) fs.writeFileSync(target, "controlled raw source " + rel);
        return crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      });
      fs.writeFileSync(file, render(packet.layoutFiles, packetHashes));
    } else fs.writeFileSync(file, render());
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


test("merge-group cannot skip a changed Gex raw packet when PL6 and VI sources still match", t => {
  const f = fixture(t), rel = "terminal/components/gexdesk/GexDeskView.tsx";
  assert.equal(planEvidenceCapture(f.root).capture, false);
  fs.appendFileSync(path.join(f.root, rel), " changed");
  assert.deepEqual(planEvidenceCapture(f.root).stale, [rel]);
  assert.equal(planEvidenceCapture(f.root).capture, true);
});

test("dropped Gex from both actual raw maps fails closed even though10/11 rows remain", t => {
  const f = fixture(t), rel = "terminal/components/gexdesk/GexDeskView.tsx";
  assert.deepEqual(rawContracts.map(packet => packet.layoutFiles.length), [11, 12]);
  for (const packet of rawContracts) {
    const file = path.join(f.root, "terminal/docs/pr-crops", packet.directory, "EVIDENCE.yml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").split("\n").filter(line => !line.startsWith("  " + rel + ":")).join("\n"));
  }
  fs.appendFileSync(path.join(f.root, rel), " unobserved drift");
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true);
  assert.equal(result.reason, "fail-closed");
});

for (const packet of rawContracts) for (const defect of ["missing", "substituted", "duplicate"]) test(`${packet.id} raw keys ${defect} cannot authorize a skip`, t => {
  const f = fixture(t), file = path.join(f.root, "terminal/docs/pr-crops", packet.directory, "EVIDENCE.yml");
  const lines = fs.readFileSync(file, "utf8").split("\n"), at = lines.findIndex(line => line.startsWith("  " + packet.layoutFiles[0] + ":"));
  if (defect === "missing") lines.splice(at, 1);
  else if (defect === "duplicate") lines[at] = lines[at + 1];
  else {
    const rel = "terminal/components/substituted.tsx"; fs.writeFileSync(path.join(f.root, rel), "substituted source");
    const hash = crypto.createHash("sha256").update("substituted source").digest("hex"); lines[at] = `  ${rel}: "${hash}"`;
  }
  fs.writeFileSync(file, lines.join("\n"));
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true);
  assert.equal(result.reason, "fail-closed");
});
