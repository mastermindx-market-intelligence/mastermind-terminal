"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { run, operationIds, recordCheckout, captureOptions } = require("./capture_ci_evidence.cjs");

function fixture(t, change = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-synthetic-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const env = { GITHUB_RUN_ID: "41600914408", GITHUB_RUN_ATTEMPT: "2", GITHUB_ENV: path.join(repoRoot, "github-env"), RUNNER_TEMP: path.join(repoRoot, "runner-temp") };
  const ids = operationIds(env), calls = [], inputs = [];
  const diagnostics = path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
  const terminal = path.join(repoRoot, "terminal");
  const optionsPath = path.join(terminal, "docs/pr-crops/options-level-axis-labels/manifest.json");
  const sourceFiles = ["components/ChartPanel.tsx", "lib/optionsLevels.ts", "lib/pricePaneSvgScope.ts", "lib/priceTagPlacement.ts"];
  for (const file of sourceFiles) {
    const target = path.join(terminal, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `synthetic source ${file}\n`);
  }
  const writeOptions = sourceHead => {
    fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
    fs.writeFileSync(optionsPath, JSON.stringify({ sourceHead,
      sourceFiles: Object.fromEntries(sourceFiles.map(file => [file,
        createHash("sha256").update(fs.readFileSync(path.join(terminal, file))).digest("hex")])) }));
  };
  writeOptions("9".repeat(40));
  if (change.optionsChanged) fs.appendFileSync(path.join(terminal, sourceFiles[0]), "changed source\n");
  if (change.optionsScopeChanged) fs.appendFileSync(path.join(terminal, "lib/pricePaneSvgScope.ts"), "changed scope\n");
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
      assert.deepEqual(input.profile, profile);
      fs.writeFileSync(path.join(dir, `${input.id}.composition.json`),
        JSON.stringify(record) + (change.compositionBytesMismatch ? "\n" : ""));
      // The incumbent writer returns the fully validated composition, without a path/digest.
      return { id: input.id, cases: Array(change.selectedCount ?? 50).fill({}),
        operations: ["pl6", "vi"].map(packet => ({ id: ids[packet], packet,
          cases: Array(packet === "pl6" ? (change.pl6Count ?? 24) : 30).fill({}) })) };
    },
  };
  const checkout = () => ({ actualCheckout: { commit: "a".repeat(40), tree: "b".repeat(40) },
    githubEvent: { sha: "c".repeat(40), pullRequestBase: "d".repeat(40), pullRequestHead: "e".repeat(40) } });
  const spawn = (command, args, options) => {
    const packet = calls.length === 0 ? "pl6" : "vi";
    calls.push({ command, args, options });
    if (packet === "pl6" && options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE === "1" && !change.skipOptionsCapture)
      writeOptions(change.optionsHead || "a".repeat(40));
    fs.writeSync(options.stdio[2], "original child diagnostic\n");
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
  return { repoRoot, env, ids, calls, inputs, checkout, invoke, diagnostic, selected, diagnostics, optionsPath };
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
  assert.equal(f.calls[0].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "0");
  assert.equal(r.optionsAxis.state, "EXISTING_PACKET_AWAITING_UNIT_VALIDATION");
  assert.equal(f.inputs[0].selections.filter(s => s.operationId === f.ids.pl6).length, 20);
  assert.equal(f.inputs[0].selections.filter(s => s.operationId === f.ids.vi).length, 30);
  assert.ok(f.inputs[0].operations.every(r => r.sha256 === "f".repeat(64)));
  assert.equal(f.selected(), `TERMINAL_EVIDENCE_MODE=records\nTERMINAL_EVIDENCE_COMPOSITION=${r.composition.path}\n`);
  assert.match(r.composition.sha256, /^[0-9a-f]{64}$/);
});

