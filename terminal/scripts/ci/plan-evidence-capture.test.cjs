"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {MANIFESTS, planEvidenceCapture, UNIT_EVIDENCE_CONSUMERS, unitEvidencePartition} = require("./plan-evidence-capture.cjs");

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

test("unset unit partition preserves default discovery and ordinary only excludes exact consumers", () => {
  assert.deepEqual(unitEvidencePartition(), {});
  const ordinary = unitEvidencePartition({partition: "ordinary"});
  assert.deepEqual(ordinary, {exclude: [
    "lib/__tests__/b_pl_6Batch1Evidence.test.ts",
    "lib/__tests__/visualIntelligenceEvidence.test.ts",
    "lib/__tests__/optionsLevelAxisEvidence.test.ts",
  ]});
  ordinary.exclude.pop();
  assert.equal(UNIT_EVIDENCE_CONSUMERS.length, 3);
  assert.equal(unitEvidencePartition({partition: "ordinary"}).exclude.length, 3);
  assert.throws(() => UNIT_EVIDENCE_CONSUMERS.push("unrelated.test.ts"), TypeError);
});

test("records partition admits only a successful plan and producer with the existing selector", t => {
  assert.deepEqual(unitEvidencePartition({
    partition: "evidence", planOutcome: "success", capture: "true",
    eventName: "pull_request", captureOutcome: "success",
    evidenceMode: "records", evidenceComposition: "/captured/current.composition.json",
  }), {include: [...UNIT_EVIDENCE_CONSUMERS]});
  // A successful fail-closed planner may order real capture; its reason does
  // not turn that successful capture into legacy or an additional refusal.
  const f = fixture(t);
  fs.rmSync(f.manifest);
  assert.equal(planEvidenceCapture(f.root).capture, true);
});

test("only a successful merge-group skip plan admits legacy consumers", () => {
  assert.deepEqual(unitEvidencePartition({
    partition: "evidence", planOutcome: "success", capture: "false",
    eventName: "merge_group", captureOutcome: "skipped",
  }), {include: [...UNIT_EVIDENCE_CONSUMERS]});
  assert.deepEqual(unitEvidencePartition({
    partition: "evidence", planOutcome: "success", capture: "false",
    eventName: "merge_group", captureOutcome: "skipped", evidenceMode: "legacy",
  }), {include: [...UNIT_EVIDENCE_CONSUMERS]});
});

for (const partition of ["", "all", "legacy", "default", "ORDINARY", null, true]) {
  test("unknown explicit unit partition refuses: " + String(partition), () => {
    assert.throws(() => unitEvidencePartition({partition}), /unknown Terminal unit partition/);
  });
}

for (const planOutcome of [undefined, "", "failure", "cancelled", "skipped", true]) {
  test("missing or unsuccessful plan never becomes legacy: " + String(planOutcome), () => {
    assert.throws(() => unitEvidencePartition({
      partition: "evidence", planOutcome, capture: "false", eventName: "merge_group",
    }), /requires successful evidence capture planner/);
  });
}

for (const capture of [undefined, "", "TRUE", "0", true, false]) {
  test("malformed capture output refuses: " + String(capture), () => {
    assert.throws(() => unitEvidencePartition({
      partition: "evidence", planOutcome: "success", capture, eventName: "merge_group",
    }), /requires explicit planner capture true or false/);
  });
}

for (const override of [
  {captureOutcome: undefined}, {captureOutcome: "failure"},
  {captureOutcome: "cancelled"}, {captureOutcome: "skipped"},
  {evidenceMode: undefined}, {evidenceMode: "legacy"},
  {evidenceComposition: undefined}, {evidenceComposition: ""}, {evidenceComposition: " \t"},
]) {
  test("records input is incomplete or failed: " + Object.entries(override).map(([key, value]) => key + "=" + String(value)).join(","), () => {
    assert.throws(() => unitEvidencePartition({
      partition: "evidence", planOutcome: "success", capture: "true",
      eventName: "pull_request", captureOutcome: "success",
      evidenceMode: "records", evidenceComposition: "/captured/current.composition.json",
      ...override,
    }), /requires successful capture and current records selector/);
  });
}

for (const override of [
  {eventName: "pull_request"}, {eventName: "workflow_dispatch"}, {eventName: undefined},
  {captureOutcome: undefined}, {captureOutcome: ""},
  {captureOutcome: "failure"}, {captureOutcome: "success"}, {captureOutcome: "cancelled"},
  {evidenceMode: "records"}, {evidenceMode: "unknown"}, {evidenceMode: ""},
  {evidenceComposition: "/old/composition.json"}, {evidenceComposition: " "}, {evidenceComposition: ""},
]) {
  test("legacy admission rejects conflicting outcome or selector: " + Object.entries(override).map(([key, value]) => key + "=" + String(value)).join(","), () => {
    assert.throws(() => unitEvidencePartition({
      partition: "evidence", planOutcome: "success", capture: "false",
      eventName: "merge_group", captureOutcome: "skipped", ...override,
    }), /requires authorized merge-group plan without stale selector/);
  });
}
