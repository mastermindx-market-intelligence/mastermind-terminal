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
  const sourceFiles = ["components/ChartPanel.tsx", "lib/optionsLevels.ts", "lib/priceTagPlacement.ts"];
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
  const invoke = () => run({ repoRoot, env, evidence, checkout, spawn, failurePackets: { plan: () => [] } });
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

// Source snapshot compatibility and artifact-path negative controls run in the required tool check.
require("./visualEvidenceSourcePaths.test.cjs");


const failurePackets = require("./gex_failure_capture.cjs");
const { PNG } = require("pngjs");
const tinyPng = () => PNG.sync.write(new PNG({ width: 1, height: 1 }));
function failureFixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gex-preparation-control-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const packets = failurePackets.contracts();
  for (const packet of packets) for (const rel of packet.layoutFiles) {
    const file = path.join(repoRoot, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "controlled " + rel);
  }
  const text = (packet, head = "a".repeat(40)) => "# capturedAtHead: " + head + "\nlayoutFiles:\n"
    + Object.entries(failurePackets.sourceMap(repoRoot, packet)).map(([rel, hash]) => `  ${rel}: "${hash}"`).join("\n")
    + "\nharness:\n" + packet.files.map(file => `  ${file}: { state: controlled }`).join("\n")
    + "\nfiles:\n" + packet.files.map(file => "  - " + file).join("\n") + "\n";
  for (const packet of packets) {
    const dir = path.join(repoRoot, "terminal/docs/pr-crops", packet.directory); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "EVIDENCE.yml"), text(packet));
    if (packet.id === "eod") {
      const before = path.join(dir, "before"); fs.mkdirSync(before); fs.writeFileSync(path.join(before, "BEFORE.yml"), "historical before only");
      for (let n = 0; n < 24; n++) fs.writeFileSync(path.join(before, `historical-${n}.png`), tinyPng());
    }
  }
  return { repoRoot, packets, text };
}

test("real script contracts keep114/126 and matching raw maps do not request recapture", t => {
  const f = failureFixture(t), plans = failurePackets.plan(f.repoRoot);
  assert.deepEqual(plans.map(p => p.files.length), [114, 126]);
  assert.deepEqual(plans.map(p => p.required), [false, false]);
  assert.deepEqual(plans.map(p => p.layoutFiles.length), [11, 12]);
  fs.appendFileSync(path.join(f.repoRoot, "terminal/components/gexdesk/GexDeskView.tsx"), " changed");
  const changed = failurePackets.plan(f.repoRoot);
  assert.ok(changed.every(p => p.required));
  assert.ok(changed.every(p => JSON.stringify(p.changed) === JSON.stringify(["terminal/components/gexdesk/GexDeskView.tsx"])));
});

test("malformed, empty or partial source inventories cannot authorize a skip", t => {
  const f = failureFixture(t), file = path.join(f.repoRoot, "terminal/docs/pr-crops", f.packets[0].directory, "EVIDENCE.yml");
  for (const text of ["", "layoutFiles:\n", "layoutFiles:\n  /caller/path: a\n"]) {
    fs.writeFileSync(file, text); assert.throws(() => failurePackets.plan(f.repoRoot), /GEX_CAPTURE_LAYOUT/);
  }
});

