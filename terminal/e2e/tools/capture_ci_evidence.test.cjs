"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { run, operationIds, recordCheckout, BRIEFS_DIR, BRIEFS_CONTROL, briefsSources,
  readBriefsPacket, superviseBriefs } = require("./capture_ci_evidence.cjs");
const briefs = require("./capture_b_f11_7_recurring_briefs.cjs");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

// All images/transport in this owner are explicit synthetic boundaries. The actual
// PNG decoder remains visualEvidence.imageInfo; these are orchestration tests.
function manifestText(sources, { legacy = false, head = "a".repeat(40), history } = {}) {
  const shots = briefs.SHOTS.map(s => legacy && s.kind === "schedule"
    ? { ...s, kind: "subscribe", file: s.file.replace("schedule-", "subscribe-") } : s);
  return ["# B-F11-7 synthetic orchestration fixture", `# capturedAtHead: ${head}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    ...(history ? [`# priorManifest: ${history.file}`, `# priorManifestSha256: ${history.sha256}`] : []),
    "layoutFiles:", ...Object.entries(sources).map(([p, hash]) => `  ${p}: "${hash}"`),
    "theme: dark", "languages: [en, zh]", "viewports:",
    ...Object.entries(briefs.VIEWPORTS).map(([name, v]) => `  - { name: ${name}, width: ${v.width}, height: ${v.height} }`),
    "harness:", ...shots.map(s => `  ${s.file}: { kind: ${s.kind}, lang: ${s.lang}, viewport: ${s.viewport} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE", "capture_flag_law: synthetic fixture, not browser proof", "command: |",
    "  node e2e/tools/capture_b_f11_7_recurring_briefs.cjs", "files:", ...shots.map(s => `  - ${s.file}`), ""].join("\n");
}

function seedBriefs(repoRoot, change) {
  const paths = [...briefs.LAYOUT_FILES, "terminal/components/briefs/BriefSubscribeControls.tsx", ...BRIEFS_CONTROL];
  for (const relative of paths) {
    const absolute = path.join(repoRoot, relative); fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `synthetic source: ${relative}\n`);
  }
  const directory = path.join(repoRoot, BRIEFS_DIR); fs.mkdirSync(directory, { recursive: true });
  const sources = briefsSources(repoRoot);
  if (change.briefsLegacy) {
    delete sources["terminal/components/alerts/alerts.module.css"];
    const p = "terminal/components/briefs/BriefSubscribeControls.tsx";
    sources[p] = sha(fs.readFileSync(path.join(repoRoot, p)));
  }
  if (change.briefsStale) sources[briefs.LAYOUT_FILES[0]] = "0".repeat(64);
  for (const shot of briefs.SHOTS) fs.writeFileSync(path.join(directory, shot.file), `SYNTHETICPNG:prior:${shot.file}`);
  const prior = manifestText(sources, { legacy: !!change.briefsLegacy });
  fs.writeFileSync(path.join(directory, "EVIDENCE.yml"), prior);
  return { directory, prior };
}

function fixture(t, change = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-synthetic-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const env = { GITHUB_RUN_ID: "41600914408", GITHUB_RUN_ATTEMPT: "2", GITHUB_ENV: path.join(repoRoot, "github-env"), RUNNER_TEMP: path.join(repoRoot, "runner-temp") };
  const ids = operationIds(env), calls = [], inputs = [], briefsCalls = [];
  const briefFixture = seedBriefs(repoRoot, change);
  const diagnostics = path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
  const profile = { fixture: "terminal-e2e.v1", buildMode: "next-dev", sharedShell: "0", investorShellPreview: "0", theme: "dark" };
  const requirements = packet => Array.from({ length: packet === "pl6" ? 20 : 30 }, (_, n) => ({ packet, key: `${packet}:${n}` }));
  const evidence = {
    PACKETS: { pl6: "terminal/docs/pr-crops/b-pl-6-batch-1", vi: "terminal/docs/pr-crops/terminal-visual-intelligence" },
    profile: () => profile, requirements, canonical: JSON.stringify,
    imageInfo(bytes) {
      if (!bytes.toString().startsWith("SYNTHETICPNG:")) throw new Error("PNG_INVALID");
      return { sha256: sha(bytes), width: 10, height: 10 };
    },
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
  let checkoutReads = 0;
  const checkout = () => ({ actualCheckout: { commit: (++checkoutReads > 1 && change.checkoutDrift ? "c" : "a").repeat(40), tree: "b".repeat(40) },
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
  const spawnBriefs = (command, args, options) => {
    briefsCalls.push({ command, args, options });
    const child = new EventEmitter(); child.pid = 424242; child.unref = () => {};
    queueMicrotask(() => {
      const server = { captureId: options.env.TERMINAL_BRIEFS_CAPTURE_ID, pid: 424243, pgid: 424243 };
      child.emit("message", { briefsServer: { ...server, phase: "started" } });
      const before = fs.readFileSync(path.join(briefFixture.directory, "EVIDENCE.yml"));
      const history = { file: `EVIDENCE.history-${sha(before)}.yml`, sha256: sha(before) };
      fs.writeFileSync(path.join(briefFixture.directory, history.file), before);
      const files = briefs.SHOTS.map(shot => {
        const bytes = Buffer.from(`SYNTHETICPNG:new:${shot.file}`);
        fs.writeFileSync(path.join(briefFixture.directory, shot.file), bytes);
        return { file: shot.file, sha256: sha(bytes) };
      });
      const after = manifestText(briefsSources(repoRoot), { history });
      fs.writeFileSync(path.join(briefFixture.directory, "EVIDENCE.yml"), after);
      const receipt = { capturedAtHead: "a".repeat(40), files, history, manifestSha256: sha(after) };
      if (change.badReceiptHead) receipt.capturedAtHead = "c".repeat(40);
      if (change.partialReceipt) receipt.files = files.slice(0, 8);
      if (change.duplicateMember) receipt.files[11] = receipt.files[0];
      if (change.badImageHash) receipt.files[0].sha256 = "0".repeat(64);
      if (change.badImage) fs.writeFileSync(path.join(briefFixture.directory, files[0].file), "not a PNG");
      if (change.missingImage) fs.rmSync(path.join(briefFixture.directory, files[0].file));
      if (change.sourceDrift) fs.appendFileSync(path.join(repoRoot, briefs.LAYOUT_FILES[0]), "changed after capture");
      if (change.controlDrift) fs.appendFileSync(path.join(repoRoot, BRIEFS_CONTROL[0]), "changed after capture");
      if (change.historyDrift) fs.appendFileSync(path.join(briefFixture.directory, history.file), "changed history");
      const completion = `wrote 12 crops + EVIDENCE.yml (capturedAtHead ${"a".repeat(40)})\n`;
      if (!change.missingCompletion) fs.writeSync(options.stdio[1], completion);
      if (change.duplicateCompletion) fs.writeSync(options.stdio[1], completion);
      fs.writeSync(options.stdio[1], JSON.stringify({ briefsEvidence: receipt }) + "\n");
      if (change.duplicateReceipt) fs.writeSync(options.stdio[1], JSON.stringify({ briefsEvidence: receipt }) + "\n");
      fs.writeSync(options.stdio[2], "original Briefs child diagnostic\n");
      child.emit("message", { briefsServer: { ...server, phase: "stopped" } });
      child.emit("close", change.briefsStatus ?? 0, change.briefsSignal ?? null);
    });
    return child;
  };
  const invoke = () => run({ repoRoot, env, evidence, checkout, spawn, spawnBriefs });
  const diagnostic = () => JSON.parse(fs.readFileSync(path.join(diagnostics, `${ids.prefix}.json`)));
  const selected = () => fs.existsSync(env.GITHUB_ENV) ? fs.readFileSync(env.GITHUB_ENV, "utf8") : "";
  return { repoRoot, env, ids, calls, inputs, checkout, invoke, diagnostic, selected, diagnostics, briefsCalls, briefFixture };
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

test("current Briefs packet validates images without another capture or third operation", async t => {
  const f = fixture(t), result = await f.invoke();
  assert.equal(f.briefsCalls.length, 0);
  assert.equal(result.briefs.state, "CURRENT");
  assert.equal(result.briefs.images.length, 12);
  assert.equal(f.inputs[0].operations.length, 2);
  assert.equal(f.inputs[0].selections.length, 50);
});

for (const change of [{ briefsStale: true }, { briefsLegacy: true }]) {
  test(`${change.briefsLegacy ? "inventory migration" : "layout drift"} executes one complete Briefs capture and retains exact history`, async t => {
    const f = fixture(t, change), result = await f.invoke();
    assert.equal(f.briefsCalls.length, 1);
    const call = f.briefsCalls[0];
    assert.deepEqual(call.args, ["e2e/tools/capture_b_f11_7_recurring_briefs.cjs"]);
    assert.equal(call.options.env.CAPTURE_ONLY, "");
    assert.equal(call.options.env.TERMINAL_CROP_PORT, "3567");
    assert.equal(call.options.detached, true);
    assert.equal(result.briefs.state, "QUALIFIED");
    assert.equal(result.children[0].state, "CLOSED");
    assert.equal(result.briefs.images.length, 12);
    assert.equal(fs.readFileSync(result.briefs.priorManifestPath, "utf8"), f.briefFixture.prior);
    assert.equal(fs.readFileSync(path.join(f.briefFixture.directory, result.briefs.history.file), "utf8"), f.briefFixture.prior);
    assert.equal(readBriefsPacket(f.repoRoot).head, result.actualCheckout.commit);
    assert.notEqual(result.actualCheckout.commit, result.githubEvent.sha);
    assert.equal(f.inputs[0].operations.length, 2);
    assert.equal(f.inputs[0].selections.length, 50);
  });
}

for (const [name, change, expected] of [
  ["missing full completion", { missingCompletion: true }, /COMPLETION/],
  ["duplicate full completion", { duplicateCompletion: true }, /COMPLETION/],
  ["wrong checkout receipt", { badReceiptHead: true }, /RESULT_BINDING/],
  ["old twelve files with only eight qualified receipts", { partialReceipt: true }, /RESULT_BINDING/],
  ["duplicate image member", { duplicateMember: true }, /RESULT_BINDING/],
  ["duplicate structured completion", { duplicateReceipt: true }, /RECEIPT_COUNT/],
  ["non-PNG decoder result", { badImage: true }, /PNG_INVALID/],
  ["missing image", { missingImage: true }, /ENOENT/],
  ["image hash mismatch", { badImageHash: true }, /IMAGE_BINDING/],
  ["changed layout source", { sourceDrift: true }, /SOURCE_CHANGED/],
  ["changed producer source", { controlDrift: true }, /SOURCE_CHANGED/],
  ["changed checkout", { checkoutDrift: true }, /SOURCE_CHANGED/],
  ["rewritten historical manifest", { historyDrift: true }, /RESULT_BINDING/],
  ["failed child despite files and full completion", { briefsStatus: 1 }, /CHILD_FAILED/],
  ["signalled child despite files and full completion", { briefsSignal: "SIGTERM" }, /CHILD_FAILED/],
]) test(`Briefs ${name} retains diagnostics and never selects evidence`, async t => {
  const f = fixture(t, { briefsStale: true, ...change });
  await assert.rejects(f.invoke, expected);
  assert.equal(f.briefsCalls.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.inputs.length, 0);
  assert.equal(f.selected(), "");
  assert.equal(f.diagnostic().state, "FAILED");
  assert.equal(fs.readFileSync(path.join(f.diagnostics, `${f.ids.prefix}.briefs.prior-EVIDENCE.yml`), "utf8"), f.briefFixture.prior);
  assert.match(fs.readFileSync(path.join(f.diagnostics, `${f.ids.prefix}.briefs.stderr.log`), "utf8"), /original Briefs child diagnostic/);
});

for (const [name, mutate] of [
  ["duplicate top-level section", text => text + "layoutFiles:\n"],
  ["unsafe source path", text => text.replace(briefs.LAYOUT_FILES[0], "../private.txt")],
  ["missing layout member", text => text.replace(new RegExp(`^  ${briefs.LAYOUT_FILES[0]}:.*\\n`, "m"), "")],
  ["wrong theme", text => text.replace("theme: dark", "theme: light")],
  ["wrong viewport", text => text.replace("width: 390", "width: 391")],
  ["wrong case name", text => text.replaceAll("schedule-390.png", "FAIL-schedule-390.png")],
]) test(`malformed Briefs ${name} fails before any child`, async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.briefFixture.directory, "EVIDENCE.yml"), mutate(f.briefFixture.prior));
  await assert.rejects(f.invoke, /CI_BRIEFS/);
  assert.equal(f.calls.length + f.briefsCalls.length, 0);
  assert.equal(f.selected(), "");
});

test("Briefs source symlinks are refused before reading their targets", async t => {
  const f = fixture(t), file = path.join(f.repoRoot, briefs.LAYOUT_FILES[0]);
  fs.rmSync(file); fs.symlinkSync(path.join(f.repoRoot, briefs.LAYOUT_FILES[1]), file);
  await assert.rejects(f.invoke, /CI_BRIEFS_PATH/);
  assert.equal(f.calls.length + f.briefsCalls.length, 0);
  assert.equal(f.selected(), "");
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
  const first = briefs.stopServer(child, options);
  assert.equal(briefs.stopServer(child, options), first);
  await first;
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(alive, false);
  assert.equal(clock, 8_000);
});

test("producer cleanup refuses an owned group that survives both bounded signals", async () => {
  let clock = 0;
  await assert.rejects(() => briefs.stopServer({ pid: 424242, closed: Promise.resolve(0) }, {
    now: () => clock, wait: async ms => { clock += ms; }, kill: () => {},
  }), /GROUP_UNSETTLED/);
  assert.equal(clock, 13_000);
});

test("producer cleanup does not treat permission failure or absent close proof as success", async () => {
  const signals = [];
  await assert.rejects(() => briefs.stopServer({ pid: 424242, closed: Promise.resolve(0) }, {
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  }), /denied/);
  assert.deepEqual(signals, [0]);
  await assert.rejects(() => briefs.stopServer({ pid: 424242 }), /IDENTITY_OR_CLOSE_MISSING/);
});

function supervisorChild() {
  const child = new EventEmitter(); child.pid = 424242; child.unrefCount = 0;
  child.unref = () => { child.unrefCount++; };
  return child;
}

test("Briefs supervisor observes close, not merely a process exit", async () => {
  const child = supervisorChild(); let closed = false;
  const pending = superviseBriefs("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  pending.then(() => { closed = true; });
  child.emit("exit", 0, null); await Promise.resolve(); assert.equal(closed, false);
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.status, 0); assert.equal(result.timedOut, false);
});

test("a late exit-zero after the capture deadline remains a timeout failure", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseBriefs("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (pid, signal) => { assert.equal(pid, -424242); signals.push(signal); queueMicrotask(() => child.emit("close", 0, null)); },
  });
  assert.equal(result.status, 0); assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("a child that never closes is bounded and remains unsettled after hard termination", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseBriefs("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5, kill: (_pid, signal) => signals.push(signal),
  });
  assert.equal(result.closed, false); assert.equal(result.timedOut, true); assert.equal(child.unrefCount, 1);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  child.emit("close", 0, null); assert.equal(result.closed, false);
});

test("supervisor permission refusal stops termination attempts", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseBriefs("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  });
  assert.equal(result.closed, false); assert.equal(result.error.code, "EPERM");
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("supervisor retains spawn error and waits for its close event", async () => {
  const child = supervisorChild();
  const pending = superviseBriefs("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  child.emit("error", new Error("fixture ENOENT")); child.emit("close", -2, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.match(result.error.message, /ENOENT/);
});

for (const count of [0, 1]) test(`dev-indicator count${count} is inspected without removing DOM`, async () => {
  let inspected = 0;
  const page = {
    waitForTimeout: async () => {},
    evaluate: () => { throw new Error("DOM removal is forbidden"); },
    locator: selector => { assert.equal(selector, "[data-nextjs-dev-tools-button]"); return { count: async () => { inspected++; return count; } }; },
  };
  if (count) await assert.rejects(() => briefs.assertNoNextIndicator(page, "test.png"), /still mounted/);
  else await briefs.assertNoNextIndicator(page, "test.png");
  assert.equal(inspected, 1);
});

function serverReport(child, phase, captureId = 'synthetic-attempt') {
  child.emit('message', { briefsServer: { captureId, phase, pid: 424243, pgid: 424243 } });
}

test('normal producer completion binds its stopped server to this attempt without another termination', async () => {
  const child = supervisorChild();
  const pending = superviseBriefs('node', [], { env: { TERMINAL_BRIEFS_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No second cleanup after a proven stop'); },
  });
  serverReport(child, 'started'); serverReport(child, 'stopped'); child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, 424243);
  assert.equal(result.serverReportedStopped, true); assert.equal(result.serverSettled, true);
});

for (const survives of [false, true]) test(`hard producer termination reconciles its distinct server group, survives=${survives}`, async () => {
  const child = supervisorChild(), signals = []; let alive = true, tick = 0;
  const pending = superviseBriefs('node', [], { env: { TERMINAL_BRIEFS_CAPTURE_ID: 'synthetic-attempt' } }, {
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
  const pending = superviseBriefs('node', [], {}, { spawn: () => child, deadlineMs: 1000,
    kill: () => { throw new Error('No guessed server group'); } });
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('a server identity from another capture attempt is refused without signalling it', async () => {
  const child = supervisorChild();
  const pending = superviseBriefs('node', [], { env: { TERMINAL_BRIEFS_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No unrelated server group'); },
  });
  serverReport(child, 'started', 'another-attempt'); child.emit('close', 0, null);
  const result = await pending;
  assert.match(result.error.message, /SERVER_REPORT/); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('server permission refusal leaves reconciliation unresolved and sends no termination signal', async () => {
  const child = supervisorChild(), signals = [];
  const pending = superviseBriefs('node', [], { env: { TERMINAL_BRIEFS_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000,
    kill: (pid, signal) => { signals.push([pid, signal]); throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
  });
  serverReport(child, 'started'); child.emit('close', 1, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverSettled, false); assert.equal(result.error.code, 'EPERM');
  assert.deepEqual(signals, [[-424243, 0]]);
});

for (const code of ["EPERM", "EACCES"]) {
  test("Briefs producer " + code + " propagates to its parent without another server probe or signal", async () => {
    const child = supervisorChild(), calls = [];
    const captureId = "synthetic-refused-attempt", server = { pid: 424243, pgid: 424243, captureId };
    const pending = superviseBriefs("node", [], { env: { TERMINAL_BRIEFS_CAPTURE_ID: captureId } }, {
      spawn: () => child, deadlineMs: 1000,
      kill: (...args) => { calls.push(args); throw new Error("A denied server group must not be probed again"); },
    });
    child.emit("message", { briefsServer: { ...server, phase: "started" } });
    const denied = Object.assign(new Error("original server permission refusal"), { code });
    await assert.rejects(() => briefs.settleBriefsServer(server, {
      stop: async () => { throw denied; },
      report: async (actual, phase, actualCode) => {
        assert.equal(actual, server); assert.equal(phase, "refused"); assert.equal(actualCode, code);
        child.emit("message", { briefsServer: { ...server, phase, code: actualCode } });
      },
    }), error => error === denied);
    child.emit("close", 1, null);
    const result = await pending;
    assert.equal(result.serverRefused, code); assert.equal(result.serverSettled, false);
    assert.equal(result.error.code, code); assert.equal(result.closed, true); assert.deepEqual(calls, []);
  });
}
