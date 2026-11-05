#!/usr/bin/env node
"use strict";
// CI orchestration only. The incumbent evidence reader owns all evidence validation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, spawn: spawnAsync, execFileSync } = require("node:child_process");

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameNames = (a, b) => same([...a].sort(), [...b].sort()) && new Set(a).size === a.length;
const sameMap = (a, b) => sameNames(Object.keys(a), Object.keys(b)) && Object.keys(a).every(key => a[key] === b[key]);
const OPTIONS_PACKET = "terminal/docs/pr-crops/options-level-axis-labels";
const OPTIONS_SOURCES = ["components/ChartPanel.tsx", "lib/optionsLevels.ts", "lib/priceTagPlacement.ts"];
const OPTIONS_FILES = ["desktop.png", "tablet.png", "mobile.png", "desktop-left-percentage.png", "desktop-compact.png"];
const CONTROL = "terminal/e2e/tools/capture_ci_evidence.cjs";

function captureRefusal(error) {
  return ["EPERM", "EACCES", "CAPTURE_AUTH_REFUSED"].includes(error?.code)
    || ["EPERM", "EACCES"].includes(error?.cause?.code);
}

function boundedFile(root, relative, limit = 24 * 1024 * 1024) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some(part => !part || part === "." || part === "..")) throw new Error("CI_CAPTURE_PATH");
  let current = root, stat;
  for (const part of relative.split("/")) {
    current = path.join(current, part); stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("CI_CAPTURE_SYMLINK");
  }
  if (!stat.isFile() || stat.size > limit) throw new Error("CI_CAPTURE_FILE_LIMIT");
  return fs.readFileSync(current);
}

function sourceDigests(repoRoot, names) {
  return Object.fromEntries([...names].sort().map(file => [file, sha256(boundedFile(repoRoot, file))]));
}

function snapshotPacket(repoRoot, relative) {
  const files = {};
  let total = 0;
  const walk = (directory, prefix = "") => {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("CI_CAPTURE_PACKET_DIRECTORY");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error("CI_CAPTURE_SYMLINK");
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name + "/");
      else {
        const bytes = boundedFile(repoRoot, relative + "/" + name);
        total += bytes.length;
        if (total > 256 * 1024 * 1024 || Object.keys(files).length >= 2048) throw new Error("CI_CAPTURE_PACKET_LIMIT");
        files[name] = { sha256: sha256(bytes), size: bytes.length };
      }
    }
  };
  walk(path.join(repoRoot, relative));
  return files;
}

function archivePacket(repoRoot, relative, destination) {
  const files = snapshotPacket(repoRoot, relative);
  fs.mkdirSync(destination, { recursive: false });
  for (const [file, expected] of Object.entries(files)) {
    const bytes = boundedFile(repoRoot, relative + "/" + file);
    if (sha256(bytes) !== expected.sha256) throw new Error("CI_CAPTURE_PACKET_CHANGED");
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: "wx" });
  }
  fs.writeFileSync(destination + ".json", JSON.stringify({ packet: relative, files }, null, 2) + "\n", { flag: "wx" });
  return { path: destination, files };
}

function legacyPackets() {
  return [
    ["analysis", "b-f11-10-analysis-theses-entry", "capture_b_f11_10_analysis_theses_entry.cjs", "3565"],
  ].map(([packet, directory, script, port]) => {
    const producer = require("./" + script); // Import-safe; --checkout-only never loads producers.
    return { packet, directory: "terminal/docs/pr-crops/" + directory, script: "e2e/tools/" + script, port,
      sources: producer.LAYOUT_FILES, files: producer.FILES,
      controls: [CONTROL, "terminal/e2e/tools/" + script, "terminal/next.config.ts"] };
  });
}