for (const defect of ["none", "status", "signal", "missing", "corrupt", "cleanup", "source", "reader", "before"]) test(`full raw preparation ${defect} retains exact scope and never selects uncommitted evidence`, t => {
  const f = failureFixture(t); fs.appendFileSync(path.join(f.repoRoot, "terminal/components/gexdesk/GexDeskView.tsx"), " changed");
  const calls = [], env = { GITHUB_RUN_ID: "91", GITHUB_RUN_ATTEMPT: "1", RUNNER_TEMP: path.join(f.repoRoot, "runner"), GITHUB_ENV: path.join(f.repoRoot, "env") };
  const checkout = () => ({ actualCheckout: { commit: "a".repeat(40), tree: "b".repeat(40) } });
  const spawn = (_node, args, options) => {
    calls.push(args);
    if (args[0] === "node_modules/vitest/vitest.mjs") {
      assert.deepEqual(args.slice(1), ["run", "lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts", "lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts"]);
      return { status: defect === "reader" ? 1 : 0, signal: null };
    }
    assert.equal(options.env.CAPTURE_ONLY, ""); assert.equal(options.env.UPDATE_HEATMAP_EVIDENCE, "");
    const packet = f.packets.find(p => args[0].endsWith(p.script)); assert.ok(packet);
    if (defect === "source") fs.appendFileSync(path.join(f.repoRoot, packet.layoutFiles[0]), " mutation");
    const dir = options.env.TERMINAL_CROP_OUTPUT_DIR;
    fs.writeFileSync(path.join(dir, "EVIDENCE.yml"), f.text(packet));
    for (const file of packet.files) fs.writeFileSync(path.join(dir, file), tinyPng());
    if (defect === "missing") fs.unlinkSync(path.join(dir, packet.files[0]));
    if (defect === "corrupt") fs.writeFileSync(path.join(dir, packet.files[0]), Buffer.from("not a PNG"));
    if (defect === "before" && packet.id === "eod") fs.appendFileSync(path.join(f.repoRoot, "terminal/docs/pr-crops", packet.directory, "before/BEFORE.yml"), " changed");
    fs.writeSync(options.stdio[1], JSON.stringify({ gexFailureCleanup: { pid: 12345, closeObserved: defect !== "cleanup", processGroupAbsent: true, exitSuccess: "NOT_ASSERTED" } }) + "\n");
    return { status: defect === "status" ? 1 : 0, signal: defect === "signal" ? "SIGTERM" : null };
  };
  const invoke = () => run({ repoRoot: f.repoRoot, env, checkout, spawn, evidence: { profile: () => ({ fixture: true }) } });
  assert.throws(invoke, defect === "none" ? /REVIEW_IMPORT_REQUIRED/ : undefined);
  assert.equal(fs.existsSync(env.GITHUB_ENV), false);
  const record = JSON.parse(fs.readFileSync(path.join(env.RUNNER_TEMP, "terminal-ci-evidence/ci-91-1.json")));
  assert.equal(record.state, defect === "none" ? "REVIEW_IMPORT_REQUIRED" : "FAILED");
  assert.ok(calls.every(args => !args[0].includes("capture_pl6") && !args[0].includes("capture_visual_evidence")));
  if (defect === "none") {
    assert.equal(calls.length, 3);
    assert.deepEqual(record.failurePackets.map(p => p.outputs.length), [115, 127]);
    assert.ok(record.failurePackets.every(p => p.state === "VALIDATED_AWAITING_REVIEW_IMPORT"));
    assert.equal(Object.keys(record.failurePackets[1].historicalBefore).length, 25);
    assert.ok(fs.existsSync(path.join(record.failurePackets[1].outputDirectory, "before/BEFORE.yml")));
  } else if (!["reader", "before"].includes(defect)) assert.equal(calls.length, 1);
});