test("changed Options source opts only PL6 into one capture and retains actual checkout identity", t => {
  const f = fixture(t, { optionsChanged: true });
  f.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE = "1"; // The caller may not leak this into VI.
  const r = f.invoke();
  assert.deepEqual(f.calls.map(c => c.options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE), ["1", "0"]);
  assert.deepEqual(r.optionsAxis.plan.changed, ["components/ChartPanel.tsx"]);
  assert.equal(r.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.equal(r.optionsAxis.sourceHead, r.actualCheckout.commit);
  assert.notEqual(r.optionsAxis.sourceHead, r.githubEvent.pullRequestHead);
  assert.equal(r.optionsAxis.sha256, createHash("sha256").update(fs.readFileSync(f.optionsPath)).digest("hex"));
  assert.equal(r.composition.selectedCases, 50);
});

test("helper-only Options source drift requests the existing five-case capture", t => {
  const f = fixture(t, { optionsScopeChanged: true });
  const r = f.invoke();
  assert.deepEqual(r.optionsAxis.plan.changed, ["lib/pricePaneSvgScope.ts"]);
  assert.deepEqual(f.calls.map(c => c.options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE), ["1", "0"]);
  assert.equal(r.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.equal(r.optionsAxis.sourceHead, r.actualCheckout.commit);
  assert.equal(r.composition.selectedCases, 50);
});

for (const change of [{ skipOptionsCapture: true }, { optionsHead: "e".repeat(40) }])
test("stale or event-head Options receipt cannot select a successful capture", t => {
  const f = fixture(t, { optionsChanged: true, ...change });
  assert.throws(f.invoke, /CI_OPTIONS_CHECKOUT_BINDING/);
  assert.equal(f.calls.length, 1); assert.equal(f.selected(), "");
  assert.equal(f.diagnostic().state, "FAILED");
});

test("Options runs asynchronously against the owned server, preserving inherited fixture settings", async () => {
  const server = {}, child = new EventEmitter(), calls = [], checks = [];
  let settled = false;
  const pending = captureOptions({ server, ownedServer: value => { checks.push(value); return true; },
    baseURL: "http://127.0.0.1:3536", terminal: "/fixture/terminal", env: { SHARED_SHELL: "1", BASE_URL: "http://wrong" },
    spawn: (...args) => { calls.push(args); return child; } }).then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(checks, [server]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["docs/pr-crops/options-level-axis-labels/capture.mjs"]);
  assert.deepEqual(calls[0][2], { cwd: "/fixture/terminal", env: { SHARED_SHELL: "1", BASE_URL: "http://127.0.0.1:3536" }, stdio: "inherit", timeout: 600_000 });
  child.emit("close", 0, null); await pending;
  assert.equal(settled, true); assert.deepEqual(checks, [server, server]);
});

for (const outcome of ["nonzero", "signal", "error", "server-exit"])
test(`Options ${outcome} fails once without retrying or starting a replacement server`, async () => {
  const child = new EventEmitter(); let calls = 0, checks = 0;
  const pending = captureOptions({ server: {}, ownedServer: () => ++checks === 1 || outcome !== "server-exit",
    baseURL: "http://127.0.0.1:3536", terminal: "/fixture/terminal", env: {},
    spawn: () => { calls++; return child; } });
  const rejected = assert.rejects(pending, outcome === "error" ? /original spawn error/ : /CI_OPTIONS_/);
  if (outcome === "error") child.emit("error", new Error("original spawn error"));
  else child.emit("close", outcome === "nonzero" ? 1 : 0, outcome === "signal" ? "SIGTERM" : null);
  await rejected; assert.equal(calls, 1);
});

test("Options refuses an unowned or unready server before spawning", async () => {
  let calls = 0;
  await assert.rejects(captureOptions({ server: {}, ownedServer: () => false,
    spawn: () => { calls++; } }), /CI_OPTIONS_SERVER_NOT_READY/);
  assert.equal(calls, 0);
});

test("PL6 invokes Options only after its captures succeed and before its own server cleanup", () => {
  const source = fs.readFileSync(path.join(__dirname, "capture_pl6_batch1.cjs"), "utf8");
  assert.match(source, /captureOptionsAxis && \(!operation \|\| ONLY\.length\)/);
  assert.match(source, /if \(captureOptionsAxis && failed === 0\)/);
  assert.equal((source.match(/await captureOptions\(/g) || []).length, 1);
  const close = source.indexOf("await browser.close();");
  const capture = source.indexOf("await captureOptions(");
  const stop = source.indexOf("stopServer(child);", capture);
  assert.ok(close < capture && capture < stop);
  const workflow = fs.readFileSync(path.resolve(__dirname, "../../../.github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /terminal\/docs\/pr-crops\/options-level-axis-labels\/manifest\.json/);
  assert.match(workflow, /terminal\/docs\/pr-crops\/options-level-axis-labels\/\*\.png/);
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
  ["profile mismatch", { writeError: "PROFILE_MISMATCH" }, /PROFILE_MISMATCH/],
  ["bad report/image closure", { writeError: "CASE_REPORT_BINDING" }, /CASE_REPORT_BINDING/],
  ["composition changed after writer validation", { compositionBytesMismatch: true }, /COMPOSITION_BYTES/],
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
