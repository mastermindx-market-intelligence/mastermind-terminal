"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {MANIFESTS, planEvidenceCapture} = require("./plan-evidence-capture.cjs");
const { EOD_PACKET, EOD_PRODUCER, EOD_LAYOUT_FILES, EOD_CROPS } = require("../../e2e/tools/capture_ci_evidence.cjs");

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
  const eodManifest = path.join(root, EOD_PACKET, "EVIDENCE.yml");
  const eodHashes = EOD_LAYOUT_FILES.map(rel => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, "immutable EOD source " + rel + "\n");
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  });
  const eodText = "# capturedAtHead: " + "a".repeat(40) + "\nlayoutFiles:\n" +
    EOD_LAYOUT_FILES.map((rel, i) => "  " + rel + ': "' + eodHashes[i] + '"').join("\n") +
    "\nfiles:\n" + EOD_CROPS.map(file => "  - " + file).join("\n") + "\n";
  fs.mkdirSync(path.dirname(eodManifest), {recursive: true});
  fs.writeFileSync(eodManifest, eodText);
  const producer = path.join(root, EOD_PRODUCER);
  fs.mkdirSync(path.dirname(producer), {recursive: true});
  fs.writeFileSync(producer, "// synthetic producer fixture\n");
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic PNG body")]);
  for (const file of EOD_CROPS) fs.writeFileSync(path.join(root, EOD_PACKET, file), image);
  return {root, paths, hashes, render, manifest: path.join(root, MANIFESTS[1]), eodManifest, eodText};
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

test("EOD-only layout drift requires the incumbent full capture despite matching PL6/VI locks", t => {
  const f = fixture(t), source = EOD_LAYOUT_FILES[4];
  fs.appendFileSync(path.join(f.root, source), "changed published copy\n");
  assert.deepEqual(planEvidenceCapture(f.root), {capture: true, reason: "source-drift", stale: [source]});
});

test("a missing EOD manifest or source cannot authorize capture skip", t => {
  const f = fixture(t);
  fs.unlinkSync(f.eodManifest);
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
  fs.writeFileSync(f.eodManifest, f.eodText);
  fs.unlinkSync(path.join(f.root, EOD_LAYOUT_FILES[4]));
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});

for (const malformed of ["missing-source", "extra-source", "duplicate-source", "missing-crop", "extra-crop", "duplicate-crop"])
test("EOD " + malformed + " inventory cannot authorize capture skip", t => {
  const f = fixture(t);
  let text = f.eodText;
  const sourceRow = text.split("\n").find(row => row.startsWith("  " + EOD_LAYOUT_FILES[0] + ":"));
  const cropRow = "  - " + EOD_CROPS[0];
  if (malformed === "missing-source") text = text.replace(sourceRow + "\n", "");
  if (malformed === "extra-source") text = text.replace("\nfiles:\n", '\n  terminal/unrelated.ts: "' + "a".repeat(64) + '"\nfiles:\n');
  if (malformed === "duplicate-source") text = text.replace("\nfiles:\n", "\n" + sourceRow + "\nfiles:\n");
  if (malformed === "missing-crop") text = text.replace(cropRow + "\n", "");
  if (malformed === "extra-crop") text += "  - unexpected-390.png\n";
  if (malformed === "duplicate-crop") text += cropRow + "\n";
  fs.writeFileSync(f.eodManifest, text);
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true);
  assert.equal(result.reason, "fail-closed");
});

for (const invalid of ["missing", "empty", "signature"])
test("EOD " + invalid + " PNG cannot authorize capture skip", t => {
  const f = fixture(t), image = path.join(f.root, EOD_PACKET, EOD_CROPS[0]);
  if (invalid === "missing") fs.unlinkSync(image);
  else fs.writeFileSync(image, invalid === "empty" ? "" : "not a PNG");
  const result = planEvidenceCapture(f.root);
  assert.equal(result.capture, true); assert.equal(result.reason, "fail-closed");
});

test("a missing or empty EOD producer cannot authorize capture skip", t => {
  const f = fixture(t), producer = path.join(f.root, EOD_PRODUCER);
  fs.unlinkSync(producer);
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
  fs.writeFileSync(producer, "");
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});

test("historical EOD checkout identity remains reusable when its complete inputs still match", t => {
  const f = fixture(t);
  fs.writeFileSync(f.eodManifest, f.eodText.replace("a".repeat(40), "9".repeat(40)));
  assert.deepEqual(planEvidenceCapture(f.root), {capture: false, reason: "locked-source-match", stale: []});
});

test("batch3-only producer or fixture drift cannot skip the existing capture owner", t => {
  const f = fixture(t);
  const batch3 = MANIFESTS.find(manifest => manifest.includes("b-pl-6-batch-3"));
  assert.ok(batch3, "batch3 is registered in the existing planner");
  const input = "terminal/e2e/fixtures/heatmap-price-only-tile.json";
  const file = path.join(f.root, input);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const original = Buffer.from('{"source":"bundled"}\n');
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(f.root, batch3), f.render([...f.paths, input],
    [...f.hashes, crypto.createHash("sha256").update(original).digest("hex")]));
  assert.equal(planEvidenceCapture(f.root).capture, false);
  fs.appendFileSync(file, "changed fixture\n");
  assert.deepEqual(planEvidenceCapture(f.root), {capture: true, reason: "source-drift", stale: [input]});
});

test("missing or malformed batch3 evidence cannot authorize a merge-group capture skip", t => {
  const f = fixture(t), batch3 = MANIFESTS.find(manifest => manifest.includes("b-pl-6-batch-3"));
  assert.ok(batch3);
  const file = path.join(f.root, batch3);
  fs.rmSync(file);
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
  fs.writeFileSync(file, "layoutFiles:\n  tampered: x\n");
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});
