// Read-only proof for this exact capture-source transition. No browser or network.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repo = path.resolve(__dirname, "../../../..");
const receipt = JSON.parse(fs.readFileSync(path.join(__dirname, "source-equivalence-20261022.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, "EVIDENCE.json"), "utf8"));
const ts = require(path.join(repo, "terminal/node_modules/typescript"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
assert.equal(ts.version, receipt.compiler_version);
for (const source of receipt.product_sources) {
  assert.equal(evidence.source_hashes[source.path], source.captured_source_sha256);
  const current = fs.readFileSync(path.join(repo, source.path));
  const captured = source.captured_source_snapshot
    ? fs.readFileSync(path.join(__dirname, source.captured_source_snapshot))
    : current;
  assert.equal(hash(current), source.current_source_sha256, source.path);
  assert.equal(hash(captured), source.captured_source_sha256, source.path);
  const emit = bytes => ts.transpileModule(bytes.toString("utf8"), {
    fileName: source.path, compilerOptions: receipt.compiler_options,
  }).outputText;
  assert.equal(emit(current), emit(captured), source.path + " runtime changed");
  assert.equal(hash(emit(current)), source.reviewed_emitted_sha256, source.path);
}
const changedTest = receipt.test_only_followup;
assert.equal(evidence.source_hashes[changedTest.path], changedTest.captured_source_sha256);
assert.equal(hash(fs.readFileSync(path.join(repo, changedTest.path))), changedTest.current_source_sha256);
const capturedAiHash = evidence.source_hashes["terminal/lib/aiContext.ts"];
const entryEvidence = fs.readFileSync(path.join(__dirname, "../b-f11-analysis-brain-entry/EVIDENCE.yml"), "utf8");
assert.ok(entryEvidence.includes('  terminal/lib/aiContext.ts: "' + capturedAiHash + '"'));
console.log("PASS: four exact reviewed runtime outputs, retained original capture source hashes, and test-only follow-up");
