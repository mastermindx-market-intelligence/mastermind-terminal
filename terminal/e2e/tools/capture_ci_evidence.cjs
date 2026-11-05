#!/usr/bin/env node
"use strict";
// CI orchestration only. The incumbent evidence reader owns all evidence validation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFileSync } = require("node:child_process");

const EOD_PACKET = "terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure";
const EOD_LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/eodcontext/DarkPoolMini.tsx",
  "terminal/components/eodcontext/EodContextBelt.tsx",
  "terminal/components/eodcontext/StructureStrip.tsx",
  "terminal/components/eodcontext/eodStrings.ts",
  "terminal/components/flowdesk/FlowDeskView.tsx",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/lib/dataCache.ts",
  "terminal/lib/eodContext.ts",
  "terminal/lib/flowdeskStrings.ts",
  "terminal/lib/heatmapStrings.ts",
];
const EOD_STATES = [
  "eod-darkpool-unavailable", "eod-darkpool-retried", "eod-darkpool-absent",
  "eod-structure-partial", "eod-structure-retried", "eod-structure-unavailable", "eod-structure-absent",
  "chainheat-unavailable", "chainheat-retried", "chainheat-absent", "chainheat-refresh-failed",
  "heatmap-flow-unavailable", "heatmap-flow-retried", "heatmap-flow-absent", "heatmap-flow-auth",
  "heatmap-flow-refresh-failed", "heatmap-flow-persisted-refresh-failed",
  "heatmap-flow-persisted-refresh-refused", "heatmap-flow-persisted-retried",
  "heatmap-live-failed", "heatmap-no-match",
];
const EOD_CROPS = EOD_STATES.flatMap(state => [1440, 820, 390]
  .flatMap(width => [state + "-" + width + ".png", state + "-" + width + "-zh.png"])).sort();
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sameMap = (a, b) => Object.keys(a).length === Object.keys(b).length
  && Object.entries(a).every(([key, value]) => b[key] === value);

