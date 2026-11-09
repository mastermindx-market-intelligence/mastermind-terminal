"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {MANIFESTS, planEvidenceCapture} = require("./plan-evidence-capture.cjs");
const { EOD_PACKET, EOD_PRODUCER, EOD_LAYOUT_FILES, EOD_CROPS, nativeDefinition } = require("../../e2e/tools/capture_ci_evidence.cjs");

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
  const definitions = ["eod", "gex"].map(nativeDefinition);
  for (const rel of new Set(definitions.flatMap(def => [...def.producer.LAYOUT_FILES, def.script]))) {
    const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, "immutable native source " + rel + "\n");
  }
  const sourceHashes = names => Object.fromEntries(names.map(rel => [rel,
    crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex")]));
  const eodManifest = path.join(root, EOD_PACKET, "EVIDENCE.yml");
  const eodHashes = sourceHashes(EOD_LAYOUT_FILES);
  const eodText = "# capturedAtHead: " + "a".repeat(40) + "\nlayoutFiles:\n" +
    EOD_LAYOUT_FILES.map(rel => "  " + rel + ': "' + eodHashes[rel] + '"').join("\n") +
    "\nfiles:\n" + EOD_CROPS.map(file => "  - " + file).join("\n") + "\n";
  fs.mkdirSync(path.dirname(eodManifest), {recursive: true}); fs.writeFileSync(eodManifest, eodText);
  const gex = definitions[1], gexManifest = path.join(root, gex.directory, "EVIDENCE.yml");
  fs.mkdirSync(path.dirname(gexManifest), {recursive: true});
  const gexText = gex.producer.renderEvidence({ files: gex.files,
    layoutFiles: sourceHashes(gex.producer.LAYOUT_FILES), capturedAtHead: "a".repeat(40) });
  fs.writeFileSync(gexManifest, gexText);
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic PNG body")]);
  for (const def of definitions) for (const file of def.files) fs.writeFileSync(path.join(root, def.directory, file), image);
  return {root, paths, hashes, render, manifest: path.join(root, MANIFESTS[1]), eodManifest, eodText, gex, gexManifest, gexText};
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

test("GEX-only source drift cannot hide behind matching PL6/VI/EOD locks", t => {
  const f = fixture(t), source = f.gex.producer.LAYOUT_FILES.find(file => !EOD_LAYOUT_FILES.includes(file));
  assert.ok(source); fs.appendFileSync(path.join(f.root, source), "changed GEX source\n");
  assert.deepEqual(planEvidenceCapture(f.root), {capture: true, reason: "source-drift", stale: [source]});
});
test("a missing GEX manifest or source cannot authorize capture skip", t => {
  const f = fixture(t); fs.unlinkSync(f.gexManifest);
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
  fs.writeFileSync(f.gexManifest, f.gexText); fs.unlinkSync(path.join(f.root, f.gex.producer.LAYOUT_FILES[0]));
  assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});
for (const malformed of ["missing-source", "extra-source", "duplicate-source", "missing-crop", "extra-crop", "duplicate-crop"])
test("GEX " + malformed + " inventory cannot authorize capture skip", t => {
  const f = fixture(t); let text = f.gexText;
  const sourceRow = text.split("\n").find(row => row.startsWith("  " + f.gex.producer.LAYOUT_FILES[0] + ":"));
  const cropRow = "  - " + f.gex.files[0];
  if (malformed === "missing-source") text = text.replace(sourceRow + "\n", "");
  if (malformed === "extra-source") text = text.replace(sourceRow, sourceRow + '\n  terminal/unrelated.ts: "' + "a".repeat(64) + '"');
  if (malformed === "duplicate-source") text = text.replace(sourceRow, sourceRow + "\n" + sourceRow);
  if (malformed === "missing-crop") text = text.replace(cropRow + "\n", "");
  if (malformed === "extra-crop") text = text.replace("\nfiles:\n", "\nfiles:\n  - unexpected-390.png\n");
  if (malformed === "duplicate-crop") text = text.replace("\nfiles:\n", "\nfiles:\n" + cropRow + "\n");
  fs.writeFileSync(f.gexManifest, text);
  assert.equal(planEvidenceCapture(f.root).capture, true); assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});
for (const invalid of ["missing", "empty", "signature"])
test("GEX " + invalid + " PNG cannot authorize capture skip", t => {
  const f = fixture(t), image = path.join(f.root, f.gex.directory, f.gex.files[0]);
  if (invalid === "missing") fs.unlinkSync(image); else fs.writeFileSync(image, invalid === "empty" ? "" : "not a PNG");
  assert.equal(planEvidenceCapture(f.root).capture, true); assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});
test("a missing or empty GEX producer cannot authorize capture skip", t => {
  const f = fixture(t), producer = path.join(f.root, f.gex.script);
  fs.unlinkSync(producer); assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
  fs.writeFileSync(producer, ""); assert.equal(planEvidenceCapture(f.root).reason, "fail-closed");
});
