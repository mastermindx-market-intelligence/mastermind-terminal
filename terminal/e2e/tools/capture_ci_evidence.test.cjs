"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const { run, operationIds, recordCheckout, nativeDefinition, nativeSources, verifyNativeHistory, superviseNative } = require("./capture_ci_evidence.cjs");

// Synthetic PNGs, sources and IPC boundaries exercise orchestration only.
// Production keeps the incumbent visualEvidence.imageInfo decoder and real Playwright.
function seedNative(repoRoot, change) {
  const definitions = ["eod", "gex"].map(nativeDefinition);
  for (const relative of new Set(definitions.flatMap(def => [...def.producer.LAYOUT_FILES,
    def.script, "terminal/e2e/tools/capture_ci_evidence.cjs"]))) {
    const file = path.join(repoRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `synthetic source: ${relative}\n`);
  }
  const result = {};
  for (const definition of definitions) {
    const family = definition.family, directory = path.join(repoRoot, definition.directory);
    fs.mkdirSync(directory, { recursive: true });
    const sources = nativeSources(repoRoot, definition.producer.LAYOUT_FILES);
    if ((change.nativeStale || []).includes(family)) sources[definition.producer.LAYOUT_FILES[0]] = "0".repeat(64);
    const prior = definition.producer.renderEvidence({ files: definition.files, layoutFiles: sources, capturedAtHead: "a".repeat(40) })
      + "currentCacheQualification:\n  sourceHead: historical-only\n";
    fs.writeFileSync(path.join(directory, "EVIDENCE.yml"), prior);
    for (const file of definition.files) fs.writeFileSync(path.join(directory, file), `SYNTHETICPNG:prior:${file}`);
    fs.mkdirSync(path.join(directory, "before"));
    fs.writeFileSync(path.join(directory, "before/BEFORE.yml"), "historical before-fix identity\n");
    fs.writeFileSync(path.join(directory, "before/before.png"), "SYNTHETICPNG:before");
    if (change.missingManifest === family) fs.rmSync(path.join(directory, "EVIDENCE.yml"));
    if (change.invalidManifest === family) fs.writeFileSync(path.join(directory, "EVIDENCE.yml"), "invalid but retained prior manifest\n");
    result[family] = { definition, directory, prior };
  }
  return result;
}

