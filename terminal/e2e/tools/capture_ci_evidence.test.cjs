"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { run, operationIds, recordCheckout, batch2Plan } = require("./capture_ci_evidence.cjs");
const { LAYOUT_FILES, EXPECTED_FILES, assertCompletePacket, assertCaptureNavigation, cropBox } = require("./capture_pl6_batch2.cjs");
const batch2Relative = "terminal/docs/pr-crops/b-pl-6-batch-2";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const flags = ["conductor_step: 2", "screenshot_animations: disabled", "screenshot_raster: full",
  "guide_motion: reduced", "guide_backdrop: hidden"];
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("synthetic test bytes")]);

function packetText(repoRoot, { legacy = false, head = "0".repeat(40), historical = null } = {}) {
  const lines = ["# capturedAtHead: " + head, "layoutFiles:",
    ...LAYOUT_FILES.map(rel => "  " + rel + ': "' + hash(fs.readFileSync(path.join(repoRoot, rel))) + '"'),
    // Preserve the current accepted legacy scalar; this is intentionally not a whole-YAML parser.
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set",
    ...(legacy ? [] : flags), "files:", ...EXPECTED_FILES.map(file => "  - " + file),
    ...(legacy ? [] : ["captureFiles:", ...EXPECTED_FILES.map(file =>
      "  " + file + ': "' + hash(fs.readFileSync(path.join(repoRoot, batch2Relative, file))) + '"')]),
    ...(historical ? ["previousManifest: " + historical] : []), ""];
  return lines.join("\n");
}

function fixture(t, change = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-synthetic-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const env = { GITHUB_RUN_ID: "41600914408", GITHUB_RUN_ATTEMPT: "2", GITHUB_ENV: path.join(repoRoot, "github-env"), RUNNER_TEMP: path.join(repoRoot, "runner-temp") };
  const ids = operationIds(env), calls = [], inputs = [];
  const diagnostics = path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
  const batch2Dir = path.join(repoRoot, batch2Relative), manifest = path.join(batch2Dir, "EVIDENCE.yml");
  fs.mkdirSync(batch2Dir, { recursive: true });
  for (const rel of LAYOUT_FILES) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, rel), "synthetic source: " + rel);
  }
  for (const file of EXPECTED_FILES) fs.writeFileSync(path.join(batch2Dir, file), png);
  const seed = packetText(repoRoot, { legacy: true });
  const seedHistory = "history/before-deterministic-" + hash(seed) + ".yml";
  fs.mkdirSync(path.join(batch2Dir, "history"), { recursive: true });
  fs.writeFileSync(path.join(batch2Dir, seedHistory), seed);
  fs.writeFileSync(manifest, packetText(repoRoot, { legacy: change.batch2Legacy,
    historical: change.batch2Legacy ? null : seedHistory }));
  const priorManifest = fs.readFileSync(manifest);
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
    const packet = args[0].includes("batch2") ? "batch2" : calls.length === 0 ? "pl6" : "vi";
    calls.push({ command, args, options });
    fs.writeSync(options.stdio[2], "original child diagnostic\n");
    if (packet === "batch2") {
      if (change.batch2Throws) throw new Error("batch2 spawn threw");
      if (change.batch2Drift) fs.appendFileSync(path.join(repoRoot, LAYOUT_FILES[0]), "\nchanged during capture");
      const history = "history/before-deterministic-" + hash(priorManifest) + ".yml";
      fs.mkdirSync(path.join(batch2Dir, "history"), { recursive: true });
      if (change.batch2HistoryMissing) fs.rmSync(path.join(batch2Dir, history), { force: true });
      else fs.writeFileSync(path.join(batch2Dir, history), priorManifest);
      const actualHead = change.batch2WrongHead ? "f".repeat(40) : "a".repeat(40);
      fs.writeFileSync(manifest, packetText(repoRoot, { head: actualHead, historical: history,
        legacy: change.batch2Partial }));
      if (change.batch2CorruptImage) fs.writeFileSync(path.join(batch2Dir, EXPECTED_FILES[0]), "not an image");
      const completion = "capturedAtHead " + actualHead + "\nwrote " + (change.batch2Count ?? 16)
        + " crops + EVIDENCE.yml to " + batch2Dir + "\n";
      if (!change.batch2MissingCompletion) fs.writeSync(options.stdio[1], completion);
      if (change.batch2DuplicateCompletion) fs.writeSync(options.stdio[1], completion);
      return { status: change.batch2Status ?? 0, signal: change.batch2Signal ?? null, error: change.batch2Error };
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
    batch2Dir, manifest, priorManifest };
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