function readLegacyPacket(repoRoot, definition) {
  const bytes = boundedFile(repoRoot, definition.directory + "/EVIDENCE.yml", 512 * 1024);
  const text = bytes.toString("utf8"), heads = [...text.matchAll(/^# capturedAtHead: ([0-9a-f]{40})$/gm)];
  const section = name => {
    const parts = text.split("\n" + name + ":\n");
    if (parts.length !== 2) throw new Error("CI_LEGACY_MANIFEST_SECTION");
    return parts[1].split("\n").slice(0, parts[1].split("\n").findIndex(line => !line.startsWith("  ")) < 0
      ? undefined : parts[1].split("\n").findIndex(line => !line.startsWith("  ")));
  };
  const layout = {};
  for (const line of section("layoutFiles")) {
    const match = /^  ([^:]+): "([0-9a-f]{64})"$/.exec(line);
    if (!match || Object.hasOwn(layout, match[1])) throw new Error("CI_LEGACY_MANIFEST_LAYOUT");
    layout[match[1]] = match[2];
  }
  const files = section("files").map(line => {
    const match = /^  - ([a-zA-Z0-9_-]+\.png)$/.exec(line);
    if (!match) throw new Error("CI_LEGACY_MANIFEST_FILE");
    return match[1];
  });
  if (heads.length !== 1 || !sameNames(files, definition.files)) throw new Error("CI_LEGACY_MANIFEST_INVENTORY");
  return { bytes, sha256: sha256(bytes), head: heads[0][1], layout, files };
}

function emitLegacyReceipt({ packet, outputDir, files, capturedAtHead }) {
  const receipt = { captureId: process.env.TERMINAL_LEGACY_CAPTURE_ID || null, packet, capturedAtHead,
    manifestSha256: sha256(fs.readFileSync(path.join(outputDir, "EVIDENCE.yml"))),
    files: files.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(outputDir, file))) })) };
  console.log(JSON.stringify({ legacyEvidence: receipt }));
}

function readReceipt(stdout, key) {
  const receipts = stdout.split(/\r?\n/).flatMap(line => {
    try { const value = JSON.parse(line); return value && Object.hasOwn(value, key) ? [value[key]] : []; }
    catch { return []; }
  });
  if (receipts.length !== 1) throw new Error("CI_CAPTURE_RECEIPT_COUNT");
  return receipts[0];
}

function verifyReceipt(receipt, { captureId, commit, manifestSha256, files, repoRoot, directory, evidence }) {
  if (!receipt || receipt.captureId !== captureId || receipt.capturedAtHead !== commit
      || receipt.manifestSha256 !== manifestSha256 || !Array.isArray(receipt.files)
      || !sameNames(receipt.files.map(file => file?.file), files)) throw new Error("CI_CAPTURE_RECEIPT_BINDING");
  return receipt.files.map(file => {
    const info = evidence.imageInfo(boundedFile(repoRoot, directory + "/" + file.file));
    if (info.sha256 !== file.sha256) throw new Error("CI_CAPTURE_IMAGE_BINDING");
    return { file: file.file, ...info };
  });
}

