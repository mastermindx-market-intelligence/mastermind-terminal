"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { run, operationIds, recordCheckout, legacyPackets, superviseLegacy, stopLegacyServer, settleLegacyServer, captureOptions, batch2Plan, EOD_PACKET, EOD_PRODUCER, EOD_LAYOUT_FILES, EOD_CROPS, eodPacket, nativeDefinition, nativeSources, verifyNativeHistory, superviseNative } = require("./capture_ci_evidence.cjs");

const { LAYOUT_FILES, EXPECTED_FILES, assertCompletePacket, assertCaptureNavigation, cropBox } = require("./capture_pl6_batch2.cjs");
const batch2Relative = "terminal/docs/pr-crops/b-pl-6-batch-2";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
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

// Synthetic PNGs, sources and IPC boundaries exercise orchestration only.
// Production keeps the incumbent visualEvidence.imageInfo decoder and real Playwright.
function seedNative(repoRoot, change) {
  const definitions = ["eod", "gex"].map(nativeDefinition);
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
    if (change.nativeThrow) throw new Error("original native spawn exception");
    const child = new EventEmitter(); child.pid = 424240 + 2 * f.nativeCalls.length; child.unref = () => {};
    queueMicrotask(() => {
      const server = { captureId: options.env.TERMINAL_NATIVE_CAPTURE_ID, pid: child.pid + 1, pgid: child.pid + 1 };
      child.emit("message", { nativeCaptureServer: { ...server, phase: "started" } });
      let previous = null;
      try { previous = fs.readFileSync(path.join(directory, "EVIDENCE.yml")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const history = previous ? { file: `EVIDENCE.history-${hash(previous)}.yml`, sha256: hash(previous) } : null;
      if (history) fs.writeFileSync(path.join(directory, history.file), previous);
      const files = definition.files.map((file, index) => {
        const bytes = Buffer.from(`SYNTHETICPNG:new:${file}`);
        if (!(change.missingNativeImage && index === 0)) fs.writeFileSync(path.join(directory, file), bytes);
        return { file, sha256: hash(bytes) };
      });
      const sources = nativeSources(f.repoRoot, definition.producer.LAYOUT_FILES);
      let after = definition.producer.renderEvidence({ files: definition.files, layoutFiles: sources, capturedAtHead: "a".repeat(40), history });
      if (change.badNativeManifest) after += "files:\n  - duplicate.png\n";
      if (change.nativePartialManifest) after = after.replace("  - " + definition.files[0] + "\n", "");
      fs.writeFileSync(path.join(directory, "EVIDENCE.yml"), after);
      const receipt = { family, captureId: options.env.TERMINAL_NATIVE_CAPTURE_ID, capturedAtHead: "a".repeat(40),
        files, history, manifestSha256: hash(after) };
      if (change.nativeWrongFamily) receipt.family = "other";
      if (change.nativeWrongAttempt) receipt.captureId = "different-attempt";
      if (change.nativeWrongHead) receipt.capturedAtHead = "c".repeat(40);
      if (change.nativePartialReceipt) receipt.files = files.slice(1);
      if (change.nativeDuplicateMember) receipt.files[1] = receipt.files[0];
      if (change.nativeImageHash) receipt.files[0].sha256 = "0".repeat(64);
      if (change.nativeBadImage) fs.writeFileSync(path.join(directory, files[0].file), "not an image");
      if (change.nativeSourceDrift) fs.appendFileSync(path.join(f.repoRoot, definition.producer.LAYOUT_FILES[0]), "source moved");
      if (change.nativeControlDrift) fs.appendFileSync(path.join(f.repoRoot, definition.script), "control moved");
      if (family === "eod" && change.nativeDarkpoolFixtureDrift) fs.appendFileSync(path.join(f.repoRoot, "terminal/public/data/darkpool_fixture.json"), "fixture moved");
      if (change.nativeHistoryDrift) fs.appendFileSync(path.join(f.diagnostics, `${receipt.captureId}.prior-packet/EVIDENCE.yml`), "history moved");
      if (change.nativeHistoryCopyDrift && history) fs.appendFileSync(path.join(directory, history.file), "history moved");
      if (family === "eod" && change.nativeFirstMutatesSecondControl) fs.appendFileSync(path.join(f.repoRoot, f.nativeFixture.gex.definition.script), "changed peer control");
      if (family === "eod" && change.nativeFirstMutatesSecondSource) {
        const source = f.nativeFixture.gex.definition.producer.LAYOUT_FILES.find(file => !definition.producer.LAYOUT_FILES.includes(file));
        assert.ok(source); fs.appendFileSync(path.join(f.repoRoot, source), "changed peer source");
      }
      if (family === "eod" && change.nativeFirstMutatesSecondImage) fs.writeFileSync(path.join(f.nativeFixture.gex.directory, f.nativeFixture.gex.definition.files[0]), "SYNTHETICPNG:changed peer image");
      if (change.nativeReaderDrift) fs.appendFileSync(path.join(f.repoRoot, "terminal/e2e/tools/optionsExposureEvidence.cjs"), "changed reader");
      if (family === "gex" && change.nativeSecondMutatesFirstArchive) fs.appendFileSync(path.join(f.diagnostics, f.ids.prefix + "-eod.prior-packet/EVIDENCE.yml"), "changed first archive");
      if (family === "gex" && change.nativeSecondMutatesFirstHistory) {
        const historyFile = fs.readdirSync(f.nativeFixture.eod.directory).find(file => file.startsWith("EVIDENCE.history-"));
        assert.ok(historyFile); fs.appendFileSync(path.join(f.nativeFixture.eod.directory, historyFile), "changed first history");
      }
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
      if (change.nativeError) child.emit("error", change.nativeError);
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
  const diagnostics = path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
  const profile = { fixture: "terminal-e2e.v1", buildMode: "next-dev", sharedShell: "0", investorShellPreview: "0", theme: "dark" };
  const requirements = packet => Array.from({ length: packet === "pl6" ? 20 : 30 }, (_, n) => ({ packet, key: `${packet}:${n}` }));
  const evidence = {
    PACKETS: { pl6: "terminal/docs/pr-crops/b-pl-6-batch-1", vi: "terminal/docs/pr-crops/terminal-visual-intelligence" },
    readComposition(input) {
      assert.equal(input.compositionPath, `${evidence.PACKETS.pl6}/${ids.composition}.composition.json`);
      assert.deepEqual(input.expectedProfile, profile);
      if (change.nativeCompositionReferencedBytes) throw new Error("CI_EVIDENCE_REFERENCED_BYTES_CHANGED");
      return { id: ids.composition, cases: Array(50).fill({}), operations: ["pl6", "vi"].map(packet => ({
        id: ids[packet], packet, cases: Array(packet === "pl6" ? 24 : 30).fill({}) })) };
    },
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
  let checkoutReads = 0;
  const checkout = () => ({ actualCheckout: { commit: change.nativeCheckoutDrift && nativeCalls.length > 0 && ++checkoutReads > 0 ? "c".repeat(40) : "a".repeat(40), tree: "b".repeat(40) },
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
      const completion = "capturedAtHead " + actualHead + "\nwrote " + (change.batch2Count ?? 24)
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
  const packets = legacyPackets();
  const write = (relative, text) => {
    const file = path.join(repoRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  };
  const sourceHash = file => hash(fs.readFileSync(path.join(repoRoot, file)));
  const packetManifest = (definition, stale = false) => [
    "# capturedAtHead: " + "a".repeat(40), "layoutFiles:",
    ...definition.sources.map((file, n) => `  ${file}: "${stale && n === 0 ? "0".repeat(64) : sourceHash(file)}"`),
    "files:", ...definition.files.map(file => "  - " + file), "",
  ].join("\n");
  const optionsDirectory = "terminal/docs/pr-crops/options-level-axis-labels";
  const optionsPath = path.join(repoRoot, optionsDirectory, "manifest.json");
  const optionsSources = ["components/ChartPanel.tsx", "lib/optionsLevels.ts", "lib/pricePaneSvgScope.ts", "lib/priceTagPlacement.ts"];
  const optionsFiles = ["desktop.png", "tablet.png", "mobile.png", "desktop-left-percentage.png", "desktop-compact.png"];
  for (const file of new Set([
    ...LAYOUT_FILES, ...["eod", "gex"].flatMap(family => {
      const definition = nativeDefinition(family);
      return [...definition.producer.LAYOUT_FILES, definition.script];
    }), "terminal/e2e/tools/capture_ci_evidence.cjs", "terminal/e2e/tools/optionsExposureEvidence.cjs",
    "terminal/public/data/darkpool_fixture.json",
    ...packets.flatMap(packet => [...packet.sources, ...packet.controls]),
    ...optionsSources.map(file => "terminal/" + file), "terminal/e2e/tools/capture_pl6_batch1.cjs", optionsDirectory + "/capture.mjs",
  ])) write(file, "synthetic source: " + file);
  const batch2Dir = path.join(repoRoot, batch2Relative), manifest = path.join(batch2Dir, "EVIDENCE.yml");
  fs.mkdirSync(batch2Dir, { recursive: true });
  for (const file of EXPECTED_FILES) fs.writeFileSync(path.join(batch2Dir, file), png);
  const seed = packetText(repoRoot, { legacy: true });
  const seedHistory = "history/before-deterministic-" + hash(seed) + ".yml";
  fs.mkdirSync(path.join(batch2Dir, "history"), { recursive: true });
  fs.writeFileSync(path.join(batch2Dir, seedHistory), seed);
  fs.writeFileSync(manifest, packetText(repoRoot, { legacy: change.batch2Legacy,
    historical: change.batch2Legacy ? null : seedHistory }));
  const priorManifest = fs.readFileSync(manifest);
  for (const definition of packets) {
    write(definition.directory + "/EVIDENCE.yml", packetManifest(definition, change.legacyStale === true || change.legacyStale === definition.packet));
    for (const file of definition.files) write(definition.directory + "/" + file, "old synthetic image " + file);
  }
  const writeOptions = (stale, sourceHead = "a".repeat(40)) => {
    const captures = optionsFiles.map(file => {
      write(optionsDirectory + "/" + file, (stale ? "old" : "new") + " synthetic options image " + file);
      return { screenshot: file, sha256: sourceHash(optionsDirectory + "/" + file) };
    });
    const manifest = { sourceHead, sourceFiles: Object.fromEntries(optionsSources.map((file, n) => [file, stale && n === 0 ? "0".repeat(64) : sourceHash("terminal/" + file)])), captures };
    write(optionsDirectory + "/manifest.json", JSON.stringify(manifest));
    return captures;
  };
  if (change.legacyChangedSource) fs.appendFileSync(path.join(repoRoot, change.legacyChangedSource), "changed capture input\n");
  writeOptions(Boolean(change.optionsStale));
  write(optionsDirectory + "/coverage-audit-summary.json", "unchanged historical audit");
  const nativeFixture = seedNative(repoRoot, change);
  const eodDirectory = nativeFixture.eod.directory, eodManifest = path.join(eodDirectory, "EVIDENCE.yml");
  const eodPrior = Buffer.from(nativeFixture.eod.prior);
  if (change.optionsChanged) fs.appendFileSync(path.join(repoRoot, "terminal/" + optionsSources[0]), "changed source\n");
  if (change.optionsScopeChanged) fs.appendFileSync(path.join(repoRoot, "terminal/lib/pricePaneSvgScope.ts"), "changed scope\n");
  if (change.eodChanged) fs.appendFileSync(path.join(repoRoot, EOD_LAYOUT_FILES[4]), "changed copy\n");
  evidence.imageInfo = bytes => {
    const text = bytes.toString(), pngHeader = Buffer.from("89504e470d0a1a0a", "hex");
    if (!text.startsWith("SYNTHETICPNG:") && !text.includes("synthetic image") &&
        !text.includes("synthetic options image") && !bytes.subarray(0, 8).equals(pngHeader))
      throw new Error("PNG_INVALID");
    return { sha256: hash(bytes), width: 10, height: 10 };
  };
  const legacyCalls = [];
  const spawnLegacy = (_command, args, options) => {
    const definition = packets.find(packet => packet.script === args[0]);
    legacyCalls.push(definition.packet);
    const child = new EventEmitter(); child.pid = 424242;
    queueMicrotask(() => {
      child.emit("message", { legacyCaptureServer: { captureId: options.env.TERMINAL_LEGACY_CAPTURE_ID, phase: "started", pid: 424243, pgid: 424243 } });
      write(definition.directory + "/EVIDENCE.yml", packetManifest(definition));
      for (const file of definition.files) write(definition.directory + "/" + file, "fresh synthetic image " + file);
      if (change.mutateLegacySource) write(definition.sources[0], "changed during capture");
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
      const captures = change.skipOptionsCapture ? JSON.parse(fs.readFileSync(optionsPath, "utf8")).captures : writeOptions(false, change.optionsHead);
      if (change.mutateOptionsAudit) write(optionsDirectory + "/coverage-audit-summary.json", "changed audit");
      const receipt = { captureId: options.env.TERMINAL_CI_OPTIONS_CAPTURE_ID, capturedAtHead: "a".repeat(40),
        manifestSha256: sourceHash(optionsDirectory + "/manifest.json"),
        files: captures.map(capture => ({ file: capture.screenshot, sha256: capture.sha256 })) };
      if (change.partialOptions) receipt.files.pop();
      if (!change.missingOptionsReceipt) fs.writeSync(options.stdio[1], JSON.stringify({ optionsEvidence: receipt }) + "\n");
    }
    return result;
  };
  const spawnNative = nativeSpawn({ repoRoot, env, ids, nativeCalls, nativeFixture, diagnostics }, change);
  const invoke = () => run({ repoRoot, env, evidence, checkout, spawn: combinedSpawn, spawnLegacy, spawnNative });
  const diagnostic = () => JSON.parse(fs.readFileSync(path.join(diagnostics, `${ids.prefix}.json`)));
  const selected = () => fs.existsSync(env.GITHUB_ENV) ? fs.readFileSync(env.GITHUB_ENV, "utf8") : "";
  return { repoRoot, env, ids, calls, legacyCalls, packets, inputs, checkout, invoke, diagnostic, selected, diagnostics, optionsPath, batch2Dir, manifest, priorManifest,
    eodDirectory, eodManifest, eodPrior, nativeCalls, nativeFixture };
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
  assert.equal(f.calls[0].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "0");
  assert.equal(r.optionsAxis.state, "EXISTING_PACKET_AWAITING_UNIT_VALIDATION");
  assert.equal(f.inputs[0].selections.filter(s => s.operationId === f.ids.pl6).length, 20);
  assert.equal(f.inputs[0].selections.filter(s => s.operationId === f.ids.vi).length, 30);
  assert.ok(f.inputs[0].operations.every(r => r.sha256 === "f".repeat(64)));
  assert.equal(f.selected(), `TERMINAL_EVIDENCE_MODE=records\nTERMINAL_EVIDENCE_COMPOSITION=${r.composition.path}\n`);
  assert.match(r.composition.sha256, /^[0-9a-f]{64}$/);
});

test("changed Options source opts only PL6 into one capture and retains actual checkout identity", async t => {
  const f = fixture(t, { optionsChanged: true });
  f.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE = "1"; // The caller may not leak this into VI.
  const r = await f.invoke();
  assert.deepEqual(f.calls.map(c => c.options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE), ["1", "0"]);
  assert.notEqual(r.optionsAxis.prior.files["manifest.json"].sha256, r.optionsAxis.returned.files["manifest.json"].sha256);
  assert.equal(r.optionsAxis.sources["terminal/components/ChartPanel.tsx"], createHash("sha256").update(fs.readFileSync(path.join(f.repoRoot, "terminal/components/ChartPanel.tsx"))).digest("hex"));
  assert.equal(r.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.equal(r.optionsAxis.receipt.capturedAtHead, r.actualCheckout.commit);
  assert.notEqual(r.optionsAxis.receipt.capturedAtHead, r.githubEvent.pullRequestHead);
  assert.equal(r.optionsAxis.manifestSha256, createHash("sha256").update(fs.readFileSync(f.optionsPath)).digest("hex"));
  assert.equal(r.composition.selectedCases, 50);
});

test("helper-only Options source drift requests the existing five-case capture", async t => {
  const f = fixture(t, { optionsScopeChanged: true });
  const r = await f.invoke();
  assert.deepEqual(f.calls.map(c => c.options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE), ["1", "0"]);
  const prior = JSON.parse(fs.readFileSync(path.join(r.optionsAxis.prior.path, "manifest.json"), "utf8"));
  const changed = Object.keys(prior.sourceFiles).filter(file => prior.sourceFiles[file] !== r.optionsAxis.sources[`terminal/${file}`]);
  assert.deepEqual(changed, ["lib/pricePaneSvgScope.ts"]);
  assert.equal(r.optionsAxis.images.length, 5);
  assert.equal(r.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.equal(r.optionsAxis.receipt.capturedAtHead, r.actualCheckout.commit);
  assert.equal(r.composition.selectedCases, 50);
});

for (const change of [{ skipOptionsCapture: true }, { optionsHead: "e".repeat(40) }])
test("stale or event-head Options receipt cannot select a successful capture", async t => {
  const f = fixture(t, { optionsChanged: true, ...change });
  await assert.rejects(f.invoke, /CI_OPTIONS_CHECKOUT_BINDING/);
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
  assert.deepEqual(calls[0][2], { cwd: "/fixture/terminal", env: { SHARED_SHELL: "1", BASE_URL: "http://127.0.0.1:3536" }, stdio: "inherit", detached: true });
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
  if (outcome === "error") { child.emit("error", new Error("original spawn error")); child.emit("close", 1, null); }
  else child.emit("close", outcome === "nonzero" ? 1 : 0, outcome === "signal" ? "SIGTERM" : null);
  await rejected; assert.equal(calls, 1);
});

test("Options refuses an unowned or unready server before spawning", async () => {
  let calls = 0;
  await assert.rejects(captureOptions({ server: {}, ownedServer: () => false,
    spawn: () => { calls++; } }), /CI_OPTIONS_SERVER_NOT_READY/);
  assert.equal(calls, 0);
});

for (const code of ["EPERM", "EACCES"])
test(`Options preserves the original ${code} refusal after child closure`, async () => {
  const child = new EventEmitter();
  const error = Object.assign(new Error(`original Options ${code}`), { code });
  let calls = 0;
  const pending = captureOptions({ server: {}, ownedServer: () => true,
    baseURL: "http://127.0.0.1:3536", terminal: "/fixture/terminal", env: {},
    spawn: () => { calls++; return child; } });
  const rejected = assert.rejects(pending, value => value === error && value.code === code);
  child.emit("error", error);
  child.emit("close", 1, null);
  await rejected;
  assert.equal(calls, 1);
});

test("PL6 invokes Options only after its captures succeed and before its own server cleanup", () => {
  const source = fs.readFileSync(path.join(__dirname, "capture_pl6_batch1.cjs"), "utf8");
  assert.match(source, /captureOptionsAxis && \(!operation \|\| ONLY\.length\)/);
  assert.match(source, /if \(captureOptionsAxis && failed === 0\)/);
  assert.equal((source.match(/await captureOptions\(/g) || []).length, 1);
  const close = source.indexOf("await browser.close();");
  const capture = source.indexOf("await captureOptions(");
  const stop = source.indexOf("await settleLegacyServer(child);", capture);
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

test("stale Pine and batch3 packets run all50 cases and preserve complete prior bytes", async t => {
  const f = fixture(t, { legacyStale: true }), result = await f.invoke();
  assert.deepEqual(f.legacyCalls, ["pine", "batch3"]);
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
  assert.equal(cases, 50);
});

test("batch3-only source drift recaptures all20 files while Pine is reused", async t => {
  const f = fixture(t, { legacyStale: "batch3" }), result = await f.invoke();
  assert.deepEqual(f.legacyCalls, ["batch3"]);
  assert.equal(result.legacyPackets.batch3.images.length, 20);
  assert.equal(result.legacyPackets.pine.state, "EXISTING_PACKET_AWAITING_UNIT_VALIDATION");
});

for (const source of ["terminal/e2e/tools/capture_pl6_batch3.cjs",
  "terminal/e2e/fixtures/heatmap-price-only-tile.json"]) {
  test("batch3 capture input drift requires fresh20: " + source, async t => {
    const f = fixture(t, { legacyChangedSource: source }), result = await f.invoke();
    assert.deepEqual(f.legacyCalls, ["batch3"]);
    assert.equal(result.legacyPackets.batch3.images.length, 20);
    assert.equal(result.legacyPackets.pine.state, "EXISTING_PACKET_AWAITING_UNIT_VALIDATION");
  });
}

test("current packets preserve their old capture identity and do not launch replacement captures", async t => {
  const f = fixture(t), result = await f.invoke();
  assert.deepEqual(f.legacyCalls, []);
  assert.ok(Object.values(result.legacyPackets).every(packet => packet.state === "EXISTING_PACKET_AWAITING_UNIT_VALIDATION"));
  assert.equal(result.optionsAxis.required, false);
  assert.equal(f.calls[0].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "0");
});

for (const packetName of ["pine", "batch3"]) for (const [name, change, expected] of [
  ["nonzero producer", { legacyStatus: 1 }, /CHILD_FAILED_OR_UNSETTLED/],
  ["missing current receipt", { missingLegacyReceipt: true }, /RECEIPT_COUNT/],
  ["partial fresh inventory", { partialLegacy: true }, /RECEIPT_BINDING/],
  ["different attempt", { wrongAttempt: true }, /RECEIPT_BINDING/],
  ["changed image bytes", { imageMismatch: true }, /IMAGE_BINDING/],
  ["source changed during capture", { mutateLegacySource: true }, /SOURCE_CHANGED/],
]) test(packetName + ": " + name + " keeps diagnostics and refuses selector export", async t => {
  const f = fixture(t, { legacyStale: packetName, ...change });
  await assert.rejects(f.invoke, expected);
  assert.equal(f.selected(), ""); assert.equal(f.diagnostic().state, "FAILED");
  const packet = f.diagnostic().legacyPackets[f.legacyCalls.at(-1)];
  assert.ok(fs.existsSync(packet.prior.path));
  assert.ok(fs.existsSync(packet.returned.path));
  assert.notEqual(packet.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.deepEqual(f.legacyCalls, [packetName]);
});

test("Options uses the full PL6 owner, records five fresh images, and preserves its historical audit", async t => {
  const f = fixture(t, { optionsStale: true }), result = await f.invoke();
  assert.equal(f.calls[0].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "1");
  assert.equal(f.calls[1].options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE, "0");
  assert.equal(result.optionsAxis.images.length, 5);
  assert.equal(result.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.deepEqual(result.optionsAxis.prior.files["coverage-audit-summary.json"], result.optionsAxis.returned.files["coverage-audit-summary.json"]);
  assert.equal(Object.keys(result.optionsAxis.sources).length, 4);
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

function serverReport(child, phase, captureId = 'synthetic-attempt', protocol = 'legacy') {
  const field = protocol === 'native' ? 'nativeCaptureServer' : 'legacyCaptureServer';
  child.emit('message', { [field]: { captureId, phase, pid: 424243, pgid: 424243 } });
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

test("current full deterministic batch2 packet is left for native validation without a duplicate capture", async t => {
  const f = fixture(t), before = fs.readFileSync(f.manifest), r = await f.invoke();
  assert.equal(r.batch2.state, "EXISTING_PACKET_AWAITING_NATIVE_VALIDATION");
  assert.equal(r.batch2.required, false); assert.equal(f.calls.length, 2);
  assert.deepEqual(fs.readFileSync(f.manifest), before);
});

test("legacy receipt forces the incumbent full24 capture and preserves exact prior history before selecting50", async t => {
  const f = fixture(t, { batch2Legacy: true }), r = await f.invoke();
  assert.equal(r.state, "SELECTED");
  assert.equal(r.batch2.state, "CAPTURED_AWAITING_NATIVE_VALIDATION");
  assert.equal(r.batch2.actualCheckout, "a".repeat(40));
  assert.deepEqual(f.calls[2].args, ["e2e/tools/capture_pl6_batch2.cjs"]);
  assert.equal(f.calls[2].options.env.CAPTURE_ONLY, "");
  assert.equal(f.calls[2].options.env.TERMINAL_CROP_PORT, "3538");
  assert.equal(f.calls[2].options.timeout, 20 * 60_000);
  assert.equal(f.calls[2].options.killSignal, "SIGTERM");
  assert.equal(Object.keys(r.batch2.imageHashes).length, 24);
  assert.deepEqual(fs.readFileSync(r.batch2.historicalDiagnostic), f.priorManifest);
  assert.deepEqual(fs.readFileSync(path.join(f.batch2Dir, r.batch2.historicalManifest)), f.priorManifest);
  assert.equal(f.inputs[0].operations.length, 2);
  assert.equal(f.inputs[0].selections.length, 50);
  assert.deepEqual(r.references.map(ref => ref.path), [
    f.inputs[0].operations[0].path, f.inputs[0].operations[1].path,
  ]);
});

test("current-source drift requires real recapture without approximating the legacy lex projection", async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.repoRoot, "terminal/lib/i18n.tsx"), "\nnew source");
  const plan = batch2Plan(f.repoRoot);
  assert.equal(plan.required, true); assert.ok(plan.reasons.includes("source-bytes-changed"));
  const r = await f.invoke();
  assert.equal(r.batch2.state, "CAPTURED_AWAITING_NATIVE_VALIDATION");
});

test("combined Options and Batch2 refresh keeps the standalone24 packet outside the two-operation composition", async t => {
  const f = fixture(t, { optionsChanged: true, batch2Legacy: true }), r = await f.invoke();
  assert.deepEqual(f.calls.map(c => c.options.env.TERMINAL_CI_OPTIONS_AXIS_CAPTURE), ["1", "0", "0"]);
  assert.equal(r.optionsAxis.state, "CAPTURED_AWAITING_UNIT_VALIDATION");
  assert.equal(r.batch2.state, "CAPTURED_AWAITING_NATIVE_VALIDATION");
  assert.equal(Object.keys(r.batch2.imageHashes).length, 24);
  assert.equal(f.inputs[0].operations.length, 2);
  assert.equal(f.inputs[0].selections.length, 50);
});

test("a historical sixteen-case active manifest cannot replace the current tablet-inclusive packet", async t => {
  const f = fixture(t);
  const text = fs.readFileSync(f.manifest, "utf8");
  fs.writeFileSync(f.manifest, text.replace(/^  - [A-Za-z0-9-]+-820(?:-zh)?\.png\n/gm, ""));
  await assert.rejects(f.invoke, /CI_BATCH2_MANIFEST_FILES/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.selected(), "");
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
]) test("batch2 " + name + " preserves failure, logs and history without selecting a composition", async t => {
  const f = fixture(t, { batch2Legacy: true, ...change });
  await assert.rejects(f.invoke, error); assert.equal(f.selected(), "");
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
]) test("malformed batch2 " + name + " fails before any child", async t => {
  const f = fixture(t); mutate(f);
  await assert.rejects(f.invoke, error); assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
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

test("changed EOD source uses the complete native supervisor and preserves both composition operations", async t => {
  const f = fixture(t, { eodChanged: true });
  Object.assign(f.env, { UPDATE_HEATMAP_EVIDENCE: "1", TERMINAL_CROP_OUTPUT_DIR: "/unrelated",
    CAPTURE_HEAD: "e".repeat(40), TERMINAL_CROP_PORT: "9999" });
  const r = await f.invoke(), child = f.nativeCalls[0];
  assert.equal(f.calls.length, 2); assert.equal(f.nativeCalls.length, 1);
  assert.deepEqual(child.args, ["e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs"]);
  assert.equal(child.options.detached, true); assert.equal(child.options.stdio[3], "ipc");
  for (const key of ["CAPTURE_ONLY", "UPDATE_HEATMAP_EVIDENCE", "TERMINAL_CROP_OUTPUT_DIR", "CAPTURE_HEAD"])
    assert.equal(child.options.env[key], "");
  assert.equal(child.options.env.TERMINAL_CROP_PORT, "3566");
  assert.equal(child.options.env.TERMINAL_NATIVE_CAPTURE_ID, f.ids.prefix + "-eod");
  assert.equal(r.native.eod.state, "QUALIFIED");
  assert.equal(r.native.eod.images.length, 126);
  assert.deepEqual(fs.readFileSync(path.join(r.native.eod.history.archiveRoot, "EVIDENCE.yml")), f.eodPrior);
  assert.equal(r.native.eod.priorManifestSha256, hash(f.eodPrior));
  assert.equal(r.native.eod.manifestSha256, hash(fs.readFileSync(f.eodManifest)));
  assert.equal(f.inputs[0].operations.length, 2); assert.equal(r.composition.selectedCases, 50);
  assert.ok(f.selected());
});

test("matching EOD layout does not invent a new capture receipt", async t => {
  const f = fixture(t), r = await f.invoke();
  assert.equal(f.calls.length, 2); assert.equal(f.nativeCalls.length, 0);
  assert.equal(r.native.eod.state, "CURRENT"); assert.equal(r.native.eod.images.length, 126);
  assert.equal(r.native.eod.history, undefined);
});

for (const [name, change, error] of [
  ["partial manifest with historical images", { nativePartialManifest: true }, /FILES_MEMBERSHIP/],
  ["timed out child", { nativeError: Object.assign(new Error("original timeout"), { code: "ETIMEDOUT" }) }, /CHILD_FAILED_OR_UNSETTLED/],
  ["spawn exception", { nativeThrow: true }, /CHILD_FAILED_OR_UNSETTLED/],
]) test("EOD " + name + " fails once after composition and before selection", async t => {
  const f = fixture(t, { eodChanged: true, ...change });
  await assert.rejects(f.invoke, error);
  assert.equal(f.calls.length, 2); assert.equal(f.nativeCalls.length, 1);
  assert.equal(f.inputs.length, 1); assert.equal(f.selected(), "");
  assert.equal(f.diagnostic().state, "FAILED");
});

for (const malformed of ["missing", "duplicate", "unrelated", "missing-source"]) test("EOD malformed " + malformed + " manifest cannot authorize planner reuse", async t => {
  const f = fixture(t, { eodChanged: true });
  let text = fs.readFileSync(f.eodManifest, "utf8");
  if (malformed === "missing") text = text.replace("layoutFiles:", "oldLayoutFiles:");
  if (malformed === "duplicate") { const row = text.split("\n").find(row => row.startsWith("  terminal/")); text = text.replace(row, row + "\n" + row); }
  if (malformed === "unrelated") text = text.replace(EOD_LAYOUT_FILES[0], "../outside");
  if (malformed === "missing-source") text = text.split("\n").filter(row => !row.startsWith("  " + EOD_LAYOUT_FILES[0] + ":")).join("\n");
  fs.writeFileSync(f.eodManifest, text);
  assert.throws(() => eodPacket(f.repoRoot), /CI_EOD_MANIFEST/);
  assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
});

test("missing current EOD source fails before capture", async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.repoRoot, EOD_LAYOUT_FILES[0]));
  await assert.rejects(f.invoke, /ENOENT/);
  assert.equal(f.calls.length, 0); assert.equal(f.selected(), "");
});

for (const [change, error] of [
  [{ nativeFirstMutatesSecondControl: true }, /SOURCE_CHANGED/],
  [{ nativeFirstMutatesSecondSource: true }, /SOURCE_CHANGED/],
  [{ nativeFirstMutatesSecondImage: true }, /PACKET_CHANGED/],
  [{ nativeReaderDrift: true }, /SOURCE_CHANGED/],
]) test("the first native producer cannot redefine its peer or reader: " + JSON.stringify(change), async t => {
  const f = fixture(t, { nativeStale: ["eod"], ...change });
  await assert.rejects(f.invoke, error); assert.equal(f.nativeCalls.length, 1); assert.equal(f.selected(), "");
});

function nativeServerReport(child, phase, captureId = "synthetic-attempt") {
  serverReport(child, phase, captureId, "native");
}

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
  ["changed darkpool fixture", { nativeDarkpoolFixtureDrift: true }, /SOURCE_CHANGED/],
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
  [{ nativeSecondMutatesFirstImage: true }, /PACKET_CHANGED/],
  [{ nativeSecondMutatesFirstArchive: true }, /HISTORY_CHANGED/],
  [{ nativeSecondMutatesFirstHistory: true }, /PACKET_CHANGED|HISTORY_BINDING/],
  [{ nativeSecondMutatesComposition: true }, /COMPOSITION_BYTES/],
  [{ nativeCompositionReferencedBytes: true }, /REFERENCED_BYTES_CHANGED/],
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
test("Native supervisor observes close, not merely a process exit", async () => {
  const child = supervisorChild(); let closed = false;
  const pending = superviseNative("node", [], {}, { spawn: () => child, deadlineMs: 1000 });
  pending.then(() => { closed = true; });
  child.emit("exit", 0, null); await Promise.resolve(); assert.equal(closed, false);
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.status, 0); assert.equal(result.timedOut, false);
});

test("native: a late exit-zero after the capture deadline remains a timeout failure", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseNative("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (pid, signal) => { assert.equal(pid, -424242); signals.push(signal); queueMicrotask(() => child.emit("close", 0, null)); },
  });
  assert.equal(result.status, 0); assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("native: a child that never closes is bounded and remains unsettled after hard termination", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseNative("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5, kill: (_pid, signal) => signals.push(signal),
  });
  assert.equal(result.closed, false); assert.equal(result.timedOut, true); assert.equal(child.unrefCount, 1);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  child.emit("close", 0, null); assert.equal(result.closed, false);
});

test("native: supervisor permission refusal stops termination attempts", async () => {
  const child = supervisorChild(), signals = [];
  const result = await superviseNative("node", [], {}, {
    spawn: () => child, deadlineMs: 5, graceMs: 5, killMs: 5,
    kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  });
  assert.equal(result.closed, false); assert.equal(result.error.code, "EPERM");
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("native: supervisor retains spawn error and waits for its close event", async () => {
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
test('native: normal producer completion binds its stopped server to this attempt without another termination', async () => {
  const child = supervisorChild();
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No second cleanup after a proven stop'); },
  });
  nativeServerReport(child, 'started'); nativeServerReport(child, 'stopped'); child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, 424243);
  assert.equal(result.serverReportedStopped, true); assert.equal(result.serverSettled, true);
});

for (const survives of [false, true]) test(`native: hard producer termination reconciles its distinct server group, survives=${survives}`, async () => {
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
  nativeServerReport(child, 'started');
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.equal(result.serverReportedStopped, false); assert.equal(result.serverSettled, !survives);
  assert.deepEqual(signals, [[-424242, 'SIGTERM'], [-424242, 'SIGKILL'], [-424243, 'SIGTERM'], [-424243, 'SIGKILL']]);
});

test('native: a producer close without an original server identity remains unsettled', async () => {
  const child = supervisorChild();
  const pending = superviseNative('node', [], {}, { spawn: () => child, deadlineMs: 1000,
    kill: () => { throw new Error('No guessed server group'); } });
  child.emit('close', 0, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('native: a server identity from another capture attempt is refused without signalling it', async () => {
  const child = supervisorChild();
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000, kill: () => { throw new Error('No unrelated server group'); },
  });
  nativeServerReport(child, 'started', 'another-attempt'); child.emit('close', 0, null);
  const result = await pending;
  assert.match(result.error.message, /SERVER_REPORT/); assert.equal(result.serverPid, null); assert.equal(result.serverSettled, false);
});

test('native: server permission refusal leaves reconciliation unresolved and sends no termination signal', async () => {
  const child = supervisorChild(), signals = [];
  const pending = superviseNative('node', [], { env: { TERMINAL_NATIVE_CAPTURE_ID: 'synthetic-attempt' } }, {
    spawn: () => child, deadlineMs: 1000,
    kill: (pid, signal) => { signals.push([pid, signal]); throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
  });
  nativeServerReport(child, 'started'); child.emit('close', 1, null);
  const result = await pending;
  assert.equal(result.closed, true); assert.equal(result.serverSettled, false); assert.equal(result.error.code, 'EPERM');
  assert.deepEqual(signals, [[-424243, 0]]);
});

test("the complete EOD packet retains21 states at three widths in both languages", () => {
  const producer = require("./capture_eod_heatmap_flowdesk_load_failure.cjs");
  assert.equal(Object.keys(producer.STATES).length, 21);
  assert.equal(producer.expectedFiles().length, 126);
  assert.equal(new Set(producer.expectedFiles()).size, 126);
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
    for (const width of [1440, 820, 390]) for (const lang of ["en", "zh"]) {
      const row = producer.harnessRow(producer.cropName(state, width, lang));
      assert.ok(row.includes(`url: "${url.pathname}${url.search}"`), "receipt route must match actual navigation");
    }
    if (state.startsWith("eod-darkpool-")) assert.equal(url.searchParams.get("symbol"), "NVDA");
    else if (state.startsWith("eod-structure-")) assert.equal(url.href, "http://capture.invalid/options?tab=gex");
  }
});

// Controlled IndexedDB event ports execute the actual serialized capture callback.
// They prove observer ownership and transaction settlement, not real browser storage.
function persistencePort(options = {}) {
  const probe = require("./capture_eod_heatmap_flowdesk_load_failure.cjs").persistedFlowAccess;
  const state = { opens: 0, reads: 0, puts: 0, closes: 0, aborts: 0, upgradesAborted: 0, schemaCreated: false,
    record: options.record === false ? undefined : { url: "/data/flow_idx.json", data: { unchanged: [1, 2] }, ts: 12345 } };
  const timers = new Map(); let nextTimer = 0;
  const db = {
    objectStoreNames: { contains: () => !options.emptyStore },
    close() { state.closes++; },
    transaction(_store, mode) {
      if (options.transactionThrows) throw Object.assign(new Error("transaction failed"), { name: "InvalidStateError" });
      const tx = { aborted: false, pending: null,
        abort() {
          state.aborts++;
          if (options.abortThrows) throw Object.assign(new Error("already settled"), { name: "InvalidStateError" });
          tx.aborted = true; tx.pending = null;
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore() {
          return {
            get() {
              state.reads++;
              const get = { result: state.record && structuredClone(state.record) };
              state.get = get;
              const deliver = () => {
                if (options.readError) { get.error = { name: "UnknownError" }; get.onerror?.(); return; }
                if (options.readAbort) { tx.abort(); return; }
                get.onsuccess?.();
                if (!options.holdComplete) queueMicrotask(() => {
                  if (tx.aborted) return;
                  if (options.abortBeforeCommit) { tx.abort(); return; }
                  if (tx.pending) state.record = structuredClone(tx.pending);
                  tx.oncomplete?.();
                });
              };
              state.deliverRead = deliver;
              if (!options.holdRead) queueMicrotask(deliver);
              return get;
            },
            put(record) {
              assert.equal(mode, "readwrite");
              state.puts++; tx.pending = structuredClone(record);
              const put = {};
              if (options.writeError) queueMicrotask(() => { put.error = { name: "QuotaExceededError" }; put.onerror?.(); });
              return put;
            },
          };
        },
      };
      state.tx = tx;
      return tx;
    },
  };
  const indexedDB = {
    databases() {
      if (options.enumerationError) return Promise.reject(Object.assign(new Error("blocked"), { name: "SecurityError" }));
      if (options.holdEnumeration) return new Promise(resolve => { state.resolveEnumeration = resolve; });
      return Promise.resolve(options.absent ? [] : [{ name: "mm-data-cache", version: 1 }]);
    },
    open() {
      state.opens++;
      const open = { result: db };
      state.open = open;
      if (options.upgrade) {
        let aborted = false;
        open.transaction = { abort() { aborted = true; state.upgradesAborted++; } };
        state.deliverUpgrade = () => {
          open.onupgradeneeded?.();
          state.schemaCreated = !aborted;
        };
        if (!options.holdOpen) queueMicrotask(state.deliverUpgrade);
      } else if (options.blocked) queueMicrotask(() => open.onblocked?.());
      else if (options.openError) queueMicrotask(() => { open.error = { name: "UnknownError" }; open.onerror?.(); });
      else if (!options.holdOpen) queueMicrotask(() => open.onsuccess?.());
      return open;
    },
  };
  if (options.unsupported) delete indexedDB.databases;
  const actual = require("node:vm").runInNewContext(`(${probe.toString()})`, {
    indexedDB, Date: { now: () => 1_000_000 },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { state, db, flush: () => new Promise(resolve => setImmediate(resolve)),
    expire() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    run(input = {}) { return actual({ url: "/data/flow_idx.json", ...input }).then(result => JSON.parse(JSON.stringify(result))); },
  };
}

test("EOD persistence observation leaves an absent database absent", async () => {
  const port = persistencePort({ absent: true });
  assert.equal((await port.run()).status, "missing-database");
  assert.equal(port.state.opens, 0); assert.equal(port.state.schemaCreated, false); assert.equal(port.state.puts, 0);
});

for (const [options, status] of [[{ unsupported: true }, "inspection-unavailable"], [{ enumerationError: true }, "inspection-failed"]]) {
  test("EOD persistence " + status + " is distinct from an absent record", async () => {
    const port = persistencePort(options);
    assert.equal((await port.run()).status, status); assert.equal(port.state.opens, 0);
  });
}

test("EOD persistence observation does not heal an empty existing database", async () => {
  const port = persistencePort({ emptyStore: true });
  assert.equal((await port.run()).status, "missing-store");
  assert.equal(port.state.closes, 1); assert.equal(port.state.reads, 0); assert.equal(port.state.schemaCreated, false);
});

test("EOD persistence observation reads an existing record without changing it", async () => {
  const port = persistencePort(), before = structuredClone(port.state.record);
  assert.deepEqual(await port.run(), { status: "ready", ts: 12345, stage: "read" });
  assert.deepEqual(port.state.record, before); assert.equal(port.state.puts, 0); assert.equal(port.state.closes, 1);
});

test("EOD persistence existence race aborts a new database upgrade", async () => {
  const port = persistencePort({ upgrade: true });
  assert.equal((await port.run()).status, "database-replaced");
  assert.equal(port.state.upgradesAborted, 1); assert.equal(port.state.schemaCreated, false); assert.equal(port.state.reads, 0);
});

test("EOD persistence late upgrade after timeout is aborted and its handle closes", async () => {
  const port = persistencePort({ upgrade: true, holdOpen: true }), pending = port.run();
  await port.flush(); port.expire();
  assert.equal((await pending).status, "probe-timeout");
  port.state.deliverUpgrade();
  assert.equal(port.state.upgradesAborted, 1); assert.equal(port.state.schemaCreated, false);
  assert.equal(port.state.closes, 1); assert.equal(port.state.reads, 0);
});

for (const [options, status] of [
  [{ blocked: true }, "open-blocked"], [{ openError: true }, "open-failed"],
  [{ readError: true }, "read-failed"], [{ transactionThrows: true }, "transaction-failed"],
  [{ readAbort: true }, "transaction-aborted"],
]) {
  test("EOD persistence reports " + status + " and never writes", async () => {
    const port = persistencePort(options);
    assert.equal((await port.run()).status, status); assert.equal(port.state.puts, 0);
    if (!options.blocked && !options.openError) assert.equal(port.state.closes, 1);
  });
}

test("EOD persistence no-event open is bounded and a late success only closes", async () => {
  const port = persistencePort({ holdOpen: true }), pending = port.run();
  await port.flush(); port.expire();
  assert.equal((await pending).status, "probe-timeout");
  port.state.open.onsuccess();
  assert.equal(port.state.closes, 1); assert.equal(port.state.reads, 0); assert.equal(port.state.puts, 0);
});

test("EOD persistence late enumeration cannot start an open after timeout", async () => {
  const port = persistencePort({ holdEnumeration: true }), pending = port.run();
  await port.flush(); port.expire();
  assert.equal((await pending).status, "probe-timeout");
  port.state.resolveEnumeration([{ name: "mm-data-cache" }]); await port.flush();
  assert.equal(port.state.opens, 0);
});

test("EOD aging changes only the timestamp and succeeds only on commit", async () => {
  const port = persistencePort(), before = structuredClone(port.state.record);
  assert.deepEqual(await port.run({ ageMs: 6000 }), { status: "ready", ts: 994000, aged: true, stage: "age" });
  assert.deepEqual(port.state.record, { ...before, ts: 994000 }); assert.equal(port.state.puts, 1); assert.equal(port.state.closes, 1);
});

test("EOD aging never manufactures a missing record", async () => {
  const port = persistencePort({ record: false });
  assert.equal((await port.run({ ageMs: 6000 })).status, "missing-record");
  assert.equal(port.state.record, undefined); assert.equal(port.state.puts, 0);
});

for (const [options, status] of [[{ abortBeforeCommit: true }, "transaction-aborted"], [{ writeError: true }, "write-failed"]]) {
  test("EOD aging " + status + " does not certify or commit a timestamp", async () => {
    const port = persistencePort(options), before = structuredClone(port.state.record);
    assert.equal((await port.run({ ageMs: 6000 })).status, status); assert.deepEqual(port.state.record, before);
  });
}

test("EOD aging timeout aborts and a late read cannot issue a write", async () => {
  const port = persistencePort({ holdRead: true }), before = structuredClone(port.state.record), pending = port.run({ ageMs: 6000 });
  await port.flush(); port.expire();
  assert.equal((await pending).status, "probe-timeout");
  port.state.deliverRead(); await port.flush();
  assert.equal(port.state.puts, 0); assert.deepEqual(port.state.record, before); assert.equal(port.state.aborts, 1);
});

test("EOD aging timeout aborts a queued write before any success receipt", async () => {
  const port = persistencePort({ holdComplete: true }), before = structuredClone(port.state.record), pending = port.run({ ageMs: 6000 });
  await port.flush(); assert.equal(port.state.puts, 1); port.expire();
  assert.equal((await pending).status, "probe-timeout");
  assert.deepEqual(port.state.record, before); assert.equal(port.state.tx.pending, null); assert.equal(port.state.aborts, 1);
});

test("EOD aging cannot claim failed-write absence when abort settlement is unproven", async () => {
  const port = persistencePort({ holdComplete: true, abortThrows: true }), pending = port.run({ ageMs: 6000 });
  await port.flush(); port.expire();
  const result = await pending;
  assert.equal(result.status, "write-settlement-unproven"); assert.equal(result.cause, "probe-timeout");
});

test("EOD persistence version change releases its connection and aborts pending work", async () => {
  const port = persistencePort({ holdRead: true }), pending = port.run();
  await port.flush(); port.db.onversionchange();
  assert.equal((await pending).status, "version-changed");
  assert.equal(port.state.aborts, 1); assert.equal(port.state.closes, 1); assert.equal(port.state.puts, 0);
});

require("./optionsExposureEvidence.cases.cjs");
