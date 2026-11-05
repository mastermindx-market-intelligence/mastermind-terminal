#!/usr/bin/env node
"use strict";
// CI orchestration only. The incumbent evidence reader owns all evidence validation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, spawn: spawnAsync, execFileSync } = require("node:child_process");
const briefs = require("./capture_b_f11_7_recurring_briefs.cjs");
const BRIEFS_DIR = "terminal/docs/pr-crops/b-f11-7-recurring-briefs";
const BRIEFS_CONTROL = ["terminal/e2e/tools/capture_b_f11_7_recurring_briefs.cjs", "terminal/e2e/tools/capture_ci_evidence.cjs"];
const LEGACY_BRIEFS_LAYOUT = briefs.LAYOUT_FILES.filter(p => !p.endsWith("/alerts.module.css"))
  .concat("terminal/components/briefs/BriefSubscribeControls.tsx");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const sameNames = (a, b) => a.length === b.length && new Set(a).size === a.length
  && a.every(name => b.includes(name));

function boundedFile(repoRoot, relative, maximum) {
  // All callers supply fixed source paths or manifest members validated against SHOTS.
  const pieces = relative.split("/");
  let current = repoRoot;
  for (const [index, piece] of pieces.entries()) {
    if (!piece || piece === "." || piece === ".." || piece.includes("\\")) throw new Error("CI_BRIEFS_PATH");
    current = path.join(current, piece);
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || (index < pieces.length - 1 ? !st.isDirectory() : !st.isFile())) throw new Error("CI_BRIEFS_PATH");
    if (index === pieces.length - 1 && (st.size < 1 || st.size > maximum)) throw new Error("CI_BRIEFS_FILE_BOUND");
  }
  const bytes = fs.readFileSync(current);
  if (!bytes.length || bytes.length > maximum) throw new Error("CI_BRIEFS_FILE_BOUND");
  return bytes;
}

function briefsSources(repoRoot, paths = briefs.LAYOUT_FILES) {
  return Object.fromEntries(paths.map(rel => [rel, digest(boundedFile(repoRoot, rel, 2 * 1024 * 1024))]));
}