async function qualifyLegacyPackets({ repoRoot, env, evidence, checkout, spawnLegacy, diagnostics, ids, record, save, captureDeadline }) {
  const definitions = legacyPackets();
  record.legacyPackets = {};
  const plans = definitions.map(definition => {
    const sources = sourceDigests(repoRoot, definition.sources), controls = sourceDigests(repoRoot, definition.controls);
    let before;
    try { before = readLegacyPacket(repoRoot, definition); }
    catch (error) {
      if (error.code !== "ENOENT" && !/^CI_LEGACY_MANIFEST_/.test(error.message)) throw error;
    }
    const current = before && sameMap(before.layout, sources);
    const state = { state: current ? "EXISTING_PACKET_AWAITING_UNIT_VALIDATION" : "CAPTURE_REQUIRED",
      sources, controls, priorManifestSha256: before?.sha256 || null };
    record.legacyPackets[definition.packet] = state;
    return { definition, state, required: !current };
  });
  save();
  for (const { definition, state, required } of plans) {
    if (!required) continue;
    const { packet, directory, script } = definition, captureId = `${ids.prefix}-${packet}`;
    state.prior = archivePacket(repoRoot, directory, path.join(diagnostics, captureId + ".prior"));
    const beforeProtected = Object.fromEntries(Object.entries(state.prior.files).filter(([name]) => packet === "analysis" && name.startsWith("history/")));
    if (packet === "analysis" && Object.keys(beforeProtected).length === 0) throw new Error("CI_LEGACY_HISTORY_MISSING");
    const child = { packet, command: [process.execPath, script], state: "RUNNING",
      stdoutPath: path.join(diagnostics, captureId + ".stdout.log"), stderrPath: path.join(diagnostics, captureId + ".stderr.log") };
    record.children.push(child); save();
    const deadlineMs = Math.min(8 * 60_000, captureDeadline - Date.now() - 90_000);
    if (deadlineMs <= 0) throw new Error("CI_CAPTURE_BUDGET_EXHAUSTED");
    let out, err, result;
    try {
      out = fs.openSync(child.stdoutPath, "wx"); err = fs.openSync(child.stderrPath, "wx");
      result = await superviseLegacy(process.execPath, [script], { cwd: path.join(repoRoot, "terminal"),
        env: { ...env, CAPTURE_ONLY: "", CAPTURE_HEAD: "", TERMINAL_CROP_OUTPUT_DIR: "",
          TERMINAL_CROP_PORT: definition.port, TERMINAL_LEGACY_CAPTURE_ID: captureId },
        stdio: ["ignore", out, err, "ipc"] },
      { spawn: spawnLegacy, deadlineMs, onState: value => { Object.assign(child, value); save(); } });
    } finally { if (out !== undefined) fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
    Object.assign(child, { state: result.closed && result.serverSettled ? "CLOSED" : "UNSETTLED", status: result.status,
      signal: result.signal, timedOut: result.timedOut, error: result.error?.message || null }); save();
    state.returned = archivePacket(repoRoot, directory, path.join(diagnostics, captureId + ".returned"));
    save();
    if (result.error || result.signal || result.status !== 0 || result.timedOut || !result.closed || !result.serverSettled)
      throw new Error("CI_LEGACY_CHILD_FAILED_OR_UNSETTLED");
    if (!same(checkout(repoRoot, env).actualCheckout, record.actualCheckout)
        || !sameMap(sourceDigests(repoRoot, definition.sources), state.sources)
        || !sameMap(sourceDigests(repoRoot, definition.controls), state.controls)) throw new Error("CI_LEGACY_SOURCE_CHANGED");
    const afterProtected = Object.fromEntries(Object.entries(state.returned.files).filter(([name]) => packet === "analysis" && name.startsWith("history/")));
    if (!same(beforeProtected, afterProtected)) throw new Error("CI_LEGACY_HISTORY_CHANGED");
    const after = readLegacyPacket(repoRoot, definition);
    const receipt = readReceipt(boundedFile(diagnostics, path.basename(child.stdoutPath), 16 * 1024 * 1024).toString("utf8"), "legacyEvidence");
    if (receipt.packet !== packet || after.head !== record.actualCheckout.commit || !sameMap(after.layout, state.sources))
      throw new Error("CI_LEGACY_CHECKOUT_BINDING");
    state.images = verifyReceipt(receipt, { captureId, commit: record.actualCheckout.commit,
      manifestSha256: after.sha256, files: definition.files, repoRoot, directory, evidence });
    state.manifestSha256 = after.sha256;
    state.receipt = receipt;
    state.state = "CAPTURED_AWAITING_UNIT_VALIDATION"; save();
  }
  if (!same(checkout(repoRoot, env).actualCheckout, record.actualCheckout)
      || plans.some(({ definition, state }) => !sameMap(sourceDigests(repoRoot, definition.sources), state.sources)
        || !sameMap(sourceDigests(repoRoot, definition.controls), state.controls))) throw new Error("CI_LEGACY_SOURCE_CHANGED");
}

function prepareOptions({ repoRoot, diagnostics, ids }) {
  const sources = sourceDigests(repoRoot, OPTIONS_SOURCES.map(file => "terminal/" + file));
  const controls = sourceDigests(repoRoot, [CONTROL, "terminal/e2e/tools/capture_pl6_batch1.cjs", OPTIONS_PACKET + "/capture.mjs", "terminal/next.config.ts"]);
  let manifest;
  try { manifest = JSON.parse(boundedFile(repoRoot, OPTIONS_PACKET + "/manifest.json", 1024 * 1024)); }
  catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  const required = !manifest || OPTIONS_SOURCES.some(file => manifest.sourceFiles?.[file] !== sources["terminal/" + file]);
  const result = { required, sources, controls, state: required ? "CAPTURE_REQUIRED" : "EXISTING_PACKET_AWAITING_UNIT_VALIDATION" };
  if (required) {
    result.prior = archivePacket(repoRoot, OPTIONS_PACKET, path.join(diagnostics, ids.prefix + "-options.prior"));
    if (!result.prior.files["coverage-audit-summary.json"]) throw new Error("CI_OPTIONS_AUDIT_MISSING");
  }
  return result;
}

function finishOptions({ repoRoot, diagnostics, ids, record, evidence }) {
  const state = record.optionsAxis;
  if (state.required) {
    if (!state.returned) throw new Error("CI_OPTIONS_RETURNED_ARCHIVE_MISSING");
    if (!same(state.prior.files["coverage-audit-summary.json"], state.returned.files["coverage-audit-summary.json"]))
      throw new Error("CI_OPTIONS_AUDIT_CHANGED");
  }
  if (!sameMap(sourceDigests(repoRoot, Object.keys(state.sources)), state.sources)
      || !sameMap(sourceDigests(repoRoot, Object.keys(state.controls)), state.controls)) throw new Error("CI_OPTIONS_SOURCE_CHANGED");
  const bytes = boundedFile(repoRoot, OPTIONS_PACKET + "/manifest.json", 1024 * 1024), manifest = JSON.parse(bytes);
  state.manifestSha256 = sha256(bytes);
  if (state.required) {
    const receipt = readReceipt(boundedFile(diagnostics, ids.pl6 + ".stdout.log", 16 * 1024 * 1024).toString("utf8"), "optionsEvidence");
    if (manifest.sourceHead !== record.actualCheckout.commit
        || !sameNames(Object.keys(manifest.sourceFiles || {}), OPTIONS_SOURCES)
        || OPTIONS_SOURCES.some(file => manifest.sourceFiles[file] !== state.sources["terminal/" + file])
        || !Array.isArray(manifest.captures) || !sameNames(manifest.captures.map(capture => capture.screenshot), OPTIONS_FILES))
      throw new Error("CI_OPTIONS_CHECKOUT_BINDING");
    state.images = verifyReceipt(receipt, { captureId: ids.prefix + "-options", commit: record.actualCheckout.commit,
      manifestSha256: state.manifestSha256, files: OPTIONS_FILES, repoRoot, directory: OPTIONS_PACKET, evidence });
    state.receipt = receipt;
    state.state = "CAPTURED_AWAITING_UNIT_VALIDATION";
  }
}

// PL6 retains its own server and drains its pipes while the existing Options
// producer runs. The native Options reader remains the content/proof authority.
async function captureOptions({ server, ownedServer, baseURL, terminal, env = process.env, spawn = spawnAsync }) {
  if (!ownedServer(server)) throw new Error("CI_OPTIONS_SERVER_NOT_READY");
  const result = await superviseLegacy(process.execPath, ["docs/pr-crops/options-level-axis-labels/capture.mjs"],
    { cwd: terminal, env: { ...env, BASE_URL: baseURL }, stdio: "inherit" },
    { spawn, serverRequired: false, deadlineMs: 10 * 60_000, graceMs: 15_000, killMs: 5_000 });
  if (result.error || result.signal || result.status !== 0 || result.timedOut || !result.closed)
    throw new Error("CI_OPTIONS_CHILD_FAILED_OR_UNSETTLED");
  if (!ownedServer(server)) throw new Error("CI_OPTIONS_SERVER_NOT_READY");
}

function startLegacyServer(root, port) {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
    HUB_REALTIME_QUOTES: "1",
    FLOW_FIXTURE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  const child = spawnAsync("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.closed = new Promise((resolve) => child.once("close", resolve));
  child.ready = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => reject(new Error(`dev server exited before readiness: ${code}/${signal || "none"}`)));
    const onData = (buf) => {
      const line = String(buf);
      if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
      if (/Ready in|✓ Ready/i.test(line)) { child.captureReady = true; resolve(); }
    };
    child.stdout.on("data", onData);
  });
  child.ready.catch(() => {}); // Awaiters still observe rejection; readiness may fail before the probe.
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function reportLegacyServer(child, phase, code) {
  if (typeof process.send !== "function") return; // Standalone capture owns its cleanup.
  const captureId = process.env.TERMINAL_LEGACY_CAPTURE_ID;
  if (!captureId || !Number.isInteger(child?.pid) || child.pid < 1) throw new Error("LEGACY_CAPTURE_SERVER_REPORT_IDENTITY");
  await bounded(new Promise((resolve, reject) => process.send({ legacyCaptureServer: {
    captureId, phase, pid: child.pid, pgid: child.pid, ...(code ? { code } : {}),
  } }, error => error ? reject(error) : resolve())), 2_000, "LEGACY_CAPTURE_SERVER_REPORT_UNSETTLED");
}

