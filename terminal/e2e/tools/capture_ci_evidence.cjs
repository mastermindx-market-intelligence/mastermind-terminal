#!/usr/bin/env node
"use strict";
// CI orchestration only. The incumbent evidence reader owns all evidence validation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");

function operationIds(env) {
  for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"])
    if (!/^[1-9][0-9]{0,19}$/.test(env[name] || "")) throw new Error(`CI_EVIDENCE_ID: ${name}`);
  const prefix = `ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  return { pl6: `${prefix}-pl6`, vi: `${prefix}-vi`, composition: `${prefix}-current`, prefix };
}

function reference(stdout, packet, id, evidence) {
  const refs = [];
  for (const line of stdout.split(/\r?\n/)) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    if (value && typeof value === "object" && Object.hasOwn(value, "visualEvidence")) refs.push(value);
  }
  if (refs.length !== 1) throw new Error(`CI_EVIDENCE_REFERENCE_COUNT: ${packet}:${refs.length}`);
  const r = refs[0], expectedCases = packet === "pl6" ? 24 : 30;
  // PL6 retains its four additional DiscoverLeaders cases; only its required20 are selected.
  if (r.visualEvidence !== `${evidence.PACKETS[packet]}/${id}--operation.json`
      || !/^[0-9a-f]{64}$/.test(r.sha256 || "") || r.actualCases !== expectedCases)
    throw new Error(`CI_EVIDENCE_REFERENCE: ${packet}`);
  return { path: r.visualEvidence, sha256: r.sha256 };
}

function checkoutIdentity(repoRoot, env) {
  const git = arg => execFileSync("git", ["rev-parse", arg], { cwd: repoRoot, encoding: "utf8" }).trim();
  const commit = git("HEAD"), tree = git("HEAD^{tree}");
  if (![commit, tree].every(v => /^[0-9a-f]{40}$/.test(v))) throw new Error("CI_EVIDENCE_CHECKOUT");
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
  return {
    actualCheckout: { commit, tree },
    githubEvent: {
      name: env.GITHUB_EVENT_NAME || null, sha: env.GITHUB_SHA || null, ref: env.GITHUB_REF || null,
      pullRequestBase: event.pull_request?.base?.sha || null, pullRequestHead: event.pull_request?.head?.sha || null,
      mergeGroupBase: event.merge_group?.base_sha || null, mergeGroupHead: event.merge_group?.head_sha || null,
    },
  };
}

function diagnosticDirectory(env) {
  if (!env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) throw new Error("CI_EVIDENCE_RUNNER_TEMP");
  // Playwright clears its outputDir at startup, including the default test-results.
  return path.join(env.RUNNER_TEMP, "terminal-ci-evidence");
}

const BATCH2_PACKET = "terminal/docs/pr-crops/b-pl-6-batch-2";
const BATCH2_FLAGS = {
  conductor_step: "2", screenshot_animations: "disabled", screenshot_raster: "full",
  guide_motion: "reduced", guide_backdrop: "hidden",
};
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function manifestRows(text, name, optional = false) {
  const lines = text.split("\n");
  const count = lines.filter(line => line === name + ":").length;
  if (count === 0 && optional) return null;
  if (count !== 1) throw new Error("CI_BATCH2_MANIFEST_SECTION: " + name);
  const result = [];
  for (const line of lines.slice(lines.indexOf(name + ":") + 1)) {
    if (!line.startsWith("  ")) break;
    result.push(line);
  }
  if (!result.length) throw new Error("CI_BATCH2_MANIFEST_EMPTY: " + name);
  return result;
}

function declaredBatch2History(repoRoot, text, required) {
  const lines = text.split("\n").filter(line => line.startsWith("previousManifest:"));
  if (!lines.length && !required) return null;
  const match = lines.length === 1 && lines[0].match(/^previousManifest: (history\/before-deterministic-([0-9a-f]{64})\.yml)$/);
  if (!match || digest(fs.readFileSync(path.join(repoRoot, BATCH2_PACKET, match[1]))) !== match[2])
    throw new Error("CI_BATCH2_DECLARED_HISTORY");
  return match[1];
}

function manifestHashes(text, name, expected, optional = false) {
  const rows = manifestRows(text, name, optional);
  if (rows === null) return null;
  const map = {};
  for (const line of rows) {
    const match = line.match(/^  (\S+): "([0-9a-f]{64})"$/);
    if (!match || Object.hasOwn(map, match[1])) throw new Error("CI_BATCH2_MANIFEST_HASH: " + name);
    map[match[1]] = match[2];
  }
  if (JSON.stringify(Object.keys(map).sort()) !== JSON.stringify([...expected].sort()))
    throw new Error("CI_BATCH2_MANIFEST_MEMBERSHIP: " + name);
  return map;
}

function batch2Plan(repoRoot) {
  const { LAYOUT_FILES, EXPECTED_FILES } = require("./capture_pl6_batch2.cjs");
  const manifestPath = path.join(repoRoot, BATCH2_PACKET, "EVIDENCE.yml");
  const bytes = fs.readFileSync(manifestPath), text = bytes.toString("utf8");
  const recorded = manifestHashes(text, "layoutFiles", LAYOUT_FILES);
  const names = manifestRows(text, "files").map(line => {
    const match = line.match(/^  - ([A-Za-z0-9-]+\.png)$/);
    if (!match) throw new Error("CI_BATCH2_MANIFEST_FILENAME");
    return match[1];
  });
  if (names.length !== EXPECTED_FILES.length || new Set(names).size !== names.length
      || JSON.stringify([...names].sort()) !== JSON.stringify(EXPECTED_FILES))
    throw new Error("CI_BATCH2_MANIFEST_FILES");
  const sourceFiles = Object.fromEntries(LAYOUT_FILES.map(rel => [rel, digest(fs.readFileSync(path.join(repoRoot, rel)))]));
  const reasons = [];
  if (LAYOUT_FILES.some(rel => recorded[rel] !== sourceFiles[rel])) reasons.push("source-bytes-changed");
  for (const [key, expected] of Object.entries(BATCH2_FLAGS)) {
    const values = text.split("\n").filter(line => line.startsWith(key + ":"));
    if (values.length > 1) throw new Error("CI_BATCH2_MANIFEST_FLAG: " + key);
    if (values.length !== 1 || values[0] !== key + ": " + expected) reasons.push("capture-setting:" + key);
  }
  const imageHashes = manifestHashes(text, "captureFiles", EXPECTED_FILES, true);
  if (!imageHashes) reasons.push("actual-image-hashes-absent");
  const historicalManifest = declaredBatch2History(repoRoot, text, imageHashes !== null);
  for (const file of EXPECTED_FILES) {
    const image = fs.readFileSync(path.join(repoRoot, BATCH2_PACKET, file));
    if (image.length <= 8 || !image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
      throw new Error("CI_BATCH2_IMAGE_BYTES: " + file);
    if (imageHashes && digest(image) !== imageHashes[file]) throw new Error("CI_BATCH2_IMAGE_HASH: " + file);
  }
  return { required: reasons.length > 0, reasons, manifestPath, manifestSha256: digest(bytes),
    sourceFiles, imageHashes, historicalManifest };
}

function verifyBatch2Capture(repoRoot, before, stdout, actualHead) {
  const heads = [...stdout.matchAll(/^capturedAtHead ([0-9a-f]{40})$/gm)];
  const completions = [...stdout.matchAll(/^wrote ([0-9]+) crops \+ EVIDENCE\.yml to (.+)$/gm)];
  const { EXPECTED_FILES } = require("./capture_pl6_batch2.cjs");
  if (heads.length !== 1 || heads[0][1] !== actualHead || completions.length !== 1
      || Number(completions[0][1]) !== EXPECTED_FILES.length
      || completions[0][2] !== path.join(repoRoot, BATCH2_PACKET))
    throw new Error("CI_BATCH2_COMPLETION");
  const after = batch2Plan(repoRoot);
  if (after.required || JSON.stringify(after.sourceFiles) !== JSON.stringify(before.sourceFiles))
    throw new Error("CI_BATCH2_CAPTURE_SOURCE");
  const text = fs.readFileSync(after.manifestPath, "utf8");
  if ((text.match(/^# capturedAtHead: .+$/gm) ?? []).join("\n") !== "# capturedAtHead: " + actualHead)
    throw new Error("CI_BATCH2_CAPTURE_HEAD");
  const historical = "history/before-deterministic-" + before.manifestSha256 + ".yml";
  if ((text.match(/^previousManifest: .+$/gm) ?? []).join("\n") !== "previousManifest: " + historical
      || digest(fs.readFileSync(path.join(repoRoot, BATCH2_PACKET, historical))) !== before.manifestSha256)
    throw new Error("CI_BATCH2_HISTORY");
  return { state: "CAPTURED_AWAITING_NATIVE_VALIDATION", manifestSha256: after.manifestSha256,
    actualCheckout: actualHead, sourceFiles: after.sourceFiles, imageHashes: after.imageHashes,
    historicalManifest: historical };
}

function recordCheckout({ repoRoot = path.resolve(__dirname, "../../.."), env = process.env,
  checkout = checkoutIdentity } = {}) {
  const ids = operationIds(env), directory = diagnosticDirectory(env);
  fs.mkdirSync(directory, { recursive: true });
  const value = { operationIds: ids, ...checkout(repoRoot, env) };
  fs.writeFileSync(path.join(directory, `${ids.prefix}.checkout.json`), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return value;
}

function run({ repoRoot = path.resolve(__dirname, "../../.."), env = process.env,
  evidence, spawn = spawnSync, checkout = checkoutIdentity } = {}) {
  evidence ||= require("./visualEvidence.cjs");
  const ids = operationIds(env), terminal = path.join(repoRoot, "terminal");
  const diagnostics = diagnosticDirectory(env);
  fs.mkdirSync(diagnostics, { recursive: true });
  const recordPath = path.join(diagnostics, `${ids.prefix}.json`);
  const record = { operationIds: ids, state: "PREPARING", children: [] };
  // An accidental second invocation may not overwrite the first attempt's diagnostics.
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  const save = () => fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  try {
    if ((env.CAPTURE_ONLY || "").trim()) throw new Error("CI_EVIDENCE_CAPTURE_FILTER");
    if (env.TERMINAL_EVIDENCE_COMPOSITION) throw new Error("CI_EVIDENCE_PRESELECTED");
    if (!env.GITHUB_ENV) throw new Error("CI_EVIDENCE_ENV_FILE");
    Object.assign(record, checkout(repoRoot, env));
    const captureProfile = evidence.profile(env);
    record.profile = captureProfile;
    const batch2 = batch2Plan(repoRoot);
    record.batch2 = { ...batch2, state: batch2.required ? "CAPTURE_REQUIRED" : "EXISTING_PACKET_AWAITING_NATIVE_VALIDATION" };
    if (batch2.required) {
      const prior = fs.readFileSync(batch2.manifestPath);
      if (digest(prior) !== batch2.manifestSha256) throw new Error("CI_BATCH2_HISTORY_CHANGED");
      const historyPath = path.join(diagnostics, ids.prefix + ".batch2.previous-manifest.yml");
      fs.writeFileSync(historyPath, prior, { flag: "wx" });
      record.batch2.historicalDiagnostic = historyPath;
    }
    record.state = "CAPTURING"; save();
    const capture = (packet, args, extraEnv) => {
      const childId = ids[packet] || (ids.prefix + "-" + packet);
      const stdoutPath = path.join(diagnostics, `${childId}.stdout.log`);
      const stderrPath = path.join(diagnostics, `${childId}.stderr.log`);
      const child = { packet, command: [process.execPath, ...args], stdoutPath, stderrPath, state: "RUNNING" };
      record.children.push(child); save();
      const out = fs.openSync(stdoutPath, "wx");
      let result, err;
      try {
        err = fs.openSync(stderrPath, "wx");
        result = spawn(process.execPath, args, { cwd: terminal,
          env: { ...env, CAPTURE_ONLY: "", ...extraEnv }, stdio: ["ignore", out, err],
          ...(packet === "batch2" ? { timeout: 20 * 60_000, killSignal: "SIGTERM" } : {}) });
      } finally { fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
      Object.assign(child, { state: "RETURNED", status: result.status, signal: result.signal,
        error: result.error?.message || null }); save();
      if (result.error || result.signal || result.status !== 0)
        throw new Error(`CI_EVIDENCE_CHILD_FAILED: ${packet}: status=${result.status} signal=${result.signal || "none"} error=${result.error?.message || "none"}`);
      if (fs.statSync(stdoutPath).size > 16 * 1024 * 1024) throw new Error("CI_EVIDENCE_LOG_LIMIT");
      const stdout = fs.readFileSync(stdoutPath, "utf8");
      return packet === "batch2" ? stdout : reference(stdout, packet, ids[packet], evidence);
    };
    const refs = [
      capture("pl6", ["e2e/tools/capture_pl6_batch1.cjs"], { TERMINAL_PL6_EVIDENCE_OPERATION_ID: ids.pl6, TERMINAL_CROP_PORT: "3536" }),
      capture("vi", ["e2e/tools/capture_visual_evidence.cjs", "--id", ids.vi, "--port", "3537"], {}),
    ];
    if (batch2.required) {
      const stdout = capture("batch2", ["e2e/tools/capture_pl6_batch2.cjs"], { TERMINAL_CROP_PORT: "3538" });
      Object.assign(record.batch2, verifyBatch2Capture(repoRoot, batch2, stdout, record.actualCheckout.commit));
      save();
    }
    const required = [...evidence.requirements("pl6"), ...evidence.requirements("vi")];
    if (required.length !== 50 || new Set(required.map(c => c.key)).size !== 50) throw new Error("CI_EVIDENCE_REQUIREMENTS");
    const selections = required.map(c => ({ operationId: ids[c.packet], key: c.key }));
    const input = { repoRoot, id: ids.composition, operations: refs, selections, profile: captureProfile };
    record.state = "VALIDATING"; record.references = refs; save();
    evidence.writeComposition(input); // Writes immutably and validates its exact created bytes.
    const compositionPath = `${evidence.PACKETS.pl6}/${ids.composition}.composition.json`;
    const validated = evidence.readComposition({ repoRoot, compositionPath, expectedProfile: captureProfile });
    if (validated.id !== ids.composition || validated.cases.length !== 50 || validated.operations.length !== 2
        || ["pl6", "vi"].some(packet => {
          const ops = validated.operations.filter(op => op.id === ids[packet] && op.packet === packet);
          return ops.length !== 1 || ops[0].cases.length !== (packet === "pl6" ? 24 : 30);
        })) throw new Error("CI_EVIDENCE_COMPOSITION");
    const bytes = fs.readFileSync(path.join(repoRoot, compositionPath));
    const expected = evidence.canonical({ schema: "terminal.visual-composition.v2", mode: "records",
      id: ids.composition, profile: captureProfile, operations: refs, selections });
    if (!bytes.equals(Buffer.from(expected))) throw new Error("CI_EVIDENCE_COMPOSITION_BYTES");
    record.composition = { path: compositionPath, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), selectedCases: 50 };
    record.state = "VALIDATED"; save();
    // Only successful full validation can select records for subsequent unit steps.
    fs.appendFileSync(env.GITHUB_ENV, `TERMINAL_EVIDENCE_MODE=records\nTERMINAL_EVIDENCE_COMPOSITION=${compositionPath}\n`);
    record.state = "SELECTED"; save();
    return record;
  } catch (error) {
    record.state = "FAILED"; record.error = { message: error.message, stack: error.stack };
    save(); throw error;
  }
}

if (require.main === module) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--checkout-only") recordCheckout();
    else if (process.argv.length === 2) run();
    else throw new Error("CI_EVIDENCE_ARGUMENT");
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
module.exports = { operationIds, reference, checkoutIdentity, recordCheckout, run, batch2Plan, verifyBatch2Capture };