function readBriefsPacket(repoRoot) {
  const bytes = boundedFile(repoRoot, `${BRIEFS_DIR}/EVIDENCE.yml`, 256 * 1024), text = bytes.toString("utf8");
  const section = name => {
    const matches = [...text.matchAll(new RegExp(`^${name}:\\n((?:  [^\\n]*\\n)*)`, "gm"))];
    if (matches.length !== 1) throw new Error(`CI_BRIEFS_MANIFEST: ${name}`);
    return matches[0][1].trimEnd().split("\n");
  };
  const top = [...text.matchAll(/^([A-Za-z_]+):/gm)].map(m => m[1]);
  if (!sameNames(top, ["layoutFiles", "theme", "languages", "viewports", "harness", "capture_flag", "capture_flag_law", "command", "files"])) throw new Error("CI_BRIEFS_MANIFEST_KEYS");
  if (!/^theme: dark$/m.test(text) || !/^languages: \[en, zh\]$/m.test(text)
      || !/^capture_flag: TERMINAL_E2E_FIXTURE$/m.test(text)
      || !text.includes("capturedAtHead is informational. The lock is layoutFiles.")) throw new Error("CI_BRIEFS_PROFILE");
  const heads = [...text.matchAll(/^# capturedAtHead: ([0-9a-f]{40})$/gm)];
  if (heads.length !== 1) throw new Error("CI_BRIEFS_CAPTURE_HEAD");
  const layout = {};
  for (const line of section("layoutFiles")) {
    const m = line.match(/^  ([A-Za-z0-9_./-]+): "([0-9a-f]{64})"$/);
    if (!m || Object.hasOwn(layout, m[1])) throw new Error("CI_BRIEFS_LAYOUT");
    layout[m[1]] = m[2];
  }
  const layoutCurrent = sameNames(Object.keys(layout), briefs.LAYOUT_FILES);
  const layoutLegacy = sameNames(Object.keys(layout), LEGACY_BRIEFS_LAYOUT);
  if (!layoutCurrent && !layoutLegacy) throw new Error("CI_BRIEFS_LAYOUT_MEMBERSHIP");
  const files = section("files").map(line => {
    const m = line.match(/^  - ([a-z0-9-]+\.png)$/);
    if (!m) throw new Error("CI_BRIEFS_FILES"); return m[1];
  });
  const currentFiles = briefs.SHOTS.map(s => s.file);
  const legacyShots = briefs.SHOTS.map(s => s.kind === "schedule"
    ? { ...s, kind: "subscribe", file: s.file.replace("schedule-", "subscribe-") } : s);
  const legacy = sameNames(files, legacyShots.map(s => s.file));
  if (!sameNames(files, currentFiles) && !legacy) throw new Error("CI_BRIEFS_FILES_MEMBERSHIP");
  if (legacy !== layoutLegacy) throw new Error("CI_BRIEFS_INVENTORY_VERSION");
  const shots = legacy ? legacyShots : briefs.SHOTS;
  if (!sameNames(section("harness"), shots.map(s => `  ${s.file}: { kind: ${s.kind}, lang: ${s.lang}, viewport: ${s.viewport} }`))) throw new Error("CI_BRIEFS_HARNESS");
  if (!sameNames(section("viewports"), Object.entries(briefs.VIEWPORTS).map(([name, v]) => `  - { name: ${name}, width: ${v.width}, height: ${v.height} }`))) throw new Error("CI_BRIEFS_VIEWPORTS");
  return { bytes, sha256: digest(bytes), text, head: heads[0][1], layout, files, legacy };
}

function briefsImages(repoRoot, evidence, expected) {
  return briefs.SHOTS.map(shot => {
    const info = evidence.imageInfo(boundedFile(repoRoot, `${BRIEFS_DIR}/${shot.file}`, 24 * 1024 * 1024));
    if (info.width > briefs.VIEWPORTS[shot.viewport].width || (expected && expected[shot.file] !== info.sha256)) throw new Error("CI_BRIEFS_IMAGE_BINDING");
    return { file: shot.file, ...info };
  });
}

function superviseBriefs(command, args, options, { spawn = spawnAsync, deadlineMs = 18 * 60_000 + 45_000,
  graceMs = 45_000, killMs = 15_000, serverGraceMs = 8_000, serverKillMs = 5_000,
  onState = () => {}, kill = process.kill.bind(process), now = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  return new Promise(resolve => {
    let child, error = null, timedOut = false, settled = false;
    let serverPid = null, serverReportedStopped = false;
    const timers = [];
    const settleServer = async () => {
      if (serverReportedStopped) return true;
      if (!serverPid) return !child?.pid; // A spawned producer without a report remains unresolved.
      if (error?.code === "EPERM" || error?.code === "EACCES") return false;
      const alive = () => {
        try { kill(-serverPid, 0); return true; }
        catch (cause) { if (cause.code === "ESRCH") return false; throw cause; }
      };
      const signal = name => {
        try { kill(-serverPid, name); onState({ serverSignalSent: name }); }
        catch (cause) { if (cause.code !== "ESRCH") throw cause; }
      };
      const drain = async milliseconds => {
        const deadline = now() + milliseconds;
        while (alive() && now() < deadline) await wait(50);
        return !alive();
      };
      try {
        if (!alive()) return true;
        signal("SIGTERM");
        if (await drain(serverGraceMs)) return true;
        signal("SIGKILL");
        return await drain(serverKillMs);
      } catch (cause) { error ||= cause; onState({ serverError: cause.message }); return false; }
    };
    const finish = async (status, signal, closed) => {
      if (settled) return;
      settled = true; timers.forEach(clearTimeout);
      if (!closed) child?.unref();
      const serverSettled = await settleServer();
      if (!closed && child?.connected) {
        try { child.disconnect(); } catch (cause) { error ||= cause; }
      }
      onState({ serverPid, serverReportedStopped, serverSettled });
      resolve({ status, signal, error, timedOut, closed, pid: child?.pid || null,
        serverPid, serverReportedStopped, serverSettled });
    };
    const terminate = signal => {
      if (!child?.pid) return;
      try { kill(-child.pid, signal); onState({ signalSent: signal }); }
      catch (cause) {
        if (cause.code !== "ESRCH") { error = cause; finish(null, null, false); }
      }
    };
    try { child = spawn(command, args, { ...options, detached: true }); }
    catch (cause) { error = cause; finish(null, null, true); return; }
    onState({ pid: child.pid || null });
    child.once("error", cause => { error = cause; });
    child.once("close", (status, signal) => finish(status, signal, true));
    child.on("message", message => {
      if (settled || !message || !Object.hasOwn(message, "briefsServer")) return;
      const report = message.briefsServer;
      const identity = report && report.captureId === options.env?.TERMINAL_BRIEFS_CAPTURE_ID
        && typeof report.captureId === "string" && report.captureId.length > 0
        && Number.isInteger(report.pid) && report.pid > 1 && report.pgid === report.pid
        && report.pid !== child.pid && report.pid !== process.pid;
      if (!identity || (report.phase === "started" ? serverPid !== null
        : report.phase !== "stopped" || report.pid !== serverPid || serverReportedStopped)) {
        error ||= new Error("CI_BRIEFS_SERVER_REPORT"); return;
      }
      if (report.phase === "started") serverPid = report.pid;
      else serverReportedStopped = true;
      onState({ serverPid, serverReportedStopped });
    });
    timers.push(setTimeout(() => {
      timedOut = true; onState({ timedOut: true }); terminate("SIGTERM");
      if (settled) return;
      timers.push(setTimeout(() => {
        terminate("SIGKILL");
        if (!settled) timers.push(setTimeout(() => finish(null, "SIGKILL", false), killMs));
      }, graceMs));
    }, deadlineMs));
  });
}

async function qualifyBriefs({ repoRoot, env, evidence, checkout, spawnBriefs, diagnostics, ids, record, save }) {
  const before = readBriefsPacket(repoRoot), sources = briefsSources(repoRoot), controls = briefsSources(repoRoot, BRIEFS_CONTROL);
  const current = !before.legacy && same(before.layout, sources);
  record.briefs = { state: current ? "CURRENT" : "CAPTURE_REQUIRED", priorManifestSha256: before.sha256, sources, controls };
  save();
  if (current) { record.briefs.images = briefsImages(repoRoot, evidence); save(); return; }
  const priorPath = path.join(diagnostics, `${ids.prefix}.briefs.prior-EVIDENCE.yml`);
  fs.writeFileSync(priorPath, before.bytes, { flag: "wx" });
  record.briefs.priorManifestPath = priorPath;
  const child = { packet: "briefs", command: [process.execPath, "e2e/tools/capture_b_f11_7_recurring_briefs.cjs"], state: "RUNNING",
    stdoutPath: path.join(diagnostics, `${ids.prefix}.briefs.stdout.log`), stderrPath: path.join(diagnostics, `${ids.prefix}.briefs.stderr.log`) };
  record.children.push(child); save();
  let out, err, result;
  try {
    out = fs.openSync(child.stdoutPath, "wx"); err = fs.openSync(child.stderrPath, "wx");
    result = await superviseBriefs(process.execPath, child.command.slice(1), {
      cwd: path.join(repoRoot, "terminal"),
      env: { ...env, CAPTURE_ONLY: "", TERMINAL_CROP_PORT: "3567", TERMINAL_BRIEFS_CAPTURE_ID: ids.prefix },
      stdio: ["ignore", out, err, "ipc"],
    }, { spawn: spawnBriefs, onState: state => { Object.assign(child, state); save(); } });
  } finally { if (out !== undefined) fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
  Object.assign(child, { state: result.closed && result.serverSettled ? "CLOSED" : "UNSETTLED", status: result.status,
    signal: result.signal, timedOut: result.timedOut, error: result.error?.message || null }); save();
  if (result.error || result.signal || result.status !== 0 || result.timedOut || !result.closed || !result.serverSettled) throw new Error("CI_BRIEFS_CHILD_FAILED_OR_UNSETTLED");
  if (!same(checkout(repoRoot, env).actualCheckout, record.actualCheckout)
      || !same(briefsSources(repoRoot), sources) || !same(briefsSources(repoRoot, BRIEFS_CONTROL), controls)) throw new Error("CI_BRIEFS_SOURCE_CHANGED");
  const stdout = boundedFile(diagnostics, path.basename(child.stdoutPath), 16 * 1024 * 1024).toString("utf8");
  const completions = stdout.split(/\r?\n/).filter(line => /^wrote \d+ crops \+ EVIDENCE\.yml /.test(line));
  if (completions.length !== 1 || completions[0] !== `wrote 12 crops + EVIDENCE.yml (capturedAtHead ${record.actualCheckout.commit})`) throw new Error("CI_BRIEFS_COMPLETION");
  const receipts = stdout.split(/\r?\n/).flatMap(line => {
    try { const value = JSON.parse(line); return value && Object.hasOwn(value, "briefsEvidence") ? [value.briefsEvidence] : []; }
    catch { return []; }
  });
  if (receipts.length !== 1) throw new Error("CI_BRIEFS_RECEIPT_COUNT");
  const receipt = receipts[0], after = readBriefsPacket(repoRoot), historyFile = `EVIDENCE.history-${before.sha256}.yml`;
  if (!receipt || receipt.capturedAtHead !== record.actualCheckout.commit || after.head !== record.actualCheckout.commit
      || after.legacy || !same(after.layout, sources) || receipt.manifestSha256 !== after.sha256
      || receipt.history?.file !== historyFile || receipt.history?.sha256 !== before.sha256
      || !after.text.includes(`# priorManifest: ${historyFile}\n`) || !after.text.includes(`# priorManifestSha256: ${before.sha256}\n`)
      || !boundedFile(repoRoot, `${BRIEFS_DIR}/${historyFile}`, 256 * 1024).equals(before.bytes)
      || !Array.isArray(receipt.files) || !sameNames(receipt.files.map(f => f?.file), briefs.SHOTS.map(s => s.file))
      || receipt.files.some(f => !/^[0-9a-f]{64}$/.test(f.sha256 || ""))) throw new Error("CI_BRIEFS_RESULT_BINDING");
  record.briefs.images = briefsImages(repoRoot, evidence, Object.fromEntries(receipt.files.map(f => [f.file, f.sha256])));
  record.briefs.state = "QUALIFIED"; record.briefs.manifestSha256 = after.sha256; record.briefs.history = receipt.history; save();
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

async function run({ repoRoot = path.resolve(__dirname, "../../.."), env = process.env,
  evidence, spawn = spawnSync, spawnBriefs = spawnAsync, checkout = checkoutIdentity } = {}) {
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
    record.state = "CAPTURING"; save();
    await qualifyBriefs({ repoRoot, env, evidence, checkout, spawnBriefs, diagnostics, ids, record, save });
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
          env: { ...env, CAPTURE_ONLY: "", ...extraEnv }, stdio: ["ignore", out, err] });
      } finally { fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
      Object.assign(child, { state: "RETURNED", status: result.status, signal: result.signal,
        error: result.error?.message || null }); save();
      if (result.error || result.signal || result.status !== 0)
        throw new Error(`CI_EVIDENCE_CHILD_FAILED: ${packet}: status=${result.status} signal=${result.signal || "none"} error=${result.error?.message || "none"}`);
      if (fs.statSync(stdoutPath).size > 16 * 1024 * 1024) throw new Error("CI_EVIDENCE_LOG_LIMIT");
      return reference(fs.readFileSync(stdoutPath, "utf8"), packet, ids[packet], evidence);
    };
    const refs = [
      capture("pl6", ["e2e/tools/capture_pl6_batch1.cjs"], { TERMINAL_PL6_EVIDENCE_OPERATION_ID: ids.pl6, TERMINAL_CROP_PORT: "3536" }),
      capture("vi", ["e2e/tools/capture_visual_evidence.cjs", "--id", ids.vi, "--port", "3537"], {}),
    ];
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
  Promise.resolve().then(() => {
    if (process.argv.length === 3 && process.argv[2] === "--checkout-only") recordCheckout();
    else if (process.argv.length === 2) return run();
    else throw new Error("CI_EVIDENCE_ARGUMENT");
  }).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
module.exports = { operationIds, reference, checkoutIdentity, recordCheckout, run,
  BRIEFS_DIR, BRIEFS_CONTROL, readBriefsPacket, briefsSources, superviseBriefs };