function stopLegacyServer(child, { kill = process.kill.bind(process), now = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  if (!child || !child.pid) return Promise.resolve();
  if (!Number.isInteger(child.pid) || child.pid < 1 || !child.closed || typeof child.closed.then !== "function") {
    return Promise.reject(new Error("LEGACY_CAPTURE_SERVER_IDENTITY_OR_CLOSE_MISSING"));
  }
  if (child.shutdown) return child.shutdown;
  child.shutdown = (async () => {
    const alive = () => {
      try { kill(-child.pid, 0); return true; }
      catch (error) { if (error.code === "ESRCH") return false; throw error; }
    };
    const signal = name => {
      try { kill(-child.pid, name); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    };
    const drain = async milliseconds => {
      const deadline = now() + milliseconds;
      while (alive() && now() < deadline) await wait(50);
      return !alive();
    };
    if (alive()) {
      signal("SIGTERM");
      if (!await drain(8_000)) {
        signal("SIGKILL");
        if (!await drain(5_000)) throw new Error("LEGACY_CAPTURE_SERVER_GROUP_UNSETTLED");
      }
    }
    await bounded(child.closed, 2_000, "LEGACY_CAPTURE_SERVER_CLOSE_UNSETTLED");
  })();
  return child.shutdown;
}

async function settleLegacyServer(child, { stop = stopLegacyServer, report = reportLegacyServer } = {}) {
  try { await stop(child); }
  catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      try { await report(child, "refused", error.code); }
      catch (reportError) { throw new AggregateError([error, reportError], "LEGACY_CAPTURE_SERVER_REFUSAL_REPORT_FAILED"); }
    }
    throw error;
  }
  await report(child, "stopped");
}