async function fullPageControl(name, source = fs.readFileSync(path.join(__dirname, name), "utf8"), replies = {}) {
  const vm = require("node:vm"), routes = [], pageRoutes = [], sockets = [];
  const page = { setDefaultTimeout() {}, route: async (predicate, handler) => pageRoutes.push({ predicate, handler }) };
  const context = { route: async (_glob, handler) => routes.push(handler), routeWebSocket: async (_glob, handler) => sockets.push(handler),
    addInitScript: async () => {}, addCookies: async () => {}, newPage: async () => page };
  const mod = { exports: {} }, fakeFs = { ...fs, mkdirSync() {} };
  const load = n => n === "node:fs" ? fakeFs : n === "node:child_process" ? { spawn() { throw Error("unexpected spawn"); }, execFileSync() { throw Error("unexpected git"); } }
    : n === "@playwright/test" ? { chromium: {} } : require(n);
  vm.runInNewContext(source + "\nmodule.exports.newPageForControl = newPage;", { module: mod, exports: mod.exports, require: load, __dirname, process: { env: {} }, URL, Buffer, console, setTimeout });
  await mod.exports.newPageForControl({ newContext: async () => context }, 1440, "en", "heatmap", replies, false);
  async function dispatch(raw, method = "GET", selectedReplies) {
    if (selectedReplies) return (await fullPageControl(name, source, selectedReplies)).dispatch(raw, method);
    const result = { transport: 0, aborted: 0, status: null };
    const route = { request: () => ({ url: () => raw, method: () => method }), fulfill: async value => { result.status = value.status; },
      abort: async () => { result.aborted++; }, fallback: async () => { result.transport++; } };
    const match = pageRoutes.find(item => item.predicate(new URL(raw)));
    if (match) await match.handler(route);
    else if (routes.length) await routes[0](route);
    else result.transport++;
    return result;
  }
  return { dispatch, sockets };
}
for (const name of ["capture_gex_levels_heatmap_load_failure.cjs", "capture_eod_heatmap_flowdesk_load_failure.cjs"]) test(`${name} closes actual quote/provider edge before transport and preserves selected injection`, async () => {
  const f = await fullPageControl(name), port = name.startsWith("capture_gex") ? 3564 : 3566, base = `http://127.0.0.1:${port}`;
  assert.deepEqual(await f.dispatch(base + "/api/quote?view=regular&syms=SPY"), { transport: 0, aborted: 0, status: 503 });
  for (const raw of ["https://provider.invalid/api/quote?syms=SPY", `http://a@127.0.0.1:${port}/api/quote?syms=SPY`, `http://127.0.0.1:${port + 1}/api/flow?f=manifest`, base + "/_next/image?url=https://provider.invalid/x"])
    assert.equal((await f.dispatch(raw)).transport, 0);
  assert.equal((await f.dispatch(base + "/api/quote?syms=SPY", "POST")).aborted, 1);
  assert.equal((await f.dispatch(base + "/api/flow?f=manifest")).transport, 1);
  assert.equal((await f.dispatch(base + "/api/quote?syms=SPY", "GET", { "/api/quote": "404" })).status, 404);
  let connected = 0, closed = 0;
  for (const raw of [base.replace("http:", "ws:") + "/_next/webpack-hmr?id=fixture-request-1", "wss://provider.invalid/stream", base.replace("http:", "ws:") + "/api/flow/stream", base.replace("http:", "ws:") + "/_next/webpack-hmr?id=a&target=provider"])
    f.sockets[0]({ url: () => raw, connectToServer() { connected++; }, close() { closed++; } });
  assert.equal(connected, 1); assert.equal(closed, 3);
});


