"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { run, operationIds, recordCheckout, legacyPackets, superviseLegacy, stopLegacyServer, settleLegacyServer, captureOptions } = require("./capture_ci_evidence.cjs");

function fixture(t, change = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-synthetic-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const env = { GITHUB_RUN_ID: "41600914408", GITHUB_RUN_ATTEMPT: "2", GITHUB_ENV: path.join(repoRoot, "github-env"), RUNNER_TEMP: path.join(repoRoot, "runner-temp") };
  const ids = operationIds(env), calls = [], inputs = [];
  const diagnostics = path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
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
    const packet = calls.length === 0 ? "pl6" : "vi";
    calls.push({ command, args, options });
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
  const packets = legacyPackets();
  const write = (relative, text) => {
    const file = path.join(repoRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  };
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const sourceHash = file => hash(fs.readFileSync(path.join(repoRoot, file)));
  const packetManifest = (definition, stale = false) => [
    "# capturedAtHead: " + "a".repeat(40), "layoutFiles:",
    ...definition.sources.map((file, n) => `  ${file}: "${stale && n === 0 ? "0".repeat(64) : sourceHash(file)}"`),
    "files:", ...definition.files.map(file => "  - " + file), "",
  ].join("\n");
  const optionsDirectory = "terminal/docs/pr-crops/options-level-axis-labels";
  const optionsSources = ["components/ChartPanel.tsx", "lib/optionsLevels.ts", "lib/priceTagPlacement.ts"];
  const optionsFiles = ["desktop.png", "tablet.png", "mobile.png", "desktop-left-percentage.png", "desktop-compact.png"];
  for (const file of new Set([
    ...packets.flatMap(packet => [...packet.sources, ...packet.controls]),
    ...optionsSources.map(file => "terminal/" + file), "terminal/e2e/tools/capture_pl6_batch1.cjs", optionsDirectory + "/capture.mjs",
  ])) write(file, "synthetic source: " + file);
  for (const definition of packets) {
    write(definition.directory + "/EVIDENCE.yml", packetManifest(definition, Boolean(change.legacyStale)));
    for (const file of definition.files) write(definition.directory + "/" + file, "old synthetic image " + file);
    if (definition.packet === "eod") write(definition.directory + "/before/BEFORE.yml", "unaltered historical chips");
  }
  const writeOptions = stale => {
    const captures = optionsFiles.map(file => {
      write(optionsDirectory + "/" + file, (stale ? "old" : "new") + " synthetic options image " + file);
      return { screenshot: file, sha256: sourceHash(optionsDirectory + "/" + file) };
    });
    const manifest = { sourceHead: "a".repeat(40), sourceFiles: Object.fromEntries(optionsSources.map((file, n) => [file, stale && n === 0 ? "0".repeat(64) : sourceHash("terminal/" + file)])), captures };
    write(optionsDirectory + "/manifest.json", JSON.stringify(manifest));
    return captures;
  };
  writeOptions(Boolean(change.optionsStale));
  write(optionsDirectory + "/coverage-audit-summary.json", "unchanged historical audit");
  evidence.imageInfo = bytes => ({ sha256: hash(bytes), width: 10, height: 10 });
  const legacyCalls = [];
  const spawnLegacy = (_command, args, options) => {
    const definition = packets.find(packet => packet.script === args[0]);
    legacyCalls.push(definition.packet);
    for (const key of ["CAPTURE_ONLY", "UPDATE_HEATMAP_EVIDENCE", "CAPTURE_HEAD", "TERMINAL_CROP_OUTPUT_DIR"])
      assert.equal(options.env[key], "", key + " cannot redirect the natural-CI full capture");
    const child = new EventEmitter(); child.pid = 424242;
    queueMicrotask(() => {
      child.emit("message", { legacyCaptureServer: { captureId: options.env.TERMINAL_LEGACY_CAPTURE_ID, phase: "started", pid: 424243, pgid: 424243 } });
      write(definition.directory + "/EVIDENCE.yml", packetManifest(definition));
      for (const file of definition.files) write(definition.directory + "/" + file, "fresh synthetic image " + file);
      if (change.mutateLegacySource) write(definition.sources[0], "changed during capture");
      if (change.mutateHistory && definition.packet === "eod") write(definition.directory + "/before/BEFORE.yml", "rewritten history");
      const receipt = { packet: definition.packet, captureId: options.env.TERMINAL_LEGACY_CAPTURE_ID,
        capturedAtHead: "a".repeat(40), manifestSha256: sourceHash(definition.directory + "/EVIDENCE.yml"),
        files: definition.files.map(file => ({ file, sha256: sourceHash(definition.directory + "/" + file) })) };
      if (change.partialLegacy) receipt.files.pop();
      if (change.wrongAttempt) receipt.captureId = "another-attempt";
      if (change.imageMismatch) receipt.files[0].sha256 = "0".repeat(64);
      if (!change.missingLegacyReceipt) fs.writeSync(options.stdio[1], JSON.stringify({ legacyEvidence: receipt }) + "\n");
      child.emit("message", { legacyCaptureServer: { captureId: options.env.TERMINAL_LEGACY_CAPTURE_ID, phase: "stopped", pid: 424243, pgid: 424243 } });
      child.emit("close", change.legacyStatus || 0, null);
    });
    return child;
  };
  const originalSpawn = spawn;
  const combinedSpawn = (command, args, options) => {
    const result = originalSpawn(command, args, options);
    if (options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE === "1") {
      const captures = writeOptions(false);
      if (change.mutateOptionsAudit) write(optionsDirectory + "/coverage-audit-summary.json", "changed audit");
      const receipt = { captureId: options.env.TERMINAL_CI_OPTIONS_CAPTURE_ID, capturedAtHead: "a".repeat(40),
        manifestSha256: sourceHash(optionsDirectory + "/manifest.json"),
        files: captures.map(capture => ({ file: capture.screenshot, sha256: capture.sha256 })) };
      if (change.partialOptions) receipt.files.pop();
      if (!change.missingOptionsReceipt) fs.writeSync(options.stdio[1], JSON.stringify({ optionsEvidence: receipt }) + "\n");
    }
    return result;
  };
  const invoke = () => run({ repoRoot, env, evidence, checkout, spawn: combinedSpawn, spawnLegacy });
  const diagnostic = () => JSON.parse(fs.readFileSync(path.join(diagnostics, `${ids.prefix}.json`)));
  const selected = () => fs.existsSync(env.GITHUB_ENV) ? fs.readFileSync(env.GITHUB_ENV, "utf8") : "";
  return { repoRoot, env, ids, calls, legacyCalls, packets, inputs, checkout, invoke, diagnostic, selected, diagnostics };
}

test("runs complete original captures, retains24PL6, selects20+30 and exact returned hashes", async t => {
  const f = fixture(t), r = await f.invoke();
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
]) test(`${name} preserves failure and does not export selector`, async t => {
  const f = fixture(t, change);
  await assert.rejects(f.invoke, error); assert.equal(f.selected(), ""); assert.equal(f.diagnostic().state, "FAILED");
  assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids.pl6}.stderr.log`), "utf8"), /original child diagnostic/);
});

test("capture filtering and prior composition are refused before child execution", async t => {
  for (const [key, value, error] of [["CAPTURE_ONLY", "ChartChrome", /CAPTURE_FILTER/],
    ["TERMINAL_EVIDENCE_COMPOSITION", "historical.composition.json", /PRESELECTED/]]) {
    const f = fixture(t); f.env[key] = value; await assert.rejects(f.invoke, error);
    assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
  }
});

test("stable per-run/attempt IDs refuse invalid values and duplicate invocation cannot overwrite", async t => {
  const f = fixture(t); assert.deepEqual(operationIds(f.env), operationIds({ ...f.env }));
  assert.notEqual(operationIds({ ...f.env, GITHUB_RUN_ATTEMPT: "3" }).pl6, f.ids.pl6);
  assert.throws(() => operationIds({ ...f.env, GITHUB_RUN_ID: "1\nx=2" }), /CI_EVIDENCE_ID/);
  await f.invoke(); const before = f.diagnostic(); await assert.rejects(f.invoke, /EEXIST/); assert.deepEqual(f.diagnostic(), before);
});

test("checkout-only metadata survives a later capture failure without selecting records", async t => {
  const f = fixture(t, { status: 1 });
  const early = recordCheckout({ repoRoot: f.repoRoot, env: f.env, checkout: f.checkout });
  await assert.rejects(f.invoke, /CHILD_FAILED/);
  const retained = JSON.parse(fs.readFileSync(path.join(f.diagnostics, `${f.ids.prefix}.checkout.json`)));
  assert.deepEqual(retained, early); assert.equal(f.selected(), "");
  assert.throws(() => recordCheckout({ repoRoot: f.repoRoot, env: f.env, checkout: f.checkout }), /EEXIST/);
});

for (const failure of [false, true]) test(`VI outputDir cleanup preserves ${failure ? "failed" : "successful"} diagnostics and open logs`, async t => {
  const f = fixture(t, { clearOutput: true, viStatus: failure ? 1 : 0 });
  fs.mkdirSync(path.join(f.repoRoot, "terminal", "test-results"), { recursive: true });
  fs.writeFileSync(path.join(f.repoRoot, "terminal", "test-results", "old.txt"), "old output");
  recordCheckout({ repoRoot: f.repoRoot, env: f.env, checkout: f.checkout });
  if (failure) await assert.rejects(f.invoke, /CHILD_FAILED: vi/); else await f.invoke();
  assert.equal(fs.existsSync(path.join(f.repoRoot, "terminal", "test-results", "old.txt")), false);
  assert.equal(f.diagnostic().state, failure ? "FAILED" : "SELECTED");
  assert.ok(fs.existsSync(path.join(f.diagnostics, `${f.ids.prefix}.checkout.json`)));
  for (const packet of ["pl6", "vi"]) {
    assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids[packet]}.stdout.log`), "utf8"), /visualEvidence/);
    assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids[packet]}.stderr.log`), "utf8"), /original child diagnostic/);
  }
  assert.equal(Boolean(f.selected()), !failure);
});

test("the stale EOD packet runs all126 cases, retain complete prior bytes and leave validation with native readers", async t => {
  const f = fixture(t, { legacyStale: true }), result = await f.invoke();
  assert.deepEqual(f.legacyCalls, ["eod"]);
  assert.equal(f.calls.length, 2);
  assert.equal(result.composition.selectedCases, 50);
  let cases = 0;
  for (const definition of f.packets) {
    const packet = result.legacyPackets[definition.packet];
    assert.equal(packet.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
    assert.equal(packet.images.length, definition.files.length); cases += packet.images.length;
    const image = definition.files[0];
    assert.equal(fs.readFileSync(path.join(packet.prior.path, image), "utf8"), "old synthetic image " + image);
    assert.equal(fs.readFileSync(path.join(packet.returned.path, image), "utf8"), "fresh synthetic image " + image);
    assert.equal(packet.receipt.captureId, f.ids.prefix + "-" + definition.packet);
  }
  assert.equal(cases, 126);
  const conductor = result.legacyPackets.eod;
  assert.deepEqual(conductor.prior.files["before/BEFORE.yml"], conductor.returned.files["before/BEFORE.yml"]);
});

test("current packets preserve their old capture identity and do not launch replacement captures", async t => {
  const f = fixture(t), result = await f.invoke();
  assert.deepEqual(f.legacyCalls, []);
  assert.ok(Object.values(result.legacyPackets).every(packet => packet.state === "EXISTING_PACKET_AWAITING_UNIT_VALIDATION"));
  assert.equal(result.optionsAxis.required, false);
  assert.equal(f.calls[0].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "0");
});

for (const [name, change, expected] of [
  ["nonzero producer", { legacyStatus: 1 }, /CHILD_FAILED_OR_UNSETTLED/],
  ["missing current receipt", { missingLegacyReceipt: true }, /RECEIPT_COUNT/],
  ["partial fresh inventory", { partialLegacy: true }, /RECEIPT_BINDING/],
  ["different attempt", { wrongAttempt: true }, /RECEIPT_BINDING/],
  ["changed image bytes", { imageMismatch: true }, /IMAGE_BINDING/],
  ["source changed during capture", { mutateLegacySource: true }, /SOURCE_CHANGED/],
  ["historical EOD packet changed", { mutateHistory: true }, /HISTORY_CHANGED/],
]) test(name + " keeps diagnostics and refuses selector export", async t => {
  const f = fixture(t, { legacyStale: true, ...change });
  await assert.rejects(f.invoke, expected);
  assert.equal(f.selected(), ""); assert.equal(f.diagnostic().state, "FAILED");
  const packet = f.diagnostic().legacyPackets[f.legacyCalls.at(-1)];
  assert.ok(fs.existsSync(packet.prior.path));
  assert.ok(fs.existsSync(packet.returned.path));
  assert.notEqual(packet.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  if (!change.mutateHistory) assert.deepEqual(f.legacyCalls, ["eod"]);
});

test("Options uses the full PL6 owner, records five fresh images, and preserves its historical audit", async t => {
  const f = fixture(t, { optionsStale: true }), result = await f.invoke();
  assert.equal(f.calls[0].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "1");
  assert.equal(f.calls[1].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "0");
  assert.equal(result.optionsAxis.images.length, 5);
  assert.equal(result.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.deepEqual(result.optionsAxis.prior.files["coverage-audit-summary.json"], result.optionsAxis.returned.files["coverage-audit-summary.json"]);
  assert.equal(Object.keys(result.optionsAxis.sources).length, 3);
});

test("an unsuccessful PL6 or Options child retains the unqualified returned packet and original failure", async t => {
  const f = fixture(t, { optionsStale: true, status: 1 });
  await assert.rejects(f.invoke, /CI_EVIDENCE_CHILD_FAILED: pl6/);
  const state = f.diagnostic().optionsAxis;
  assert.ok(fs.existsSync(path.join(state.returned.path, "manifest.json")));
  assert.equal(state.state, "CAPTURE_REQUIRED");
  assert.equal(f.calls.length, 1); assert.equal(f.selected(), "");
});

for (const [name, change, expected] of [
  ["missing Options completion", { missingOptionsReceipt: true }, /RECEIPT_COUNT/],
  ["partial Options completion", { partialOptions: true }, /RECEIPT_BINDING/],
  ["rewritten Options historical audit", { mutateOptionsAudit: true }, /AUDIT_CHANGED/],
]) test(name + " stops before VI and selection", async t => {
  const f = fixture(t, { optionsStale: true, ...change });
  await assert.rejects(f.invoke, expected);
  assert.equal(f.selected(), ""); assert.equal(f.calls.length, 1); assert.equal(f.legacyCalls.length, 0);
});

for (const definition of legacyPackets()) for (const count of [0, 1]) {
  test(definition.packet + " inspects the actual dev indicator DOM, count=" + count, async () => {
    const producer = require("./" + path.basename(definition.script));
    let inspected = 0;
    const page = {
      waitForTimeout: async () => {},
      evaluate: () => { throw new Error("DOM removal is forbidden"); },
      locator: selector => {
        assert.equal(selector, "[data-nextjs-dev-tools-button]");
        return { count: async () => { inspected++; return count; } };
      },
    };
    if (count) await assert.rejects(() => producer.assertNoNextIndicator(page, "synthetic.png"), /still mounted/);
    else await producer.assertNoNextIndicator(page, "synthetic.png");
    assert.equal(inspected, 1);
  });
}

test("Options keeps the owning server live before and after asynchronous child completion", async () => {
  const server = {}, observations = [], child = new EventEmitter(); child.pid = 424242;
  const pending = captureOptions({ server, ownedServer: actual => {
    assert.equal(actual, server); observations.push("owner"); return true;
  }, baseURL: "http://127.0.0.1:3536", terminal: "/synthetic/terminal", env: {},
  spawn: (_command, args, options) => {
    assert.deepEqual(args, ["docs/pr-crops/options-level-axis-labels/capture.mjs"]);
    assert.equal(options.env.BASE_URL, "http://127.0.0.1:3536");
    assert.equal(options.detached, true);
    observations.push("spawn"); queueMicrotask(() => child.emit("close", 0, null)); return child;
  } });
  await pending;
  assert.deepEqual(observations, ["owner", "spawn", "owner"]);
});

test("Options refuses a missing owner without starting another process", async () => {
  await assert.rejects(() => captureOptions({ server: {}, ownedServer: () => false,
    spawn: () => { throw new Error("must not start"); } }), /SERVER_NOT_READY/);
});

test("producer cleanup waits for the owned group after its npm leader has closed", async () => {
  let clock = 0, alive = true;
  const signals = [], child = { pid: 424242, closed: Promise.resolve(0) };
  const options = {
    now: () => clock,
    wait: async ms => { clock += ms; },
    kill: (pid, signal) => {
      assert.equal(pid, -424242);
      if (!alive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      if (signal) signals.push(signal);
      if (signal === "SIGKILL") alive = false;
    },
  };
  const first = stopLegacyServer(child, options);
  assert.equal(stopLegacyServer(child, options), first);
  await first;
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(alive, false);
  assert.equal(clock, 8_000);
});

test("producer cleanup refuses an owned group that survives both bounded signals", async () => {
  let clock = 0;
  await assert.rejects(() => stopLegacyServer({ pid: 424242, closed: Promise.resolve(0) }, {
    now: () => clock, wait: async ms => { clock += ms; }, kill: () => {},
  }), /GROUP_UNSETTLED/);
  assert.equal(clock, 13_000);
});

test("producer cleanup does not treat permission failure or absent close proof as success", async () => {
  const signals = [];
  await assert.rejects(() => stopLegacyServer({ pid: 424242, closed: Promise.resolve(0) }, {
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  }), /denied/);
  assert.deepEqual(signals, [0]);
  await assert.rejects(() => stopLegacyServer({ pid: 424242 }), /IDENTITY_OR_CLOSE_MISSING/);
});

function supervisorChild() {
  const child = new EventEmitter(); child.pid = 424242; child.unrefCount = 0;
  child.unref = () => { child.unrefCount++; };
  return child;
}

test("Legacy capture supervisor observes close, not merely a process exit", async () => {
  const child = supervisorChild(); let closed = false;
  const pending = superviseLegacy("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  pending.then(() => { closed = true; });
  child.emit("exit", 0, null); await Promise.resolve(); assert.equal(closed, false);
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.status, 0); assert.equal(result.timedOut, false);
});

test("a late exit-zero after the capture deadline remains a timeout failure", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseLegacy("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (pid, signal) => { assert.equal(pid, -424242); signals.push(signal); queueMicrotask(() => child.emit("close", 0, null)); },
  });
  assert.equal(result.status, 0); assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("a child that never closes is bounded and remains unsettled after hard termination", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseLegacy("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5, kill: (_pid, signal) => signals.push(signal),
  });
  assert.equal(result.closed, false); assert.equal(result.timedOut, true); assert.equal(child.unrefCount, 1);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  child.emit("close", 0, null); assert.equal(result.closed, false);
});

test("supervisor permission refusal stops termination attempts", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseLegacy("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  });
  assert.equal(result.closed, false); assert.equal(result.error.code, "EPERM");
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("supervisor retains spawn error and waits for its close event", async () => {
  const child = supervisorChild();
  const pending = superviseLegacy("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  child.emit("error", new Error("fixture ENOENT")); child.emit("close", -2, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.match(result.error.message, /ENOENT/);
});

function serverReport(child, phase, captureId = 'synthetic-attempt') {
  child.emit('message', { legacyCaptureServer: { captureId, phase, pid: 424243, pgid: 424243 } });
}

test('normal producer completion binds its stopped server to this attempt without another termination', async () => {
  const child = supervisorChild();
  const pending = superviseLegacy('node', [], { env: { TERMINAL_LEGACY_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No second cleanup after a proven stop'); },
  });
  serverReport(child, 'started'); serverReport(child, 'stopped'); child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, 424243);
  assert.equal(result.serverReportedStopped, true); assert.equal(result.serverSettled, true);
});

for (const survives of [false, true]) test(`hard producer termination reconciles its distinct server group, survives=${survives}`, async () => {
  const child = supervisorChild(), signals = []; let alive = true, tick = 0;
  const pending = superviseLegacy('node', [], { env: { TERMINAL_LEGACY_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    serverGraceMs: 5, serverKillMs: 5, now: () => tick, wait: async ms => { tick += ms; },
    kill: (pid, signal) => {
      if (pid === -424242) {
        signals.push([pid, signal]);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
        return;
      }
      assert.equal(pid, -424243);
      if (!alive) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal !== 0) signals.push([pid, signal]);
      if (signal === 'SIGKILL' && !survives) alive = false;
    },
  });
  serverReport(child, 'started');
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.equal(result.serverReportedStopped, false); assert.equal(result.serverSettled, !survives);
  assert.deepEqual(signals, [[-424242, 'SIGTERM'], [-424242, 'SIGKILL'], [-424243, 'SIGTERM'], [-424243, 'SIGKILL']]);
});

test('a producer close without an original server identity remains unsettled', async () => {
  const child = supervisorChild();
  const pending = superviseLegacy('node', [], {}, { spawn: () => child, deadlineMs: 1000,
    kill: () => { throw new Error('No guessed server group'); } });
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('a server identity from another capture attempt is refused without signalling it', async () => {
  const child = supervisorChild();
  const pending = superviseLegacy('node', [], { env: { TERMINAL_LEGACY_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No unrelated server group'); },
  });
  serverReport(child, 'started', 'another-attempt'); child.emit('close', 0, null);
  const result = await pending;
  assert.match(result.error.message, /SERVER_REPORT/); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('server permission refusal leaves reconciliation unresolved and sends no termination signal', async () => {
  const child = supervisorChild(), signals = [];
  const pending = superviseLegacy('node', [], { env: { TERMINAL_LEGACY_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000,
    kill: (pid, signal) => { signals.push([pid, signal]); throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
  });
  serverReport(child, 'started'); child.emit('close', 1, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverSettled, false); assert.equal(result.error.code, 'EPERM');
  assert.deepEqual(signals, [[-424243, 0]]);
});

for (const code of ["EPERM", "EACCES"]) {
  test("Legacy capture producer " + code + " propagates to its parent without another server probe or signal", async () => {
    const child = supervisorChild(), calls = [];
    const captureId = "synthetic-refused-attempt", server = { pid: 424243, pgid: 424243, captureId };
    const pending = superviseLegacy("node", [], { env: { TERMINAL_LEGACY_CAPTURE_ID: captureId } }, {
      spawn: () => child, deadlineMs: 1000,
      kill: (...args) => { calls.push(args); throw new Error("A denied server group must not be probed again"); },
    });
    child.emit("message", { legacyCaptureServer: { ...server, phase: "started" } });
    const denied = Object.assign(new Error("original server permission refusal"), { code });
    await assert.rejects(() => settleLegacyServer(server, {
      stop: async () => { throw denied; },
      report: async (actual, phase, actualCode) => {
        assert.equal(actual, server); assert.equal(phase, "refused"); assert.equal(actualCode, code);
        child.emit("message", { legacyCaptureServer: { ...server, phase, code: actualCode } });
      },
    }), error => error === denied);
    child.emit("close", 1, null);
    const result = await pending;
    assert.equal(result.serverRefused, code); assert.equal(result.serverSettled, false);
    assert.equal(result.error.code, code); assert.equal(result.closed, true); assert.deepEqual(calls, []);
  });
}

test("the complete EOD packet retains21 states at three widths in both languages", () => {
  const producer = require("./capture_eod_heatmap_flowdesk_load_failure.cjs");
  assert.equal(Object.keys(producer.STATES).length, 21);
  assert.equal(producer.FILES.length, 126);
  assert.equal(new Set(producer.FILES).size, 126);
});

test("EOD retry uses a current fixture row while structure faults keep their SPY route", () => {
  const producer = require("./capture_eod_heatmap_flowdesk_load_failure.cjs");
  const fixture = require("../../public/data/darkpool_fixture.json");
  const row = fixture.universe.find(row => row.ticker === "NVDA");
  assert.ok(row);
  assert.equal(row.asof, fixture.asof);
  assert.equal(row.session_status, "current");
  assert.ok(!fixture.universe.some(row => row.ticker === "SPY"));
  for (const state of Object.keys(producer.STATES)) {
    const url = new URL(producer.captureUrl(state), "http://capture.invalid");
    if (state.startsWith("eod-darkpool-")) assert.equal(url.searchParams.get("symbol"), "NVDA");
    else if (state.startsWith("eod-structure-")) assert.equal(url.href, "http://capture.invalid/options?tab=gex");
  }
});