async function waitLegacyServer(child, url, timeoutMs) {
  await bounded(child.ready, timeoutMs, "dev server never printed Ready");
  const deadline = Date.now() + 60_000;
  let last = "not tried";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error("dev server exited during readiness");
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      last = String(res.status);
      if (child.exitCode !== null || child.signalCode) throw new Error("owned dev server exited during readiness");
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`CAPTURE_AUTH_REFUSED: ${res.status}`), { code: "CAPTURE_AUTH_REFUSED" });
      if (res.status === 200) return;
    } catch (err) {
      if (captureRefusal(err)) throw err;
      if (child.exitCode !== null || child.signalCode) throw err;
      last = err.cause?.code || err.name || err.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`owned dev server printed Ready but never answered (${last})`);
}


function superviseLegacy(command, args, options, { spawn = spawnAsync, deadlineMs = 8 * 60_000,
  graceMs = 45_000, killMs = 15_000, serverGraceMs = 8_000, serverKillMs = 5_000,
  serverRequired = true, onState = () => {}, kill = process.kill.bind(process), now = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  return new Promise(resolve => {
    let child, error = null, timedOut = false, settled = false;
    let serverPid = null, serverReportedStopped = false, serverRefused = null;
    const timers = [];
    const settleServer = async () => {
      if (!serverRequired) return true;
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
      if (settled || !message || !Object.hasOwn(message, "legacyCaptureServer")) return;
      const report = message.legacyCaptureServer;
      const identity = report && report.captureId === options.env?.TERMINAL_LEGACY_CAPTURE_ID
        && typeof report.captureId === "string" && report.captureId.length > 0
        && Number.isInteger(report.pid) && report.pid > 1 && report.pgid === report.pid
        && report.pid !== child.pid && report.pid !== process.pid;
      if (identity && report.phase === "refused" && report.pid === serverPid && !serverReportedStopped && !serverRefused
          && ["EPERM", "EACCES"].includes(report.code)) {
        serverRefused = report.code;
        error ||= Object.assign(new Error(`CI_LEGACY_SERVER_REFUSED: ${report.code}`), { code: report.code });
        onState({ serverPid, serverReportedStopped, serverRefused }); return;
      }
      if (!identity || serverRefused || (report.phase === "started" ? serverPid !== null
        : report.phase !== "stopped" || report.pid !== serverPid || serverReportedStopped)) {
        error ||= new Error("CI_LEGACY_SERVER_REPORT"); return;
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
  evidence, spawn = spawnSync, spawnLegacy = spawnAsync, checkout = checkoutIdentity } = {}) {
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
    const captureDeadline = Date.now() + 54 * 60_000;
    record.optionsAxis = prepareOptions({ repoRoot, diagnostics, ids });
    save();
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
    const refs = [];
    let pl6Error;
    try {
      refs.push(capture("pl6", ["e2e/tools/capture_pl6_batch1.cjs"], {
        TERMINAL_PL6_EVIDENCE_OPERATION_ID: ids.pl6, TERMINAL_CROP_PORT: "3536",
        TERMINAL_CI_OPTIONS_AXIS_CAPTURE: record.optionsAxis.required ? "1" : "0",
        TERMINAL_CI_OPTIONS_CAPTURE_ID: `${ids.prefix}-options`,
      }));
    } catch (error) { pl6Error = error; throw error; }
    finally {
      if (record.optionsAxis.required) {
        try { record.optionsAxis.returned = archivePacket(repoRoot, OPTIONS_PACKET, path.join(diagnostics, ids.prefix + "-options.returned")); }
        catch (error) {
          record.optionsAxis.archiveError = error.message;
          if (!pl6Error) throw error;
        } finally { save(); }
      }
    }
    finishOptions({ repoRoot, diagnostics, ids, record, evidence });
    save();
    refs.push(capture("vi", ["e2e/tools/capture_visual_evidence.cjs", "--id", ids.vi, "--port", "3537"], {}));
    await qualifyLegacyPackets({ repoRoot, env, evidence, checkout, spawnLegacy, diagnostics, ids, record, save, captureDeadline });
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

module.exports = { operationIds, reference, checkoutIdentity, recordCheckout, run,
  legacyPackets, readLegacyPacket, snapshotPacket, archivePacket, prepareOptions, finishOptions,
  qualifyLegacyPackets, emitLegacyReceipt, captureOptions, captureRefusal, superviseLegacy,
  startLegacyServer, stopLegacyServer, settleLegacyServer, reportLegacyServer, waitLegacyServer };
if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv.length === 3 && process.argv[2] === "--checkout-only") return recordCheckout();
    if (process.argv.length === 2) return run();
    throw new Error("CI_EVIDENCE_ARGUMENT");
  }).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
