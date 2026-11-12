"use strict";
// PR895 raw export only. No current-evidence selector or active packet is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const owner = require("./capture_ci_evidence.cjs");
const api = require("./optionsExposureEvidence.cjs");
const visual = require("./visualEvidence.cjs");
const REPO = path.resolve(__dirname, "../../..");
const FIXTURE = "terminal/public/data/darkpool_fixture.json";
const GEX = "terminal/docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-source-compatibility-20261105/revisions/expiry-greeks-integration-20261110";
const GEX_PIN = "6432faf8713536aaa14319bb310289b26a68cfa5dd923801d2f4a7b7bf1fc453";
const R5 = "terminal/docs/verification/exposure-workspace-20261103/r5-alignment-20261110";
const R5_PIN = "0da98d3fa6a70e752421d2156552a41cf68e6be22bf86ec932f5833a71fe5193";
const ROOTS = Object.fromEntries(["eod", "gex"].map(kind => [kind, owner.nativeDefinition(kind).directory + "/EVIDENCE.yml"]));
const sum = bytes => createHash("sha256").update(bytes).digest("hex");
const sameNames = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const put = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
function bytes(root, relative) {
  assert.ok(relative && !path.isAbsolute(relative));
  const parts = relative.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    assert.ok(parts[i] && ![".", ".."].includes(parts[i]) && !parts[i].includes("\\"));
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    assert.ok(!stat.isSymbolicLink() && (i === parts.length - 1 ? stat.isFile() : stat.isDirectory()));
    assert.ok(i !== parts.length - 1 || stat.size <= 24 * 1024 * 1024);
  }
  return fs.readFileSync(current);
}
function inputSets() {
  const addFixture = paths => [...new Set([...paths, FIXTURE])].sort();
  const result = { eod: addFixture(api.optionsIntegrationInputs("eod")), gex: api.optionsIntegrationInputs("gex"),
    browser: addFixture(api.momentumBrowserInputs()), expiry: addFixture(api.momentumExpiryInputs()) };
  for (const [name, count] of Object.entries({ eod: 33, gex: 29, browser: 73, expiry: 78 })) {
    assert.equal(result[name].length, count, name); assert.equal(new Set(result[name]).size, count);
  }
  // The native manifest retains its layout-only contract. The full immutable
  // source snapshots bind the frozen data fixture before and after capture.
  for (const name of ["eod", "browser", "expiry"]) assert.ok(result[name].includes(FIXTURE));
  return result;
}
function requireClosedProcess(result) {
  assert.ok(result && result.closed === true && result.status === 0 && result.signal === null &&
    result.timedOut === false && !result.error, "Owned process did not complete successfully");
}
function requireNativeReceipt(receipt, context, captureId, expected, manifest, images, result) {
  requireClosedProcess(result);
  assert.ok(result.serverReportedStopped === true && result.serverSettled === true && result.serverRefused === null &&
    Number.isInteger(result.serverPid) && result.serverPid > 1, "Native server settlement unproved");
  assert.equal(receipt.family, "eod"); assert.equal(receipt.captureId, captureId);
  assert.equal(receipt.capturedAtHead, context.checkoutCommit);
  assert.equal(receipt.manifestSha256, manifest.sha256); assert.equal(manifest.head, context.checkoutCommit);
  sameNames(receipt.files.map(file => file.file), expected);
  assert.equal(new Set(receipt.files.map(file => file.file)).size, expected.length);
  sameNames(images.map(file => file.file), expected);
  const digests = Object.fromEntries(images.map(image => [image.file, image.sha256]));
  for (const file of receipt.files) assert.equal(file.sha256, digests[file.file]);
}
function requireImageDetails(image, expected, actualBytes) {
  // nativeImages returns dimensions and digest, but not the file byte length.
  const observed = { ...image, bytes: actualBytes.length };
  assert.equal(sum(actualBytes), image.sha256);
  for (const key of ["bytes", "width", "height", "sha256"]) assert.equal(observed[key], expected[key], image.file + ": " + key);
  return observed;
}
function retainedGex(repo, sets) {
  const descriptorBytes = bytes(repo, GEX + "/native-packet.json");
  assert.equal(sum(descriptorBytes), GEX_PIN, "Retained GEX descriptor changed");
  const descriptor = JSON.parse(descriptorBytes);
  const required = ["capture-execution.json", "capture-sources-before.json", "capture-sources-after.json", "source-contract.json",
    "qualified-root/EVIDENCE.yml", "history.json", "EVIDENCE.before.yml", "capture.log"];
  sameNames(Object.keys(descriptor.files), required);
  for (const name of required) assert.equal(sum(bytes(repo, GEX + "/" + name)), descriptor.files[name], name);
  const execution = json(path.join(repo, GEX, "capture-execution.json")), definition = owner.nativeDefinition("gex");
  api.requireIntegrationExecution(execution, "gex", definition.files, "expiry-greeks-integration");
  assert.equal(execution.logSha256, descriptor.files["capture.log"]);
  assert.equal(execution.sourceBeforeSha256, descriptor.files["capture-sources-before.json"]);
  assert.equal(execution.sourceAfterSha256, descriptor.files["capture-sources-after.json"]);
  assert.equal(execution.sourceBeforeSha256, execution.sourceAfterSha256);
  const contract = json(path.join(repo, GEX, "source-contract.json"));
  sameNames(contract.currentInputs, sets.gex); assert.equal(new Set(contract.currentInputs).size, 29);
  const before = json(path.join(repo, GEX, "capture-sources-before.json"));
  const after = json(path.join(repo, GEX, "capture-sources-after.json"));
  api.requireSourceKeys(before, contract.observedInputs); api.requireSourceKeys(after, contract.observedInputs);
  const current = owner.nativeSources(repo, sets.gex);
  for (const file of sets.gex) { assert.equal(before[file], current[file], file); assert.equal(after[file], current[file], file); }
  const packet = { ...definition, directory: GEX + "/qualified-root" };
  const manifest = owner.readNativePacket(repo, packet);
  assert.equal(manifest.sha256, execution.manifestSha256); assert.equal(manifest.head, execution.branchHead);
  for (const [file, digest] of Object.entries(manifest.layout)) { assert.equal(digest, before[file]); assert.equal(digest, current[file]); }
  sameNames(fs.readdirSync(path.join(repo, packet.directory)).filter(name => name.endsWith(".png")), definition.files);
  const images = owner.nativeImages(repo, packet, visual, Object.fromEntries(Object.entries(execution.images).map(([name, item]) => [name, item.sha256])))
    .map(image => requireImageDetails(image, execution.images[image.file], bytes(repo, packet.directory + "/" + image.file)));
  return { descriptorSha256: GEX_PIN, directory: GEX, manifestSha256: manifest.sha256, capturedAtHead: manifest.head,
    currentSources: current, images, executionSha256: descriptor.files["capture-execution.json"], currentPairQualified: false };
}
function prepare(repo, output, context) {
  const sets = inputSets(), gex = retainedGex(repo, sets);
  const descriptor = bytes(repo, R5 + "/browser-successor.json");
  assert.equal(sum(descriptor), R5_PIN, "Immediate R5 predecessor changed");
  const r5 = JSON.parse(descriptor);
  assert.equal(r5.operation, "pr646-r5-alignment-successor-20261111");
  assert.equal(r5.native.gex.descriptorSha256, GEX_PIN);
  const prior = json(path.join(repo, R5, "qualification.json"));
  assert.equal(sum(bytes(repo, R5 + "/qualification.json")), "f3f748d1c47d2e8582e62637775171290f1847145fb4dfd69936211e7707546d");
  const historical = json(path.join(repo, "terminal/docs/verification/exposure-workspace-20261103/ui-copy-integration-20261109/qualification.json"));
  api.requireOptionsIntegrationBrowserCases(prior, historical);
  const predecessor = path.join(output, "predecessor"); fs.mkdirSync(predecessor);
  fs.writeFileSync(path.join(predecessor, "browser-successor.json"), descriptor, { flag: "wx" });
  const roots = {};
  for (const [kind, file] of Object.entries(ROOTS)) {
    const content = bytes(repo, file); roots[file] = sum(content);
    const protectedBytes = execFileSync("git", ["show", context.protectedMaster + ":" + file], { cwd: repo });
    assert.ok(content.equals(protectedBytes), "Paired predecessor root differs from actual protected base");
    fs.writeFileSync(path.join(predecessor, kind + ".EVIDENCE.yml"), content, { flag: "wx" });
  }
  const result = { state: "RAW_EXPORT_PREREQUISITES_VALIDATED", currentPairQualified: false,
    inputSets: sets, gex, predecessor: { revision: "r5-alignment-20261110", descriptorSha256: R5_PIN, roots },
    specs: api.OPTIONS_INTEGRATION_BROWSER_SPECS, expectedPassed: prior.expectedPassed };
  put(path.join(output, "prerequisites.json"), result); return result;
}
function rootsUnchanged(repo, record) {
  for (const [file, digest] of Object.entries(record.predecessor.roots)) assert.equal(sum(bytes(repo, file)), digest);
}
async function captureNative(repo, output, context) {
  const preflight = json(path.join(output, "prerequisites.json")); rootsUnchanged(repo, preflight);
  const definition = owner.nativeDefinition("eod"), captureId = `pr895-eod-${context.workflowRunId}-${context.workflowRunAttempt}`;
  const stage = path.join(output, "native"); fs.mkdirSync(stage);
  const target = path.join(stage, "eod"); fs.mkdirSync(target);
  const sources = owner.nativeSources(repo, preflight.inputSets.eod);
  const controls = owner.nativeSources(repo, [".github/workflows/ci.yml", "terminal/e2e/tools/qualify_eod_v2_successor.cjs",
    "terminal/e2e/tools/qualify_eod_v2_browser.py", "terminal/e2e/tools/qualify_r5_alignment_browser.py",
    "terminal/e2e/tools/capture_ci_evidence.cjs", "terminal/e2e/tools/optionsExposureEvidence.cjs"]);
  put(path.join(stage, "source-before.json"), { sources, controls });
  const logPath = path.join(stage, "capture.log"), fd = fs.openSync(logPath, "wx");
  const deadlineMs = Math.min(18 * 60_000 + 45_000, context.deadlineEpochMs - Date.now() - 120_000);
  assert.ok(deadlineMs > 0, "No capture budget remains");
  let result;
  try {
    result = await owner.superviseNative(process.execPath, [definition.script.slice("terminal/".length)], {
      cwd: path.join(repo, "terminal"), stdio: ["ignore", fd, fd, "ipc"],
      env: { ...process.env, CAPTURE_ONLY: "", UPDATE_HEATMAP_EVIDENCE: "", CAPTURE_HEAD: "",
        TERMINAL_CROP_OUTPUT_DIR: target, TERMINAL_CROP_PORT: "3566", TERMINAL_NATIVE_CAPTURE_ID: captureId },
    }, { deadlineMs, onState: state => fs.writeFileSync(path.join(stage, "supervisor-progress.json"), JSON.stringify(state) + "\n") });
  } finally { fs.closeSync(fd); }
  const normalized = { ...result, error: result.error ? { message: result.error.message, code: result.error.code || null } : null };
  put(path.join(stage, "supervisor.json"), normalized);
  requireClosedProcess(normalized);
  const after = { sources: owner.nativeSources(repo, preflight.inputSets.eod), controls: owner.nativeSources(repo, Object.keys(controls)) };
  put(path.join(stage, "source-after.json"), after); assert.deepEqual(after, { sources, controls }); rootsUnchanged(repo, preflight);
  const receipts = fs.readFileSync(logPath, "utf8").split("\n").filter(line => line.startsWith('{"nativeEvidence":')).map(line => JSON.parse(line).nativeEvidence);
  assert.equal(receipts.length, 1, "Exactly one complete producer receipt required");
  const packetDefinition = { ...definition, directory: "eod" };
  const manifest = owner.readNativePacket(stage, packetDefinition);
  assert.deepEqual(manifest.layout, owner.nativeSources(repo, definition.producer.LAYOUT_FILES));
  sameNames(fs.readdirSync(target), ["EVIDENCE.yml", ...definition.files]);
  const images = owner.nativeImages(stage, packetDefinition, visual);
  requireNativeReceipt(receipts[0], context, captureId, definition.files, manifest, images, normalized);
  const record = { schema: "terminal_pr895_native_export.v1", state: "RAW_NATIVE_QUALIFIED_PENDING_SUCCESSOR_IMPORT", ...context,
    captureId, expected: 126, successfulFiles: receipts[0].files.length, currentPairQualified: false,
    command: ["node", definition.script.slice("terminal/".length)], sourceStable: true,
    nativeReceipt: receipts[0], nativeSupervisor: normalized, images, manifestSha256: manifest.sha256,
    sources, controls, logSha256: sum(fs.readFileSync(logPath)) };
  put(path.join(stage, "capture-execution.json"), record); return record;
}
function validateContext(context, env, checkout) {
  assert.equal(env.GITHUB_ACTIONS, "true"); assert.equal(env.GITHUB_EVENT_NAME, "pull_request");
  assert.equal(env.GITHUB_JOB, "terminal-unit"); assert.equal(env.GITHUB_REF, "refs/pull/895/merge");
  assert.equal(env.GITHUB_REPOSITORY, "mastermindx-market-intelligence/mastermind-terminal");
  assert.equal(context.checkoutCommit, env.GITHUB_SHA); assert.equal(context.checkoutCommit, checkout.commit);
  assert.equal(context.checkoutTree, checkout.tree); assert.deepEqual(context.checkoutParents, checkout.parents);
  assert.deepEqual(checkout.parents, [context.protectedMaster, context.branchHead]);
  assert.ok(/^[0-9a-f]{40}$/.test(context.branchHead) && /^[0-9a-f]{40}$/.test(context.protectedMaster));
  assert.equal(context.workflowRunId, env.GITHUB_RUN_ID); assert.equal(context.workflowRunAttempt, env.GITHUB_RUN_ATTEMPT);
  assert.ok(Number.isFinite(context.deadlineEpochMs) && context.deadlineEpochMs > Date.now());
}
async function main() {
  const [mode, contextFile, output, requestFile] = process.argv.slice(2);
  assert.ok(["--prepare", "--native", "--browser"].includes(mode));
  const context = json(contextFile), git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
  validateContext(context, process.env, { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
    parents: git("cat-file", "-p", "HEAD").split("\n\n")[0].split("\n").filter(line => line.startsWith("parent ")).map(line => line.slice(7)) });
  const base = fs.realpathSync(process.env.RUNNER_TEMP), actual = fs.realpathSync(output);
  assert.equal(actual, path.join(base, "terminal-ci-evidence", `pr895-${context.workflowRunId}-${context.workflowRunAttempt}`));
  if (mode === "--prepare") prepare(REPO, actual, context);
  else if (mode === "--native") await captureNative(REPO, actual, context);
  else {
    const request = json(requestFile), command = request.command;
    assert.equal(command[0], "node"); assert.equal(command[1], "node_modules/@playwright/test/cli.js"); assert.equal(command[2], "test");
    assert.ok(command.includes("--workers=1") && command.includes("--retries=0"));
    const log = path.resolve(request.log), receipt = path.resolve(request.receipt);
    assert.ok(log.startsWith(actual + path.sep) && receipt.startsWith(actual + path.sep));
    const deadlineMs = Math.min(request.deadlineMs, context.deadlineEpochMs - Date.now() - 120_000);
    assert.ok(Number.isFinite(deadlineMs) && deadlineMs > 0);
    const fd = fs.openSync(log, "wx"); let result;
    try { result = await owner.superviseLegacy(process.execPath, command.slice(1), {
      cwd: path.join(REPO, "terminal"), env: process.env, stdio: ["ignore", fd, fd, "ipc"],
    }, { serverRequired: false, deadlineMs }); } finally { fs.closeSync(fd); }
    // This is CLI-group settlement only. The Python owner separately proves server closure.
    put(receipt, { ...result, serverClosureProven: false,
      error: result.error ? { message: result.error.message, code: result.error.code || null } : null });
  }
}
module.exports = { inputSets, retainedGex, prepare, requireClosedProcess, requireNativeReceipt, requireImageDetails, validateContext, captureNative };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