test("current full deterministic batch2 packet is left for native validation without a duplicate capture", t => {
  const f = fixture(t), before = fs.readFileSync(f.manifest), r = f.invoke();
  assert.equal(r.batch2.state, "EXISTING_PACKET_AWAITING_NATIVE_VALIDATION");
  assert.equal(r.batch2.required, false); assert.equal(f.calls.length, 2);
  assert.deepEqual(fs.readFileSync(f.manifest), before);
});

test("legacy receipt forces the incumbent full16 capture and preserves exact prior history before selecting50", t => {
  const f = fixture(t, { batch2Legacy: true }), r = f.invoke();
  assert.equal(r.state, "SELECTED");
  assert.equal(r.batch2.state, "CAPTURED_AWAITING_NATIVE_VALIDATION");
  assert.equal(r.batch2.actualCheckout, "a".repeat(40));
  assert.deepEqual(f.calls[2].args, ["e2e/tools/capture_pl6_batch2.cjs"]);
  assert.equal(f.calls[2].options.env.CAPTURE_ONLY, "");
  assert.equal(f.calls[2].options.env.TERMINAL_CROP_PORT, "3538");
  assert.equal(f.calls[2].options.timeout, 20 * 60_000);
  assert.equal(f.calls[2].options.killSignal, "SIGTERM");
  assert.equal(Object.keys(r.batch2.imageHashes).length, 16);
  assert.deepEqual(fs.readFileSync(r.batch2.historicalDiagnostic), f.priorManifest);
  assert.deepEqual(fs.readFileSync(path.join(f.batch2Dir, r.batch2.historicalManifest)), f.priorManifest);
  assert.equal(f.inputs[0].operations.length, 2);
  assert.equal(f.inputs[0].selections.length, 50);
  assert.deepEqual(r.references.map(ref => ref.path), [
    f.inputs[0].operations[0].path, f.inputs[0].operations[1].path,
  ]);
});

test("current-source drift requires real recapture without approximating the legacy lex projection", t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.repoRoot, "terminal/lib/i18n.tsx"), "\nnew source");
  const plan = batch2Plan(f.repoRoot);
  assert.equal(plan.required, true); assert.ok(plan.reasons.includes("source-bytes-changed"));
  const r = f.invoke();
  assert.equal(r.batch2.state, "CAPTURED_AWAITING_NATIVE_VALIDATION");
});

for (const [name, change, error] of [
  ["nonzero", { batch2Status: 1 }, /CHILD_FAILED: batch2/],
  ["signal", { batch2Signal: "SIGTERM" }, /CHILD_FAILED: batch2/],
  ["timeout", { batch2Error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }) }, /ETIMEDOUT/],
  ["spawn exception", { batch2Throws: true }, /batch2 spawn threw/],
  ["missing completion", { batch2MissingCompletion: true }, /BATCH2_COMPLETION/],
  ["duplicate completion", { batch2DuplicateCompletion: true }, /BATCH2_COMPLETION/],
  ["wrong checkout", { batch2WrongHead: true }, /BATCH2_COMPLETION/],
  ["incomplete count", { batch2Count: 15 }, /BATCH2_COMPLETION/],
  ["partial packet", { batch2Partial: true }, /BATCH2_CAPTURE_SOURCE/],
  ["source changed during capture", { batch2Drift: true }, /BATCH2_CAPTURE_SOURCE/],
  ["lost history", { batch2HistoryMissing: true }, /ENOENT/],
  ["invalid actual image", { batch2CorruptImage: true }, /BATCH2_IMAGE_BYTES/],
]) test("batch2 " + name + " preserves failure, logs and history without selecting a composition", t => {
  const f = fixture(t, { batch2Legacy: true, ...change });
  assert.throws(f.invoke, error); assert.equal(f.selected(), "");
  assert.equal(f.inputs.length, 0); assert.equal(f.diagnostic().state, "FAILED");
  assert.deepEqual(fs.readFileSync(path.join(f.diagnostics, f.ids.prefix + ".batch2.previous-manifest.yml")), f.priorManifest);
  assert.match(fs.readFileSync(path.join(f.diagnostics, f.ids.prefix + "-batch2.stderr.log"), "utf8"), /original child diagnostic/);
});

