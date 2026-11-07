#!/usr/bin/env node
"use strict";
// CI orchestration only. The incumbent evidence reader owns all evidence validation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, spawn: spawnAsync, execFileSync } = require("node:child_process");

const OPTIONS_PACKET = "terminal/docs/pr-crops/options-level-axis-labels";
const OPTIONS_SOURCES = ["components/ChartPanel.tsx", "lib/optionsLevels.ts", "lib/priceTagPlacement.ts"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

// Decide whether the existing packet needs a real recapture. Its unchanged unit reader
// still owns all image/proof validation; a matching source snapshot is not a new capture.
function optionsCapturePlan(terminal) {
  const file = path.join(terminal, "docs/pr-crops/options-level-axis-labels/manifest.json");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError)
      return { required: true, reason: "missing-or-invalid-manifest" };
    throw error;
  }
  const changed = OPTIONS_SOURCES.filter(file =>
    manifest?.sourceFiles?.[file] !== sha256(fs.readFileSync(path.join(terminal, file))));
  return { required: changed.length > 0, changed };
}

// Called by PL6 only while its own warmed server is alive. Async spawn keeps that
// owner's event loop draining the server pipes while Options makes HTTP requests.
async function captureOptions({ server, ownedServer, baseURL, terminal, env = process.env,
  spawn = spawnAsync } = {}) {
  if (!ownedServer(server)) throw new Error("CI_OPTIONS_SERVER_NOT_READY");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["docs/pr-crops/options-level-axis-labels/capture.mjs"], {
      cwd: terminal, env: { ...env, BASE_URL: baseURL }, stdio: "inherit", timeout: 600_000,
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      if (signal || status !== 0)
        reject(new Error(`CI_OPTIONS_CHILD_FAILED: status=${status} signal=${signal || "none"}`));
      else resolve();
    });
  });
  if (!ownedServer(server)) throw new Error("CI_OPTIONS_SERVER_NOT_READY");
}

function optionsReceipt(repoRoot, captured, checkoutCommit) {
  const relative = `${OPTIONS_PACKET}/manifest.json`;
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  const manifest = JSON.parse(bytes);
  if (captured && (manifest.sourceHead !== checkoutCommit || optionsCapturePlan(path.join(repoRoot, "terminal")).required))
    throw new Error("CI_OPTIONS_CHECKOUT_BINDING");
  return { path: relative, sha256: sha256(bytes), sourceHead: manifest.sourceHead,
    state: captured ? "CAPTURED_AWAITING_UNIT_VALIDATION" : "EXISTING_PACKET_AWAITING_UNIT_VALIDATION" };
}

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
    record.optionsAxis = { plan: optionsCapturePlan(terminal), state: "PREPARING" };
    record.state = "CAPTURING"; save();
    const capture = (packet, args, extraEnv) => {
      const stdoutPath = path.join(diagnostics, `${ids[packet]}.stdout.log`);
      const stderrPath = path.join(diagnostics, `${ids[packet]}.stderr.log`);
      const child = { packet, command: [process.execPath, ...args], stdoutPath, stderrPath, state: "RUNNING" };
      record.children.push(child); save();
      const out = fs.openSync(stdoutPath, "wx");
      let result, err;
      try {
        err = fs.openSync(stderrPath, "wx");
        result = spawn(process.execPath, args, { cwd: terminal,
          env: { ...env, CAPTURE_ONLY: "", TERMINAL_CI_OPTIONS_AXIS_CAPTURE: "0", ...extraEnv }, stdio: ["ignore", out, err] });
      } finally { fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
      Object.assign(child, { state: "RETURNED", status: result.status, signal: result.signal,
        error: result.error?.message || null }); save();
      if (result.error || result.signal || result.status !== 0)
        throw new Error(`CI_EVIDENCE_CHILD_FAILED: ${packet}: status=${result.status} signal=${result.signal || "none"} error=${result.error?.message || "none"}`);
      if (fs.statSync(stdoutPath).size > 16 * 1024 * 1024) throw new Error("CI_EVIDENCE_LOG_LIMIT");
      return reference(fs.readFileSync(stdoutPath, "utf8"), packet, ids[packet], evidence);
    };
    const refs = [capture("pl6", ["e2e/tools/capture_pl6_batch1.cjs"], {
      TERMINAL_PL6_EVIDENCE_OPERATION_ID: ids.pl6, TERMINAL_CROP_PORT: "3536",
      TERMINAL_CI_OPTIONS_AXIS_CAPTURE: record.optionsAxis.plan.required ? "1" : "0",
    })];
    Object.assign(record.optionsAxis, optionsReceipt(repoRoot, record.optionsAxis.plan.required, record.actualCheckout.commit));
    save();
    refs.push(capture("vi", ["e2e/tools/capture_visual_evidence.cjs", "--id", ids.vi, "--port", "3537"], {}));
    const required = [...evidence.requirements("pl6"), ...evidence.requirements("vi")];
    if (required.length !== 50 || new Set(required.map(c => c.key)).size !== 50) throw new Error("CI_EVIDENCE_REQUIREMENTS");
    const selections = required.map(c => ({ operationId: ids[c.packet], key: c.key }));
    const input = { repoRoot, id: ids.composition, operations: refs, selections, profile: captureProfile };
    record.state = "VALIDATING"; record.references = refs; save();
    const validated = evidence.writeComposition(input); // Returns validation of its exact created bytes.
    const compositionPath = `${evidence.PACKETS.pl6}/${ids.composition}.composition.json`;
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
module.exports = { operationIds, reference, checkoutIdentity, recordCheckout, optionsCapturePlan, captureOptions, run };
