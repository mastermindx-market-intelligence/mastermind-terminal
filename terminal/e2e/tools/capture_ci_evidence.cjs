#!/usr/bin/env node
"use strict";
// CI orchestration only. The incumbent evidence reader owns all evidence validation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, spawn: spawnAsync, execFileSync } = require("node:child_process");

const NATIVE_PACKETS = Object.freeze({
  eod: { directory: "terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure", producer: "capture_eod_heatmap_flowdesk_load_failure.cjs", count: 126, port: "3566" },
  gex: { directory: "terminal/docs/pr-crops/gex-levels-heatmap-load-failure", producer: "capture_gex_levels_heatmap_load_failure.cjs", count: 114, port: "3564" },
});
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const sameNames = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(name => b.includes(name));

function nativeDefinition(family) {
  const config = NATIVE_PACKETS[family];
  if (!config) throw new Error("CI_NATIVE_FAMILY");
  const producer = require(`./${config.producer}`);
  const files = producer.expectedFiles();
  if (files.length !== config.count || new Set(files).size !== config.count) throw new Error("CI_NATIVE_MATRIX");
  return { ...config, family, producer, files, script: `terminal/e2e/tools/${config.producer}` };
}

function boundedNativeFile(repoRoot, relative, maximum = 24 * 1024 * 1024) {
  const pieces = relative.split("/");
  let current = repoRoot;
  for (const [index, piece] of pieces.entries()) {
    if (!piece || piece === "." || piece === ".." || piece.includes("\\")) throw new Error("CI_NATIVE_PATH");
    current = path.join(current, piece);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index < pieces.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error("CI_NATIVE_PATH");
    if (index === pieces.length - 1 && stat.size > maximum) throw new Error("CI_NATIVE_FILE_BOUND");
  }
  const bytes = fs.readFileSync(current);
  if (bytes.length > maximum) throw new Error("CI_NATIVE_FILE_BOUND");
  return bytes;
}

function nativeSources(repoRoot, paths) {
  return Object.fromEntries(paths.map(relative => [relative, digest(boundedNativeFile(repoRoot, relative, 2 * 1024 * 1024))]));
}