for (const [name, mutate, error] of [
  ["duplicate layout", f => {
    const text = fs.readFileSync(f.manifest, "utf8"), row = text.split("\n").find(line => line.startsWith("  terminal/"));
    fs.writeFileSync(f.manifest, text.replace("layoutFiles:\n", "layoutFiles:\n" + row + "\n"));
  }, /BATCH2_MANIFEST_HASH/],
  ["missing source", f => fs.unlinkSync(path.join(f.repoRoot, LAYOUT_FILES[0])), /ENOENT/],
  ["duplicate image", f => {
    const text = fs.readFileSync(f.manifest, "utf8");
    fs.writeFileSync(f.manifest, text.replace("files:\n", "files:\n  - " + EXPECTED_FILES[0] + "\n"));
  }, /BATCH2_MANIFEST_FILES/],
  ["duplicate flag", f => fs.appendFileSync(f.manifest, "\nconductor_step: 2\n"), /BATCH2_MANIFEST_FLAG/],
  ["wrong image bytes", f => fs.appendFileSync(path.join(f.batch2Dir, EXPECTED_FILES[0]), "changed"), /BATCH2_IMAGE_HASH/],
  ["missing history declaration", f => {
    fs.writeFileSync(f.manifest, fs.readFileSync(f.manifest, "utf8").replace(/^previousManifest:.*\n/m, ""));
  }, /BATCH2_DECLARED_HISTORY/],
  ["duplicate history declaration", f => {
    const row = fs.readFileSync(f.manifest, "utf8").split("\n").find(line => line.startsWith("previousManifest:"));
    fs.appendFileSync(f.manifest, row + "\n");
  }, /BATCH2_DECLARED_HISTORY/],
  ["history path traversal", f => {
    fs.writeFileSync(f.manifest, fs.readFileSync(f.manifest, "utf8").replace(/^previousManifest:.*$/m, "previousManifest: ../../secret.yml"));
  }, /BATCH2_DECLARED_HISTORY/],
  ["lost existing history", f => {
    const row = fs.readFileSync(f.manifest, "utf8").split("\n").find(line => line.startsWith("previousManifest:"));
    fs.unlinkSync(path.join(f.batch2Dir, row.slice("previousManifest: ".length)));
  }, /ENOENT/],
  ["corrupted existing history", f => {
    const row = fs.readFileSync(f.manifest, "utf8").split("\n").find(line => line.startsWith("previousManifest:"));
    fs.appendFileSync(path.join(f.batch2Dir, row.slice("previousManifest: ".length)), "corrupted");
  }, /BATCH2_DECLARED_HISTORY/],
]) test("malformed batch2 " + name + " fails before any child", t => {
  const f = fixture(t); mutate(f);
  assert.throws(f.invoke, error); assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
});

test("producer full-packet check rejects missing, duplicate and unrelated successful names", () => {
  assert.doesNotThrow(() => assertCompletePacket([...EXPECTED_FILES].reverse()));
  assert.throws(() => assertCompletePacket(EXPECTED_FILES.slice(1)), /BATCH2_INCOMPLETE_PACKET/);
  assert.throws(() => assertCompletePacket([...EXPECTED_FILES.slice(1), EXPECTED_FILES[1]]), /BATCH2_INCOMPLETE_PACKET/);
  assert.throws(() => assertCompletePacket([...EXPECTED_FILES.slice(1), "historical.png"]), /BATCH2_INCOMPLETE_PACKET/);
});

test("producer navigation requires an actual200 and the intended origin, route and query", () => {
  const target = "http://127.0.0.1:3538/terminal?symbol=NVDA";
  assert.doesNotThrow(() => assertCaptureNavigation(200, target, target));
  for (const [status, actual] of [
    [401, target], [404, target], [302, target],
    [200, "http://127.0.0.1:3538/login"], [200, "http://127.0.0.1:3538/terminal?symbol=SPY"],
    [200, "https://different.invalid/terminal?symbol=NVDA"],
  ]) assert.throws(() => assertCaptureNavigation(status, actual, target), /BATCH2_NAVIGATION/);
});

test("producer refuses a mounted dev indicator before screenshot without hiding its DOM", async () => {
  let shots = 0;
  const page = {
    viewportSize: () => ({ width: 390, height: 844 }), waitForTimeout: async () => {},
    locator: selector => { assert.equal(selector, "[data-nextjs-dev-tools-button]"); return { count: async () => 1 }; },
    evaluate: () => { throw new Error("must not remove the observed portal"); },
    screenshot: async () => { shots += 1; },
  };
  await assert.rejects(cropBox(page, { x: 10, y: 10, width: 300, height: 600 }, "unused.png", 8), /Next.js N overlay/);
  assert.equal(shots, 0);
});

test("producer observes the clean DOM before its deterministic crop and retains screenshot settings", async () => {
  const order = [];
  const page = {
    viewportSize: () => ({ width: 390, height: 844 }), waitForTimeout: async () => {},
    locator: () => ({ count: async () => { order.push("observed"); return 0; } }),
    screenshot: async options => {
      order.push("captured"); assert.equal(options.animations, "disabled");
      assert.equal(options.style, ".guide { visibility: visible }");
      assert.deepEqual(options.clip, { x: 2, y: 2, width: 316, height: 616 });
    },
  };
  await cropBox(page, { x: 10, y: 10, width: 300, height: 600 }, "unused.png", 8, ".guide { visibility: visible }");
  assert.deepEqual(order, ["observed", "captured"]);
});