// Execute the actual full-script main/start/stop/publication path. Only process,
// filesystem and browser/crop I/O are fake; no child, browser or HTTP is created.
async function fullMainControl(name, defect = "none", source = fs.readFileSync(path.join(__dirname, name), "utf8")) {
  const vm = require("node:vm"), events = [], writes = [], child = new EventEmitter();
  child.pid = 12345; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let reads = 0, captures = 0;
  const contract = require("./" + name).captureContract, fakeProcess = { env: {}, stdout: { write() {} }, exitCode: 0 };
  const browser = { close: async () => { events.push("browser-close"); } };
  const load = n => n === "node:fs" ? { mkdirSync() {},
    readFileSync() { reads++; return Buffer.from(defect === "source" && reads > contract.layoutFiles.length ? "changed" : "same"); },
    writeFileSync(file) { writes.push(file); events.push("write"); } }
    : n === "node:child_process" ? { spawn() { events.push("spawn"); return child; }, execFileSync() { return "a".repeat(40); } }
    : n === "@playwright/test" ? { chromium: { launch: async () => { events.push("browser-start"); return browser; } } }
    : n === "./f11_owned_server.cjs" ? { trackOwnedServer(actual) { assert.equal(actual, child); return {
      stop: async () => { events.push("stop"); await Promise.resolve(); if (["cleanup", "primarycleanup"].includes(defect)) throw Error("owned-cleanup-unknown"); events.push("stopped"); },
      settlement: () => ({ pid: child.pid, closeObserved: true, processGroupAbsent: true }),
    }; } } : require(n);
  const mod = { exports: {} }, fakeConsole = { log() {}, error() {} };
  vm.runInNewContext(source + `
    waitForServer = async () => { if (["startup", "primarycleanup"].includes(controlDefect)) throw Error("original-startup"); };
    newPage = async () => ({ context: { close: async () => {} }, page: { goto: async () => {}, screenshot: async () => {} } });
    assertNoNextIndicator = async () => {};
    for (const board of Object.keys(CAPTURE)) CAPTURE[board] = async () => controlCapture();
    module.exports.mainForControl = main;`, {
    module: mod, exports: mod.exports, require: load, __dirname, process: fakeProcess, URL, Buffer, console: fakeConsole, setTimeout,
    fetch: async raw => { assert.match(raw, /^http:\/\/127\.0\.0\.1:3566\/api\/flow\?f=flow_idx$/); return { ok: true, json: async () => ({ controlled: true }) }; },
    controlDefect: defect, controlCapture() { if (++captures === 1 && defect === "crop") throw Error("original-crop"); },
  });
  let error; try { await mod.exports.mainForControl(); } catch (e) { error = e; }
  return { captures, events, writes, error, exitCode: fakeProcess.exitCode };
}
for (const name of ["capture_gex_levels_heatmap_load_failure.cjs", "capture_eod_heatmap_flowdesk_load_failure.cjs"]) {
  for (const defect of ["none", "crop", "source", "startup", "cleanup", "primarycleanup"]) test(`${name} actual main ${defect} awaits owned cleanup and refuses incomplete/source-changed publication`, async () => {
    const result = await fullMainControl(name, defect);
    assert.equal(result.events.filter(event => event === "spawn").length, 1);
    assert.equal(result.events.filter(event => event === "stop").length, 1);
    if (defect === "none") {
      assert.equal(result.error, undefined); assert.equal(result.captures, name.startsWith("capture_gex") ? 114 : 126);
      assert.equal(result.writes.length, 1); assert.ok(result.events.indexOf("write") > result.events.indexOf("stopped"));
    } else {
      assert.equal(result.writes.length, 0);
      if (defect === "crop") assert.equal(result.exitCode, 1);
      else assert.match(result.error.message, ["startup", "primarycleanup"].includes(defect) ? /original-startup/ : defect === "cleanup" ? /owned-cleanup-unknown/ : /SOURCE_CHANGED/);
    }
    if (defect === "primarycleanup") assert.match(result.error.cleanupError.message, /owned-cleanup-unknown/);
  });
}

test("cleanup records require the exact finite settlement, not truthy fields or ambiguous multiple events", () => {
  const value = { pid: 12345, closeObserved: true, processGroupAbsent: true, exitSuccess: "NOT_ASSERTED" };
  const line = v => JSON.stringify({ gexFailureCleanup: v });
  assert.deepEqual(failurePackets.cleanupFromLog(line(value)), value);
  for (const invalid of [{ ...value, pid: undefined }, { ...value, closeObserved: "true" }, { ...value, processGroupAbsent: "true" }, { ...value, exitSuccess: "guessed" }])
    assert.throws(() => failurePackets.cleanupFromLog(line(invalid)), /CLEANUP_UNPROVED/);
  assert.throws(() => failurePackets.cleanupFromLog(line(value) + "\n" + line(value)), /CLEANUP_UNPROVED/);
});