function nativeSpawn(f, change) {
  return (command, args, options) => {
    const family = args[0].includes("capture_eod_") ? "eod" : "gex";
    const { definition, directory } = f.nativeFixture[family];
    f.nativeCalls.push({ family, command, args, options });
    assert.equal(options.env.CAPTURE_ONLY, ""); assert.equal(options.env.UPDATE_HEATMAP_EVIDENCE, "");
    assert.equal(options.env.TERMINAL_CROP_OUTPUT_DIR, ""); assert.equal(options.env.CAPTURE_HEAD, "");
    assert.equal(options.env.TERMINAL_CROP_PORT, definition.port);
    assert.ok(definition.files.every(file => !fs.existsSync(path.join(directory, file))), "old root PNGs cannot count as fresh output");
    const child = new EventEmitter(); child.pid = 424240 + 2 * f.nativeCalls.length; child.unref = () => {};
    queueMicrotask(() => {
      const server = { captureId: options.env.TERMINAL_NATIVE_CAPTURE_ID, pid: child.pid + 1, pgid: child.pid + 1 };
      child.emit("message", { nativeCaptureServer: { ...server, phase: "started" } });
      let previous = null;
      try { previous = fs.readFileSync(path.join(directory, "EVIDENCE.yml")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const history = previous ? { file: `EVIDENCE.history-${sha(previous)}.yml`, sha256: sha(previous) } : null;
      if (history) fs.writeFileSync(path.join(directory, history.file), previous);
      const files = definition.files.map((file, index) => {
        const bytes = Buffer.from(`SYNTHETICPNG:new:${file}`);
        if (!(change.missingNativeImage && index === 0)) fs.writeFileSync(path.join(directory, file), bytes);
        return { file, sha256: sha(bytes) };
      });
      const sources = nativeSources(f.repoRoot, definition.producer.LAYOUT_FILES);
      let after = definition.producer.renderEvidence({ files: definition.files, layoutFiles: sources, capturedAtHead: "a".repeat(40), history });
      if (change.badNativeManifest) after += "files:\n  - duplicate.png\n";
      fs.writeFileSync(path.join(directory, "EVIDENCE.yml"), after);
      const receipt = { family, captureId: options.env.TERMINAL_NATIVE_CAPTURE_ID, capturedAtHead: "a".repeat(40),
        files, history, manifestSha256: sha(after) };
      if (change.nativeWrongFamily) receipt.family = "other";
      if (change.nativeWrongAttempt) receipt.captureId = "different-attempt";
      if (change.nativeWrongHead) receipt.capturedAtHead = "c".repeat(40);
      if (change.nativePartialReceipt) receipt.files = files.slice(1);
      if (change.nativeDuplicateMember) receipt.files[1] = receipt.files[0];
      if (change.nativeImageHash) receipt.files[0].sha256 = "0".repeat(64);
      if (change.nativeBadImage) fs.writeFileSync(path.join(directory, files[0].file), "not an image");
      if (change.nativeSourceDrift) fs.appendFileSync(path.join(f.repoRoot, definition.producer.LAYOUT_FILES[0]), "source moved");
      if (change.nativeControlDrift) fs.appendFileSync(path.join(f.repoRoot, definition.script), "control moved");
      if (change.nativeHistoryDrift) fs.appendFileSync(path.join(f.diagnostics, `${receipt.captureId}.prior-packet/EVIDENCE.yml`), "history moved");
      if (change.nativeHistoryCopyDrift && history) fs.appendFileSync(path.join(directory, history.file), "history moved");
      if (family === "gex" && change.nativeSecondMutatesFirstSource) fs.appendFileSync(path.join(f.repoRoot, f.nativeFixture.eod.definition.producer.LAYOUT_FILES[1]), "changed after first qualification");
      if (family === "gex" && change.nativeSecondMutatesFirstImage) fs.writeFileSync(path.join(f.nativeFixture.eod.directory, f.nativeFixture.eod.definition.files[0]), "SYNTHETICPNG:changed after first qualification");
      if (family === "gex" && change.nativeSecondMutatesComposition) fs.appendFileSync(path.join(f.repoRoot,
        `terminal/docs/pr-crops/b-pl-6-batch-1/ci-${f.env.GITHUB_RUN_ID}-${f.env.GITHUB_RUN_ATTEMPT}-current.composition.json`), "changed");
      const completion = `wrote ${definition.count} crops + EVIDENCE.yml (head ${"a".repeat(40)})\n`;
      if (!change.nativeMissingCompletion) fs.writeSync(options.stdio[1], completion);
      if (change.nativeDuplicateCompletion) fs.writeSync(options.stdio[1], completion);
      if (!change.nativeMissingReceipt) fs.writeSync(options.stdio[1], JSON.stringify({ nativeEvidence: receipt }) + "\n");
      if (change.nativeDuplicateReceipt) fs.writeSync(options.stdio[1], JSON.stringify({ nativeEvidence: receipt }) + "\n");
      fs.writeSync(options.stdio[2], "original native capture diagnostic\n");
      child.emit("message", { nativeCaptureServer: { ...server, phase: "stopped" } });
      child.emit("close", change.nativeStatus ?? 0, change.nativeSignal ?? null);
    });
    return child;
  };
}

function fixture(t, change = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-synthetic-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const env = { GITHUB_RUN_ID: "41600914408", GITHUB_RUN_ATTEMPT: "2", GITHUB_ENV: path.join(repoRoot, "github-env"), RUNNER_TEMP: path.join(repoRoot, "runner-temp") };
  const ids = operationIds(env), calls = [], inputs = [], nativeCalls = [];
  const nativeFixture = seedNative(repoRoot, change);
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
  const checkout = () => ({ actualCheckout: { commit: change.nativeCheckoutDrift && ++checkoutReads > 1 ? "c".repeat(40) : "a".repeat(40), tree: "b".repeat(40) },
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
  const spawnNative = nativeSpawn({ repoRoot, env, nativeCalls, nativeFixture, diagnostics }, change);
  const invoke = () => run({ repoRoot, env, evidence, checkout, spawn, spawnNative });
  const diagnostic = () => JSON.parse(fs.readFileSync(path.join(diagnostics, `${ids.prefix}.json`)));
  const selected = () => fs.existsSync(env.GITHUB_ENV) ? fs.readFileSync(env.GITHUB_ENV, "utf8") : "";
  return { repoRoot, env, ids, calls, inputs, checkout, invoke, diagnostic, selected, diagnostics, nativeCalls, nativeFixture };
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

test("matching EOD/GEX packets preserve the existing two-operation selection without another capture", async t => {
  const f = fixture(t), result = await f.invoke();
  assert.equal(f.nativeCalls.length, 0);
  assert.deepEqual(Object.values(result.native).map(value => value.state), ["CURRENT", "CURRENT"]);
  assert.deepEqual(Object.values(result.native).map(value => value.images.length), [126, 114]);
  assert.equal(f.inputs[0].operations.length, 2); assert.equal(f.inputs[0].selections.length, 50);
});

for (const change of [
  { nativeStale: ["eod", "gex"] }, { missingManifest: "eod" }, { invalidManifest: "gex" },
]) test(`complete original native matrices qualify only after settled execution: ${JSON.stringify(change)}`, async t => {
  const f = fixture(t, change);
  f.env.UPDATE_HEATMAP_EVIDENCE = "1"; f.env.TERMINAL_CROP_OUTPUT_DIR = "unrelated"; f.env.CAPTURE_HEAD = "unrelated";
  const result = await f.invoke();
  assert.equal(result.state, "SELECTED");
  assert.equal(f.inputs[0].operations.length, 2); assert.equal(f.inputs[0].selections.length, 50);
  const expected = change.nativeStale || [change.missingManifest || change.invalidManifest];
  assert.deepEqual(f.nativeCalls.map(value => value.family), expected);
  for (const family of expected) {
    const current = result.native[family], old = f.nativeFixture[family];
    assert.equal(current.state, "QUALIFIED"); assert.equal(current.images.length, old.definition.count);
    verifyNativeHistory(current.history);
    assert.equal(current.history.originalLogicalBase, old.definition.directory);
    assert.equal(fs.readFileSync(path.join(old.directory, "before/BEFORE.yml"), "utf8"), "historical before-fix identity\n");
    assert.equal(fs.readFileSync(path.join(current.history.archiveRoot, "before/before.png"), "utf8"), "SYNTHETICPNG:before");
    if (!change.missingManifest && !change.invalidManifest) {
      assert.equal(fs.readFileSync(path.join(current.history.archiveRoot, "EVIDENCE.yml"), "utf8"), old.prior);
      assert.match(old.prior, /currentCacheQualification/);
    }
    assert.ok(result.children.find(child => child.packet === family).serverReportedStopped);
  }
});

for (const [name, change, error] of [
  ["nonzero producer", { nativeStatus: 1 }, /CHILD_FAILED_OR_UNSETTLED/],
  ["signalled producer", { nativeSignal: "SIGTERM" }, /CHILD_FAILED_OR_UNSETTLED/],
  ["wrong family", { nativeWrongFamily: true }, /RESULT_BINDING/],
  ["wrong attempt", { nativeWrongAttempt: true }, /RESULT_BINDING/],
  ["wrong head", { nativeWrongHead: true }, /RESULT_BINDING/],
  ["partial receipt", { nativePartialReceipt: true }, /RESULT_BINDING/],
  ["duplicate member", { nativeDuplicateMember: true }, /RESULT_BINDING/],
  ["wrong image digest", { nativeImageHash: true }, /IMAGE_BINDING/],
  ["missing fresh image", { missingNativeImage: true }, /ENOENT/],
  ["invalid image", { nativeBadImage: true }, /PNG_INVALID/],
  ["ambiguous manifest", { badNativeManifest: true }, /MANIFEST/],
  ["changed layout", { nativeSourceDrift: true }, /SOURCE_CHANGED/],
  ["changed capture control", { nativeControlDrift: true }, /SOURCE_CHANGED/],
  ["changed checkout", { nativeCheckoutDrift: true }, /SOURCE_CHANGED/],
  ["changed archived packet", { nativeHistoryDrift: true }, /HISTORY_CHANGED/],
  ["changed history link", { nativeHistoryCopyDrift: true }, /HISTORY_BINDING/],
  ["missing completion", { nativeMissingCompletion: true }, /COMPLETION/],
  ["duplicate completion", { nativeDuplicateCompletion: true }, /COMPLETION/],
  ["missing receipt", { nativeMissingReceipt: true }, /RECEIPT_COUNT/],
  ["duplicate receipt", { nativeDuplicateReceipt: true }, /RECEIPT_COUNT/],
]) test(`native ${name} preserves failure and cannot select CI evidence`, async t => {
  const f = fixture(t, { nativeStale: ["eod"], ...change });
  await assert.rejects(f.invoke, error);
  assert.equal(f.selected(), ""); assert.equal(f.diagnostic().state, "FAILED");
  assert.equal(f.nativeCalls.length, 1);
});

test("native source symlinks are refused before any native child starts", async t => {
  const f = fixture(t), def = nativeDefinition("eod");
  const file = path.join(f.repoRoot, def.producer.LAYOUT_FILES[0]);
  fs.rmSync(file); fs.symlinkSync(path.join(f.repoRoot, def.producer.LAYOUT_FILES[1]), file);
  await assert.rejects(f.invoke, /CI_NATIVE_PATH/);
  assert.equal(f.nativeCalls.length, 0); assert.equal(f.selected(), "");
});

test("a historical packet symlink is never followed during fresh qualification", async t => {
  const f = fixture(t, { nativeStale: ["eod"] }), old = f.nativeFixture.eod;
  fs.symlinkSync(path.join(f.repoRoot, "terminal"), path.join(old.directory, "unrelated-directory"));
  await assert.rejects(f.invoke, /CI_NATIVE_HISTORY_PATH/);
  assert.equal(f.nativeCalls.length, 0); assert.equal(f.selected(), "");
});

for (const [change, error] of [
  [{ nativeSecondMutatesFirstSource: true }, /SOURCE_CHANGED/],
  [{ nativeSecondMutatesFirstImage: true }, /IMAGE_BINDING/],
  [{ nativeSecondMutatesComposition: true }, /COMPOSITION_BYTES/],
]) test(`the final selection rechecks prior owners after the second native producer: ${JSON.stringify(change)}`, async t => {
  const f = fixture(t, { nativeStale: ["eod", "gex"], ...change });
  await assert.rejects(f.invoke, error);
  assert.equal(f.nativeCalls.length, 2); assert.equal(f.selected(), "");
});

for (const family of ["eod", "gex"]) for (const code of ["EPERM", "EACCES"]) {
  test(`${family} producer ${code} propagates to its parent without another server probe or signal`, async () => {
    const producer = nativeDefinition(family).producer, child = supervisorChild(), calls = [];
    const captureId = "synthetic-refused-attempt", server = { pid: 424243, pgid: 424243, captureId };
    const pending = superviseNative("node", [], { env: { TERMINAL_NATIVE_CAPTURE_ID: captureId } }, {
      spawn: () => child, deadlineMs: 1000,
      kill: (...args) => { calls.push(args); throw new Error("A denied server group must not be probed again"); },
    });
    child.emit("message", { nativeCaptureServer: { ...server, phase: "started" } });
    const denied = Object.assign(new Error("original server permission refusal"), { code });
    await assert.rejects(() => producer.settleNativeServer(server, {
      stop: async () => { throw denied; },
      report: async (actual, phase, actualCode) => {
        assert.equal(actual, server); assert.equal(phase, "refused"); assert.equal(actualCode, code);
        child.emit("message", { nativeCaptureServer: { ...server, phase, code: actualCode } });
      },
    }), error => error === denied);
    child.emit("close", 1, null);
    const result = await pending;
    assert.equal(result.serverRefused, code); assert.equal(result.serverSettled, false);
    assert.equal(result.error.code, code); assert.equal(result.closed, true); assert.deepEqual(calls, []);
  });
}


for (const family of ["eod", "gex"]) {
  const producer = nativeDefinition(family).producer;
test(`${family} producer cleanup waits for the owned group after its npm leader has closed`, async () => {
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
  const first = producer.stopServer(child, options);
  assert.equal(producer.stopServer(child, options), first);
  await first;
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(alive, false);
  assert.equal(clock, 8_000);
});

test(`${family} producer cleanup refuses an owned group that survives both bounded signals`, async () => {
  let clock = 0;
  await assert.rejects(() => producer.stopServer({ pid: 424242, closed: Promise.resolve(0) }, {
    now: () => clock, wait: async ms => { clock += ms; }, kill: () => {},
  }), /GROUP_UNSETTLED/);
  assert.equal(clock, 13_000);
});

test(`${family} producer cleanup does not treat permission failure or absent close proof as success`, async () => {
  const signals = [];
  await assert.rejects(() => producer.stopServer({ pid: 424242, closed: Promise.resolve(0) }, {
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  }), /denied/);
  assert.deepEqual(signals, [0]);
  await assert.rejects(() => producer.stopServer({ pid: 424242 }), /IDENTITY_OR_CLOSE_MISSING/);
});

}

function supervisorChild() {
  const child = new EventEmitter(); child.pid = 424242; child.unrefCount = 0;
  child.unref = () => { child.unrefCount++; };
  return child;
}

test("Native supervisor observes close, not merely a process exit", async () => {
  const child = supervisorChild(); let closed = false;
  const pending = superviseNative("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  pending.then(() => { closed = true; });
  child.emit("exit", 0, null); await Promise.resolve(); assert.equal(closed, false);
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.status, 0); assert.equal(result.timedOut, false);
});

test("a late exit-zero after the capture deadline remains a timeout failure", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseNative("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (pid, signal) => { assert.equal(pid, -424242); signals.push(signal); queueMicrotask(() => child.emit("close", 0, null)); },
  });
  assert.equal(result.status, 0); assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("a child that never closes is bounded and remains unsettled after hard termination", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseNative("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5, kill: (_pid, signal) => signals.push(signal),
  });
  assert.equal(result.closed, false); assert.equal(result.timedOut, true); assert.equal(child.unrefCount, 1);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  child.emit("close", 0, null); assert.equal(result.closed, false);
});

test("supervisor permission refusal stops termination attempts", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseNative("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  });
  assert.equal(result.closed, false); assert.equal(result.error.code, "EPERM");
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("supervisor retains spawn error and waits for its close event", async () => {
  const child = supervisorChild();
  const pending = superviseNative("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  child.emit("error", new Error("fixture ENOENT")); child.emit("close", -2, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.match(result.error.message, /ENOENT/);
});

for (const family of ["eod", "gex"]) {
  const producer = nativeDefinition(family).producer;
for (const count of [0, 1]) test(`${family} dev-indicator count${count} is inspected without removing DOM`, async () => {
  let inspected = 0;
  const page = {
    waitForTimeout: async () => {},
    evaluate: () => { throw new Error("DOM removal is forbidden"); },
    locator: selector => { assert.equal(selector, "[data-nextjs-dev-tools-button]"); return { count: async () => { inspected++; return count; } }; },
  };
  if (count) await assert.rejects(() => producer.assertNoNextIndicator(page, "test.png"), /still mounted/);
  else await producer.assertNoNextIndicator(page, "test.png");
  assert.equal(inspected, 1);
});

}
function serverReport(child, phase, captureId = 'synthetic-attempt') {
  child.emit('message', { nativeCaptureServer: { captureId, phase, pid: 424243, pgid: 424243 } });
}

test('normal producer completion binds its stopped server to this attempt without another termination', async () => {
  const child = supervisorChild();
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No second cleanup after a proven stop'); },
  });
  serverReport(child, 'started'); serverReport(child, 'stopped'); child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, 424243);
  assert.equal(result.serverReportedStopped, true); assert.equal(result.serverSettled, true);
});

for (const survives of [false, true]) test(`hard producer termination reconciles its distinct server group, survives=${survives}`, async () => {
  const child = supervisorChild(), signals = []; let alive = true, tick = 0;
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
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
  const pending = superviseNative('node', [], {}, { spawn: () => child, deadlineMs: 1000,
    kill: () => { throw new Error('No guessed server group'); } });
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('a server identity from another capture attempt is refused without signalling it', async () => {
  const child = supervisorChild();
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No unrelated server group'); },
  });
  serverReport(child, 'started', 'another-attempt'); child.emit('close', 0, null);
  const result = await pending;
  assert.match(result.error.message, /SERVER_REPORT/); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('server permission refusal leaves reconciliation unresolved and sends no termination signal', async () => {
  const child = supervisorChild(), signals = [];
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000,
    kill: (pid, signal) => { signals.push([pid, signal]); throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
  });
  serverReport(child, 'started'); child.emit('close', 1, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverSettled, false); assert.equal(result.error.code, 'EPERM');
  assert.deepEqual(signals, [[-424243, 0]]);
});