// Read the incumbent manifest without changing its schema or its native consumer.
function eodPacket(repoRoot) {
  const relative = EOD_PACKET + "/EVIDENCE.yml";
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  const text = bytes.toString("utf8");
  const section = name => {
    const marker = "\n" + name + ":\n";
    if (text.split(marker).length !== 2) throw new Error("CI_EOD_MANIFEST_SECTION: " + name);
    const rows = [];
    for (const row of text.slice(text.indexOf(marker) + marker.length).split("\n")) {
      if (!row.startsWith("  ")) break;
      rows.push(row);
    }
    return rows;
  };
  const layoutFiles = {};
  for (const row of section("layoutFiles")) {
    const match = row.match(/^  (terminal\/[A-Za-z0-9_./-]+): "?([a-f0-9]{64})"?$/);
    if (!match || !EOD_LAYOUT_FILES.includes(match[1]) || Object.hasOwn(layoutFiles, match[1]))
      throw new Error("CI_EOD_MANIFEST_SOURCE: " + row);
    layoutFiles[match[1]] = match[2];
  }
  if (!sameMap(Object.fromEntries(EOD_LAYOUT_FILES.map(file => [file, true])),
      Object.fromEntries(Object.keys(layoutFiles).map(file => [file, true]))))
    throw new Error("CI_EOD_MANIFEST_SOURCES");
  const files = section("files").map(row => {
    const match = row.match(/^  - ([a-z0-9-]+\.png)$/);
    if (!match) throw new Error("CI_EOD_MANIFEST_FILE: " + row);
    return match[1];
  }).sort();
  if (JSON.stringify(files) !== JSON.stringify(EOD_CROPS)) throw new Error("CI_EOD_MANIFEST_CASES");
  const actual = Object.fromEntries(EOD_LAYOUT_FILES.map(file =>
    [file, sha256(fs.readFileSync(path.join(repoRoot, file)))]));
  const changed = EOD_LAYOUT_FILES.filter(file => actual[file] !== layoutFiles[file]);
  return { path: relative, sha256: sha256(bytes), layoutFiles, actual, files,
    capturedAtHead: text.match(/^# capturedAtHead: ([a-f0-9]{40})$/m)?.[1] || null,
    plan: { required: changed.length > 0, changed } };
}

function eodReceipt(repoRoot, before, stdout, checkoutCommit) {
  const returned = [...stdout.matchAll(/^wrote 126 crops \+ EVIDENCE\.yml \(head ([a-f0-9]{40})\)$/gm)];
  if (returned.length !== 1 || returned[0][1] !== checkoutCommit) throw new Error("CI_EOD_COMPLETION");
  const after = eodPacket(repoRoot);
  if (after.capturedAtHead !== checkoutCommit || !sameMap(before.actual, after.actual)
      || !sameMap(before.actual, after.layoutFiles) || after.plan.required)
    throw new Error("CI_EOD_CHECKOUT_BINDING");
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const crops = {};
  for (const file of EOD_CROPS) {
    const bytes = fs.readFileSync(path.join(repoRoot, EOD_PACKET, file));
    if (bytes.length <= png.length || !bytes.subarray(0, png.length).equals(png))
      throw new Error("CI_EOD_CROP: " + file);
    crops[file] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return { state: "CAPTURED_AWAITING_NATIVE_VALIDATION", path: after.path, sha256: after.sha256,
    capturedAtHead: after.capturedAtHead, layoutFiles: after.layoutFiles, actualCases: EOD_CROPS.length, crops };
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
    const eodBefore = eodPacket(repoRoot);
    record.eod = { plan: eodBefore.plan, priorManifest: { path: eodBefore.path, sha256: eodBefore.sha256 },
      state: "EXISTING_PACKET_AWAITING_NATIVE_VALIDATION" };
    if (eodBefore.plan.required) {
      const priorPath = path.join(diagnostics, ids.prefix + "-eod-prior.EVIDENCE.yml");
      const priorBytes = fs.readFileSync(path.join(repoRoot, eodBefore.path));
      if (sha256(priorBytes) !== eodBefore.sha256) throw new Error("CI_EOD_PRIOR_CHANGED");
      fs.writeFileSync(priorPath, priorBytes, { flag: "wx" });
      record.eod.priorManifest.retainedPath = priorPath;
    }
    record.state = "CAPTURING"; save();
    const capture = (packet, args, extraEnv) => {
      const childId = packet === "eod" ? ids.prefix + "-eod" : ids[packet];
      const stdoutPath = path.join(diagnostics, childId + ".stdout.log");
      const stderrPath = path.join(diagnostics, childId + ".stderr.log");
      const child = { packet, command: [process.execPath, ...args], stdoutPath, stderrPath, state: "RUNNING" };
      record.children.push(child); save();
      const out = fs.openSync(stdoutPath, "wx");
      let result, err;
      try {
        err = fs.openSync(stderrPath, "wx");
        result = spawn(process.execPath, args, { cwd: terminal,
          env: { ...env, CAPTURE_ONLY: "", ...extraEnv }, stdio: ["ignore", out, err],
          ...(packet === "eod" ? { timeout: 1_800_000 } : {}) });
      } finally { fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
      Object.assign(child, { state: "RETURNED", status: result.status, signal: result.signal,
        error: result.error?.message || null }); save();
      if (result.error || result.signal || result.status !== 0)
        throw new Error(`CI_EVIDENCE_CHILD_FAILED: ${packet}: status=${result.status} signal=${result.signal || "none"} error=${result.error?.message || "none"}`);
      if (fs.statSync(stdoutPath).size > 16 * 1024 * 1024) throw new Error("CI_EVIDENCE_LOG_LIMIT");
      const stdout = fs.readFileSync(stdoutPath, "utf8");
      if (packet === "eod") return eodReceipt(repoRoot, eodBefore, stdout, record.actualCheckout.commit);
      return reference(stdout, packet, ids[packet], evidence);
    };
    const refs = [
      capture("pl6", ["e2e/tools/capture_pl6_batch1.cjs"], { TERMINAL_PL6_EVIDENCE_OPERATION_ID: ids.pl6, TERMINAL_CROP_PORT: "3536" }),
      capture("vi", ["e2e/tools/capture_visual_evidence.cjs", "--id", ids.vi, "--port", "3537"], {}),
    ];
    if (eodBefore.plan.required) {
      record.eod.state = "CAPTURING"; save();
      Object.assign(record.eod, capture("eod", ["e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs"], {
        CAPTURE_ONLY: "", UPDATE_HEATMAP_EVIDENCE: "", TERMINAL_CROP_OUTPUT_DIR: "",
        CAPTURE_HEAD: "", TERMINAL_CROP_PORT: "3566",
      }));
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
module.exports = { operationIds, reference, checkoutIdentity, recordCheckout, run,
  eodPacket, eodReceipt, EOD_PACKET, EOD_LAYOUT_FILES, EOD_CROPS };
