"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { run, operationIds, recordCheckout, EOD_PACKET, EOD_LAYOUT_FILES, EOD_CROPS } = require("./capture_ci_evidence.cjs");

function fixture(t, change = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-synthetic-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const env = { GITHUB_RUN_ID: "41600914408", GITHUB_RUN_ATTEMPT: "2", GITHUB_ENV: path.join(repoRoot, "github-env"), RUNNER_TEMP: path.join(repoRoot, "runner-temp") };
  const ids = operationIds(env), calls = [], inputs = [];
  const diagnostics = path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
  const eodDirectory = path.join(repoRoot, EOD_PACKET), eodManifest = path.join(eodDirectory, "EVIDENCE.yml");
  fs.mkdirSync(eodDirectory, { recursive: true });
  for (const file of EOD_LAYOUT_FILES) {
    const target = path.join(repoRoot, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "synthetic source " + file + "\n");
  }
  const writeEod = (head, files = EOD_CROPS) => {
    const rows = EOD_LAYOUT_FILES.map(file => "  " + file + ': "' +
      createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex") + '"');
    fs.writeFileSync(eodManifest, "# synthetic fixture\n# capturedAtHead: " + head + "\nlayoutFiles:\n" +
      rows.join("\n") + "\nfiles:\n" + files.map(file => "  - " + file).join("\n") + "\n");
    for (const file of files) fs.writeFileSync(path.join(eodDirectory, file),
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic " + head + file)]));
  };
  writeEod("9".repeat(40));
  const eodPrior = fs.readFileSync(eodManifest);
  if (change.eodChanged) fs.appendFileSync(path.join(repoRoot, EOD_LAYOUT_FILES[4]), "changed copy\n");
  const profile = { fixture: "terminal-e2e.v1", buildMode: "next-dev", sharedShell: "0", investorShellPreview: "0", theme: "dark" };
  const requirements = packet => Array.from({ length: packet === "pl6" ? 20 : 30 }, (_, n) => ({ packet, key: `${packet}:${n}` }));
  const evidence = {
    PACKETS: { pl6: "terminal/docs/pr-crops/b-pl-6-batch-1", vi: "terminal/docs/pr-crops/terminal-visual-intelligence" },
    profile: () => profile, requirements, canonical: JSON.stringify,
    writeComposition(input) {
      inputs.push(input);
      if (change.writeError) throw new Error(change.writeError);
      const dir = path.join(repoRoot, evidence.PACKETS.pl6); fs.mkdirSync(dir, { recursive: true });
      const record = { schema: "terminal.visual-composition.v2", mode: "records", id: input.id,
        profile: input.profile, operations: input.operations, selections: input.selections };
      fs.writeFileSync(path.join(dir, `${input.id}.composition.json`), JSON.stringify(record));
      return { id: input.id }; // Deliberately has no path/digest: matches incumbent return semantics.
    },
    readComposition(input) {
      assert.deepEqual(input.expectedProfile, profile);
      assert.equal(input.compositionPath, `${evidence.PACKETS.pl6}/${ids.composition}.composition.json`);
      if (change.readError) throw new Error(change.readError);
      return { id: ids.composition, cases: Array(change.selectedCount ?? 50).fill({}),
        operations: ["pl6", "vi"].map(packet => ({ id: ids[packet], packet,
          cases: Array(packet === "pl6" ? (change.pl6Count ?? 24) : 30).fill({}) })) };
    },
  };
  const checkout = () => ({ actualCheckout: { commit: "a".repeat(40), tree: "b".repeat(40) },
    githubEvent: { sha: "c".repeat(40), pullRequestBase: "d".repeat(40), pullRequestHead: "e".repeat(40) } });
  const spawn = (command, args, options) => {
    const packet = args[0].includes("eod_heatmap_flowdesk") ? "eod" : calls.length === 0 ? "pl6" : "vi";
    calls.push({ command, args, options });
    fs.writeSync(options.stdio[2], "original child diagnostic\n");
    if (packet === "eod") {
      if (change.eodThrow) throw new Error("original EOD spawn exception");
      if (change.eodSourceDuringCapture) fs.appendFileSync(path.join(repoRoot, EOD_LAYOUT_FILES[0]), "racing source\n");
      const head = change.eodHead || "a".repeat(40);
      if (!change.eodSkipCapture) writeEod(head, change.eodPartial ? EOD_CROPS.slice(1) : EOD_CROPS);
      if (change.eodMissingCrop) fs.unlinkSync(path.join(eodDirectory, EOD_CROPS[0]));
      if (change.eodBadPng) fs.writeFileSync(path.join(eodDirectory, EOD_CROPS[0]), "not a PNG");
      const line = "wrote 126 crops + EVIDENCE.yml (head " + head + ")\n";
      if (!change.eodMissingCompletion) fs.writeSync(options.stdio[1], line);
      if (change.eodDuplicateCompletion) fs.writeSync(options.stdio[1], line);
      return { status: change.eodStatus ?? 0, signal: change.eodSignal ?? null, error: change.eodError };
    }
    const ref = { visualEvidence: `${evidence.PACKETS[packet]}/${ids[packet]}--operation.json`,
      sha256: "f".repeat(64), actualCases: packet === "pl6" ? 24 : 30, ...change.ref };
    if (!change.missing) fs.writeSync(options.stdio[1], JSON.stringify(ref) + "\n");
    if (change.ambiguous) fs.writeSync(options.stdio[1], JSON.stringify(ref) + "\n");
    if (packet === "vi" && change.clearOutput) {
      fs.rmSync(path.join(repoRoot, "terminal", "test-results"), { recursive: true, force: true });
      fs.mkdirSync(path.join(repoRoot, "terminal", "test-results"), { recursive: true });
    }
    if (change.throwChild) throw new Error("original spawn exception");
    return { status: (packet === "vi" ? change.viStatus : undefined) ?? change.status ?? 0, signal: change.signal ?? null, error: change.error };
  };
  const invoke = () => run({ repoRoot, env, evidence, checkout, spawn });
  const diagnostic = () => JSON.parse(fs.readFileSync(path.join(diagnostics, `${ids.prefix}.json`)));
  const selected = () => fs.existsSync(env.GITHUB_ENV) ? fs.readFileSync(env.GITHUB_ENV, "utf8") : "";
  return { repoRoot, env, ids, calls, inputs, checkout, invoke, diagnostic, selected, diagnostics,
    eodDirectory, eodManifest, eodPrior };
}

test("runs complete original captures, retains24PL6, selects20+30 and exact returned hashes", t => {
  const f = fixture(t), r = f.invoke();
  assert.equal(r.state, "SELECTED"); assert.equal(r.composition.selectedCases, 50);
  assert.equal(r.actualCheckout.commit, "a".repeat(40)); assert.notEqual(r.actualCheckout.commit, r.githubEvent.sha);
  assert.deepEqual(f.calls.map(c => c.args), [
    ["e2e/tools/capture_pl6_batch1.cjs"],
    ["e2e/tools/capture_visual_evidence.cjs", "--id", f.ids.vi, "--port", "3537"],
  ]);
  assert.equal(f.calls[0].options.env.TERMINAL_PL6_EVIDENCE_OPERATION_ID, f.ids.pl6);
  assert.equal(f.calls[0].options.env.CAPTURE_ONLY, "");
  assert.equal(f.inputs[0].selections.filter(s => s.operationId === f.ids.pl6).length, 20);
  assert.equal(f.inputs[0].selections.filter(s => s.operationId === f.ids.vi).length, 30);
  assert.ok(f.inputs[0].operations.every(r => r.sha256 === "f".repeat(64)));
  assert.equal(f.selected(), `TERMINAL_EVIDENCE_MODE=records\nTERMINAL_EVIDENCE_COMPOSITION=${r.composition.path}\n`);
  assert.match(r.composition.sha256, /^[0-9a-f]{64}$/);
});

for (const [name, change, error] of [
  ["missing reference", { missing: true }, /REFERENCE_COUNT/],
  ["ambiguous reference", { ambiguous: true }, /REFERENCE_COUNT/],
  ["hash malformed", { ref: { sha256: "bad" } }, /REFERENCE/],
  ["narrowed PL6 count", { ref: { actualCases: 20 } }, /REFERENCE/],
  ["unrelated operation", { ref: { visualEvidence: "other/operation.json" } }, /REFERENCE/],
  ["nonzero child", { status: 1 }, /CHILD_FAILED/],
  ["signalled child", { signal: "SIGTERM" }, /CHILD_FAILED/],
  ["spawn error", { error: new Error("original ENOENT") }, /original ENOENT/],
  ["spawn throws", { throwChild: true }, /original spawn exception/],
  ["source mismatch", { writeError: "SOURCE_MISMATCH" }, /SOURCE_MISMATCH/],
  ["profile mismatch", { readError: "PROFILE_MISMATCH" }, /PROFILE_MISMATCH/],
  ["bad report/image closure", { writeError: "CASE_REPORT_BINDING" }, /CASE_REPORT_BINDING/],
  ["incomplete composition", { selectedCount: 49 }, /COMPOSITION/],
  ["lost extra layout cases", { pl6Count: 20 }, /COMPOSITION/],
]) test(`${name} preserves failure and does not export selector`, t => {
  const f = fixture(t, change);
  assert.throws(f.invoke, error); assert.equal(f.selected(), ""); assert.equal(f.diagnostic().state, "FAILED");
  assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids.pl6}.stderr.log`), "utf8"), /original child diagnostic/);
});

test("capture filtering and prior composition are refused before child execution", t => {
  for (const [key, value, error] of [["CAPTURE_ONLY", "ChartChrome", /CAPTURE_FILTER/],
    ["TERMINAL_EVIDENCE_COMPOSITION", "historical.composition.json", /PRESELECTED/]]) {
    const f = fixture(t); f.env[key] = value; assert.throws(f.invoke, error);
    assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
  }
});

test("stable per-run/attempt IDs refuse invalid values and duplicate invocation cannot overwrite", t => {
  const f = fixture(t); assert.deepEqual(operationIds(f.env), operationIds({ ...f.env }));
  assert.notEqual(operationIds({ ...f.env, GITHUB_RUN_ATTEMPT: "3" }).pl6, f.ids.pl6);
  assert.throws(() => operationIds({ ...f.env, GITHUB_RUN_ID: "1\nx=2" }), /CI_EVIDENCE_ID/);
  f.invoke(); const before = f.diagnostic(); assert.throws(f.invoke, /EEXIST/); assert.deepEqual(f.diagnostic(), before);
});

test("checkout-only metadata survives a later capture failure without selecting records", t => {
  const f = fixture(t, { status: 1 });
  const early = recordCheckout({ repoRoot: f.repoRoot, env: f.env, checkout: f.checkout });
  assert.throws(f.invoke, /CHILD_FAILED/);
  const retained = JSON.parse(fs.readFileSync(path.join(f.diagnostics, `${f.ids.prefix}.checkout.json`)));
  assert.deepEqual(retained, early); assert.equal(f.selected(), "");
  assert.throws(() => recordCheckout({ repoRoot: f.repoRoot, env: f.env, checkout: f.checkout }), /EEXIST/);
});

for (const failure of [false, true]) test(`VI outputDir cleanup preserves ${failure ? "failed" : "successful"} diagnostics and open logs`, t => {
  const f = fixture(t, { clearOutput: true, viStatus: failure ? 1 : 0 });
  fs.mkdirSync(path.join(f.repoRoot, "terminal", "test-results"), { recursive: true });
  fs.writeFileSync(path.join(f.repoRoot, "terminal", "test-results", "old.txt"), "old output");
  recordCheckout({ repoRoot: f.repoRoot, env: f.env, checkout: f.checkout });
  if (failure) assert.throws(f.invoke, /CHILD_FAILED: vi/); else f.invoke();
  assert.equal(fs.existsSync(path.join(f.repoRoot, "terminal", "test-results", "old.txt")), false);
  assert.equal(f.diagnostic().state, failure ? "FAILED" : "SELECTED");
  assert.ok(fs.existsSync(path.join(f.diagnostics, `${f.ids.prefix}.checkout.json`)));
  for (const packet of ["pl6", "vi"]) {
    assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids[packet]}.stdout.log`), "utf8"), /visualEvidence/);
    assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids[packet]}.stderr.log`), "utf8"), /original child diagnostic/);
  }
  assert.equal(Boolean(f.selected()), !failure);
});

test("changed EOD source captures the full incumbent packet and preserves both composition operations", t => {
  const f = fixture(t, { eodChanged: true });
  Object.assign(f.env, { UPDATE_HEATMAP_EVIDENCE: "1", TERMINAL_CROP_OUTPUT_DIR: "/unrelated",
    CAPTURE_HEAD: "e".repeat(40), TERMINAL_CROP_PORT: "9999" });
  const r = f.invoke(), child = f.calls[2];
  assert.equal(f.calls.length, 3);
  assert.deepEqual(child.args, ["e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs"]);
  assert.equal(child.options.timeout, 1_800_000);
  for (const key of ["CAPTURE_ONLY", "UPDATE_HEATMAP_EVIDENCE", "TERMINAL_CROP_OUTPUT_DIR", "CAPTURE_HEAD"])
    assert.equal(child.options.env[key], "");
  assert.equal(child.options.env.TERMINAL_CROP_PORT, "3566");
  assert.equal(r.eod.state, "CAPTURED_AWAITING_NATIVE_VALIDATION");
  assert.equal(r.eod.capturedAtHead, r.actualCheckout.commit);
  assert.equal(r.eod.actualCases, 126);
  assert.equal(Object.keys(r.eod.crops).length, 126);
  assert.deepEqual(r.eod.plan.changed, [EOD_LAYOUT_FILES[4]]);
  assert.deepEqual(fs.readFileSync(r.eod.priorManifest.retainedPath), f.eodPrior);
  assert.equal(r.eod.priorManifest.sha256, createHash("sha256").update(f.eodPrior).digest("hex"));
  assert.equal(r.eod.sha256, createHash("sha256").update(fs.readFileSync(f.eodManifest)).digest("hex"));
  assert.equal(f.inputs[0].operations.length, 2);
  assert.equal(r.composition.selectedCases, 50);
  assert.ok(f.selected());
});

test("matching EOD layout does not invent a new capture receipt", t => {
  const f = fixture(t), r = f.invoke();
  assert.equal(f.calls.length, 2);
  assert.equal(r.eod.plan.required, false);
  assert.equal(r.eod.state, "EXISTING_PACKET_AWAITING_NATIVE_VALIDATION");
  assert.equal(r.eod.actualCases, undefined);
  assert.equal(r.eod.priorManifest.retainedPath, undefined);
});

for (const [name, change, error] of [
  ["stale packet with existing images", { eodSkipCapture: true }, /CHECKOUT_BINDING/],
  ["event-head instead of checkout", { eodHead: "e".repeat(40) }, /COMPLETION/],
  ["source changes during capture", { eodSourceDuringCapture: true }, /CHECKOUT_BINDING/],
  ["partial manifest with historical images", { eodPartial: true }, /MANIFEST_CASES/],
  ["missing produced image", { eodMissingCrop: true }, /ENOENT/],
  ["invalid PNG bytes", { eodBadPng: true }, /CI_EOD_CROP/],
  ["no completion receipt", { eodMissingCompletion: true }, /COMPLETION/],
  ["duplicate completion receipt", { eodDuplicateCompletion: true }, /COMPLETION/],
  ["nonzero capture despite complete files", { eodStatus: 1 }, /CHILD_FAILED: eod/],
  ["signalled capture", { eodSignal: "SIGTERM" }, /CHILD_FAILED: eod/],
  ["timed out capture", { eodError: Object.assign(new Error("original timeout"), { code: "ETIMEDOUT" }) }, /original timeout/],
  ["spawn exception", { eodThrow: true }, /original EOD spawn exception/],
]) test("EOD " + name + " fails once before selection", t => {
  const f = fixture(t, { eodChanged: true, ...change });
  assert.throws(f.invoke, error);
  assert.equal(f.calls.length, 3); assert.equal(f.inputs.length, 0); assert.equal(f.selected(), "");
  assert.equal(f.diagnostic().state, "FAILED");
  assert.match(fs.readFileSync(path.join(f.diagnostics, f.ids.prefix + "-eod.stderr.log"), "utf8"), /original child diagnostic/);
});

for (const malformed of ["missing", "duplicate", "unrelated", "missing-source"]) test("EOD malformed " + malformed + " manifest cannot be normalized into capture", t => {
  const f = fixture(t, { eodChanged: true });
  let text = fs.readFileSync(f.eodManifest, "utf8");
  if (malformed === "missing") text = text.replace("layoutFiles:", "oldLayoutFiles:");
  if (malformed === "duplicate") text = text.replace("files:\n", text.split("\n").find(row => row.startsWith("  terminal/")) + "\nfiles:\n");
  if (malformed === "unrelated") text = text.replace(EOD_LAYOUT_FILES[0], "../outside");
  if (malformed === "missing-source") text = text.split("\n").filter(row => !row.startsWith("  " + EOD_LAYOUT_FILES[0] + ":")).join("\n");
  fs.writeFileSync(f.eodManifest, text);
  assert.throws(f.invoke, /CI_EOD_MANIFEST/);
  assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
});

test("missing current EOD source fails before capture", t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.repoRoot, EOD_LAYOUT_FILES[0]));
  assert.throws(f.invoke, /ENOENT/);
  assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
});