function readNativePacket(repoRoot, definition) {
  const bytes = boundedNativeFile(repoRoot, `${definition.directory}/EVIDENCE.yml`, 1024 * 1024);
  const text = bytes.toString("utf8");
  const section = name => {
    const matches = [...text.matchAll(new RegExp(`^${name}:\\n((?:  [^\\n]*\\n)*)`, "gm"))];
    if (matches.length !== 1 || !matches[0][1]) throw new Error(`CI_NATIVE_MANIFEST: ${name}`);
    return matches[0][1].trimEnd().split("\n");
  };
  for (const [key, value] of [["theme", "dark"], ["languages", "[en, zh]"], ["capture_flag", "TERMINAL_E2E_FIXTURE"]]) {
    const lines = text.split("\n").filter(line => line.startsWith(`${key}:`));
    if (lines.length !== 1 || lines[0] !== `${key}: ${value}`) throw new Error("CI_NATIVE_PROFILE");
  }
  if (!text.includes("capturedAtHead is informational. The lock is layoutFiles.")
      || !text.includes("DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06")
      || !text.includes("DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR")) throw new Error("CI_NATIVE_PROFILE");
  const heads = [...text.matchAll(/^# capturedAtHead: ([0-9a-f]{40})$/gm)];
  if (heads.length !== 1) throw new Error("CI_NATIVE_CAPTURE_HEAD");
  const layout = {};
  for (const line of section("layoutFiles")) {
    const match = line.match(/^  (terminal\/[A-Za-z0-9_./-]+): "([0-9a-f]{64})"$/);
    if (!match || Object.hasOwn(layout, match[1])) throw new Error("CI_NATIVE_LAYOUT");
    layout[match[1]] = match[2];
  }
  if (!sameNames(Object.keys(layout), definition.producer.LAYOUT_FILES)) throw new Error("CI_NATIVE_LAYOUT_MEMBERSHIP");
  const files = section("files").map(line => {
    const match = line.match(/^  - ([a-z0-9-]+\.png)$/);
    if (!match) throw new Error("CI_NATIVE_FILES");
    return match[1];
  });
  if (!sameNames(files, definition.files)) throw new Error("CI_NATIVE_FILES_MEMBERSHIP");
  const rows = section("harness");
  if (!sameNames(rows, definition.files.map(file => `  ${definition.producer.harnessRow(file).trimStart()}`))) throw new Error("CI_NATIVE_HARNESS");
  const viewports = ["desktop", "tablet", "mobile"].map((name, index) => {
    const width = [1440, 820, 390][index], size = definition.producer.VIEWPORTS[width];
    return `  - { name: ${name}, width: ${size.width}, height: ${size.height} }`;
  });
  if (!sameNames(section("viewports"), viewports)) throw new Error("CI_NATIVE_VIEWPORTS");
  return { bytes, text, sha256: digest(bytes), head: heads[0][1], layout, files };
}

function nativeImages(repoRoot, definition, evidence, expected) {
  return definition.files.map(file => {
    const info = evidence.imageInfo(boundedNativeFile(repoRoot, `${definition.directory}/${file}`));
    const width = Number(file.match(/-(1440|820|390)(?:-zh)?\.png$/)?.[1]);
    const viewport = definition.producer.VIEWPORTS[width];
    if (!viewport || info.width > viewport.width || info.height > viewport.height
        || (expected && info.sha256 !== expected[file])) throw new Error("CI_NATIVE_IMAGE_BINDING");
    return { file, ...info };
  });
}

function archiveNativePacket({ repoRoot, definition, diagnostics, captureId, checkout }) {
  const sourceRoot = path.join(repoRoot, definition.directory);
  const archiveRoot = path.join(diagnostics, `${captureId}.prior-packet`);
  fs.mkdirSync(archiveRoot, { recursive: false });
  const files = [];
  let total = 0;
  const visit = relative => {
    const directory = path.join(sourceRoot, relative);
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT" && !relative) return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("CI_NATIVE_HISTORY_PATH");
      if (entry.isDirectory()) { fs.mkdirSync(path.join(archiveRoot, child)); visit(child); continue; }
      const bytes = boundedNativeFile(repoRoot, `${definition.directory}/${child}`);
      total += bytes.length;
      if (total > 512 * 1024 * 1024 || files.length >= 4096) throw new Error("CI_NATIVE_HISTORY_BOUND");
      fs.writeFileSync(path.join(archiveRoot, child), bytes, { flag: "wx" });
      files.push({ file: child, bytes: bytes.length, sha256: digest(bytes) });
    }
  };
  visit("");
  const record = { originalLogicalBase: definition.directory, sourceCheckout: checkout,
    archiveRoot, files, bytes: total,
    referenceRule: "This byte-exact packet snapshot retains its original logical base; external repository references bind sourceCheckout. It never reinterprets historical references as the new root images." };
  fs.writeFileSync(path.join(diagnostics, `${captureId}.prior-packet.json`), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  // Removing only expected root outputs prevents an old PNG from satisfying a new capture.
  for (const file of definition.files) {
    try {
      boundedNativeFile(repoRoot, `${definition.directory}/${file}`);
      fs.unlinkSync(path.join(sourceRoot, file));
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return record;
}

function verifyNativeHistory(history) {
  for (const file of history.files) {
    const bytes = boundedNativeFile(history.archiveRoot, file.file);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error("CI_NATIVE_HISTORY_CHANGED");
  }
}

async function qualifyNativeEvidence({ repoRoot, env, evidence, checkout, spawnNative, diagnostics, ids, record, save }) {
  record.native = {};
  for (const family of ["eod", "gex"]) {
    const definition = nativeDefinition(family), captureId = `${ids.prefix}-${family}`;
    const controls = [definition.script, "terminal/e2e/tools/capture_ci_evidence.cjs"];
    const sources = nativeSources(repoRoot, definition.producer.LAYOUT_FILES), controlSources = nativeSources(repoRoot, controls);
    let before = null, reason = null, images;
    try {
      before = readNativePacket(repoRoot, definition);
      if (!same(before.layout, sources)) reason = "LAYOUT_SOURCE_CHANGED";
      else images = nativeImages(repoRoot, definition, evidence);
    } catch (error) {
      if ((error.code && error.code !== "ENOENT") || error.message === "CI_NATIVE_PATH") throw error;
      reason = error.message;
    }
    const state = record.native[family] = { state: reason ? "CAPTURE_REQUIRED" : "CURRENT", reason,
      priorManifestSha256: before?.sha256 || null, sources, controls: controlSources };
    if (!reason) { state.images = images; state.manifestSha256 = before.sha256; save(); continue; }
    state.history = archiveNativePacket({ repoRoot, definition, diagnostics, captureId, checkout: record.actualCheckout });
    // Even a malformed prior manifest is preserved and bound; no synthetic replacement is made.
    const prior = state.history.files.find(file => file.file === "EVIDENCE.yml");
    state.priorManifestSha256 = prior?.sha256 || null;
    const child = { packet: family, captureId, command: [process.execPath, definition.script.slice("terminal/".length)],
      state: "RUNNING", stdoutPath: path.join(diagnostics, `${captureId}.stdout.log`), stderrPath: path.join(diagnostics, `${captureId}.stderr.log`) };
    record.children.push(child); save();
    let out, err, result;
    try {
      out = fs.openSync(child.stdoutPath, "wx"); err = fs.openSync(child.stderrPath, "wx");
      result = await superviseNative(process.execPath, child.command.slice(1), {
        cwd: path.join(repoRoot, "terminal"), stdio: ["ignore", out, err, "ipc"],
        env: { ...env, CAPTURE_ONLY: "", UPDATE_HEATMAP_EVIDENCE: "", TERMINAL_CROP_OUTPUT_DIR: "", CAPTURE_HEAD: "",
          TERMINAL_CROP_PORT: definition.port, TERMINAL_NATIVE_CAPTURE_ID: captureId },
      }, { spawn: spawnNative, onState: value => { Object.assign(child, value); save(); } });
    } finally { if (out !== undefined) fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
    Object.assign(child, { state: result.closed && result.serverSettled ? "CLOSED" : "UNSETTLED", status: result.status,
      signal: result.signal, timedOut: result.timedOut, error: result.error?.message || null, errorCode: result.error?.code || null }); save();
    if (result.error || result.signal || result.status !== 0 || result.timedOut || !result.closed || !result.serverSettled) throw new Error("CI_NATIVE_CHILD_FAILED_OR_UNSETTLED");
    if (!same(checkout(repoRoot, env).actualCheckout, record.actualCheckout)
        || !same(nativeSources(repoRoot, definition.producer.LAYOUT_FILES), sources)
        || !same(nativeSources(repoRoot, controls), controlSources)) throw new Error("CI_NATIVE_SOURCE_CHANGED");
    verifyNativeHistory(state.history);
    const stdout = boundedNativeFile(diagnostics, path.basename(child.stdoutPath), 16 * 1024 * 1024).toString("utf8");
    const completions = stdout.split(/\r?\n/).filter(line => /^wrote \d+ crops \+ EVIDENCE\.yml /.test(line));
    if (completions.length !== 1 || completions[0] !== `wrote ${definition.count} crops + EVIDENCE.yml (head ${record.actualCheckout.commit})`) throw new Error("CI_NATIVE_COMPLETION");
    const receipts = stdout.split(/\r?\n/).flatMap(line => {
      try { const value = JSON.parse(line); return value && Object.hasOwn(value, "nativeEvidence") ? [value.nativeEvidence] : []; }
      catch { return []; }
    });
    if (receipts.length !== 1) throw new Error("CI_NATIVE_RECEIPT_COUNT");
    const receipt = receipts[0], after = readNativePacket(repoRoot, definition);
    if (!receipt || receipt.family !== family || receipt.captureId !== captureId || receipt.capturedAtHead !== record.actualCheckout.commit
        || after.head !== record.actualCheckout.commit || !same(after.layout, sources) || receipt.manifestSha256 !== after.sha256
        || !Array.isArray(receipt.files) || !sameNames(receipt.files.map(file => file?.file), definition.files)
        || receipt.files.some(file => !/^[0-9a-f]{64}$/.test(file.sha256 || ""))) throw new Error("CI_NATIVE_RESULT_BINDING");
    if (prior) {
      const historyFile = `EVIDENCE.history-${prior.sha256}.yml`;
      if (receipt.history?.file !== historyFile || receipt.history?.sha256 !== prior.sha256
          || !after.text.includes(`# priorManifest: ${historyFile}\n`) || !after.text.includes(`# priorManifestSha256: ${prior.sha256}\n`)
          || !boundedNativeFile(repoRoot, `${definition.directory}/${historyFile}`, 1024 * 1024)
            .equals(boundedNativeFile(state.history.archiveRoot, "EVIDENCE.yml", 1024 * 1024))) throw new Error("CI_NATIVE_HISTORY_BINDING");
    } else if (receipt.history !== null) throw new Error("CI_NATIVE_HISTORY_BINDING");
    state.images = nativeImages(repoRoot, definition, evidence, Object.fromEntries(receipt.files.map(file => [file.file, file.sha256])));
    state.state = "QUALIFIED"; state.manifestSha256 = after.sha256; save();
  }
  // The second producer may not stale the first packet or its source before selection.
  if (!same(checkout(repoRoot, env).actualCheckout, record.actualCheckout)) throw new Error("CI_NATIVE_SOURCE_CHANGED");
  for (const family of ["eod", "gex"]) {
    const definition = nativeDefinition(family), state = record.native[family];
    if (!same(nativeSources(repoRoot, Object.keys(state.sources)), state.sources)
        || !same(nativeSources(repoRoot, Object.keys(state.controls)), state.controls)) throw new Error("CI_NATIVE_SOURCE_CHANGED");
    if (readNativePacket(repoRoot, definition).sha256 !== state.manifestSha256) throw new Error("CI_NATIVE_MANIFEST_CHANGED");
    nativeImages(repoRoot, definition, evidence, Object.fromEntries(state.images.map(file => [file.file, file.sha256])));
  }
}

function superviseNative(command, args, options, { spawn = spawnAsync, deadlineMs = 18 * 60_000 + 45_000,
  graceMs = 45_000, killMs = 15_000, serverGraceMs = 8_000, serverKillMs = 5_000,
  onState = () => {}, kill = process.kill.bind(process), now = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  return new Promise(resolve => {
    let child, error = null, timedOut = false, settled = false;
    let serverPid = null, serverReportedStopped = false, serverRefused = null;
    const timers = [];
    const settleServer = async () => {
      if (serverRefused) return false;
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
      onState({ serverPid, serverReportedStopped, serverRefused, serverSettled });
      resolve({ status, signal, error, timedOut, closed, pid: child?.pid || null,
        serverPid, serverReportedStopped, serverRefused, serverSettled });
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
      if (settled || !message || !Object.hasOwn(message, "nativeCaptureServer")) return;
      const report = message.nativeCaptureServer;
      const identity = report && report.captureId === options.env?.TERMINAL_NATIVE_CAPTURE_ID
        && typeof report.captureId === "string" && report.captureId.length > 0
        && Number.isInteger(report.pid) && report.pid > 1 && report.pgid === report.pid
        && report.pid !== child.pid && report.pid !== process.pid;
      if (identity && report.phase === "refused" && report.pid === serverPid && !serverReportedStopped && !serverRefused
          && ["EPERM", "EACCES"].includes(report.code)) {
        serverRefused = report.code;
        error ||= Object.assign(new Error(`CI_NATIVE_SERVER_REFUSED: ${report.code}`), { code: report.code });
        onState({ serverPid, serverReportedStopped, serverRefused }); return;
      }
      if (!identity || serverRefused || (report.phase === "started" ? serverPid !== null
        : report.phase !== "stopped" || report.pid !== serverPid || serverReportedStopped)) {
        error ||= new Error("CI_NATIVE_SERVER_REPORT"); return;
      }
      if (report.phase === "started") serverPid = report.pid;
      else serverReportedStopped = true;
      onState({ serverPid, serverReportedStopped, serverRefused });
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
  evidence, spawn = spawnSync, spawnNative = spawnAsync, checkout = checkoutIdentity,
  qualifyNative = qualifyNativeEvidence } = {}) {
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
    await qualifyNative({ repoRoot, env, evidence, checkout, spawnNative, diagnostics, ids, record, save });
    // Recheck the incumbent composition after the longer native capture phase.
    evidence.readComposition({ repoRoot, compositionPath, expectedProfile: captureProfile });
    if (!fs.readFileSync(path.join(repoRoot, compositionPath)).equals(bytes)) throw new Error("CI_EVIDENCE_COMPOSITION_BYTES");
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
  (async () => {
    if (process.argv.length === 3 && process.argv[2] === "--checkout-only") recordCheckout();
    else if (process.argv.length === 2) await run();
    else throw new Error("CI_EVIDENCE_ARGUMENT");
  })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
module.exports = { operationIds, reference, checkoutIdentity, recordCheckout, run,
  NATIVE_PACKETS, nativeDefinition, boundedNativeFile, nativeSources, readNativePacket,
  nativeImages, archiveNativePacket, verifyNativeHistory, superviseNative, qualifyNativeEvidence };
