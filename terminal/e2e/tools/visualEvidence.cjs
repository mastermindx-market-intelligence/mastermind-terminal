"use strict";
// One prospective artifact contract for both incumbent visual packets. No latest pointer.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PNG } = require("pngjs");
const SOURCE_PATHS = require("./visualEvidenceSources.json");
const PACKETS = Object.freeze({ pl6: "terminal/docs/pr-crops/b-pl-6-batch-1", vi: "terminal/docs/pr-crops/terminal-visual-intelligence" });
const VIEWPORTS = Object.freeze({ desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } });
const TITLES = Object.freeze([
  "saved startup timeframe hydrates chart context without stale SSR attributes",
  "default context explains plotted bars, toggles original overlays, and persists choices",
  "classic candles retain descriptive context without pretending to paint them",
  "historical crosshair inspection stays on the selected bar without relabeling current calendar knowledge",
  "real candle colors stay attached to price after chart-layer settings overwrite base series data",
  "context can be restored through the existing chart settings without a new preference owner",
  "table and CSV expose the same actual 3D bars and numeric context as the plotted chart",
  "replay consumer excludes current-calendar events and future numeric rows across viewport sizes",
  "an unavailable calendar and a delayed outgoing symbol never become fabricated event context",
  "Chinese context uses text alongside regional colors and remains keyboard dismissible",
]);
const SURFACES = Object.freeze(["AnalysisWorkspace", "ChartChrome", "OptionsHubView", "SearchModal", "StockAnalysis"]);
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const O = fs.constants;
const DIR = O.O_RDONLY | O.O_DIRECTORY | O.O_NOFOLLOW;
const LIMIT = Object.freeze({ json: 8 * 1024 * 1024, image: 24 * 1024 * 1024, total: 256 * 1024 * 1024, source: 2 * 1024 * 1024 });
function fail(code) { throw new Error(code); }
function plain(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function canonical(x) { if (Array.isArray(x)) return JSON.stringify(x.map(v => JSON.parse(canonical(v)))); if (plain(x)) return JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k => [k, JSON.parse(canonical(x[k]))]))); return JSON.stringify(x); }
function equal(a, b) { return canonical(a) === canonical(b); }
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function safeRelative(p) { return typeof p === "string" && p.length < 512 && !p.includes("\\") && !path.isAbsolute(p) && p.split("/").every(x => /^[A-Za-z0-9_.()\[\]@-]+$/.test(x) && x !== "." && x !== ".."); }
function member(p) { if (!safeRelative(p) || p.includes("/")) fail("UNSAFE_MEMBER"); return p; }
// Python's native openat/dir_fd is used because macOS /dev/fd cannot address children.
// This is a synchronous bounded filesystem primitive, never a service or authority.
function io(root, relative, action, extra = {}) {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("/usr/bin/python3", ["-I", path.join(__dirname, "visualEvidenceFs.py")], { input: JSON.stringify({ root, relative, action, ...extra }) + "\n", encoding: "utf8", maxBuffer: 36 * 1024 * 1024 });
  if (result.error || result.signal) fail("ARTIFACT_IO_UNCERTAIN");
  let reply; try { reply = JSON.parse(result.stdout); } catch { fail("ARTIFACT_IO_UNCERTAIN"); }
  if (result.status !== 0 || !reply.ok) fail(reply.code || "ARTIFACT_IO_FAILED"); return reply.value;
}
function walk(root, relative) {
  if (relative && !safeRelative(relative)) fail("UNSAFE_PATH");
  const identity = io(root, relative, "directory");
  return { root, relative, identity, guard: () => { if (!equal(identity, io(root, relative, "directory"))) fail("DIRECTORY_REPLACED"); }, close() {} };
}
function read(d, name, maximum) { member(name); return Buffer.from(io(d.root, d.relative, "read", { name, maximum, identity: d.identity }), "base64"); }
function write(d, name, bytes) { member(name); if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMIT.image) fail("WRITE_BOUND"); io(d.root, d.relative, "write", { name, bytes: bytes.toString("base64"), identity: d.identity }); }
function exists(d, name) { return io(d.root, d.relative, "exists", { name, identity: d.identity }); }
function sourceSnapshot(repo) {
  // Complete incumbent union plus current runtime/fixture source membership. No causal narrowing.
  return io(repo, "", "snapshot", { paths: [...SOURCE_PATHS, "terminal/e2e/tools/visualEvidenceSources.json"] });
}
function profile(env = process.env) {
  const flag = name => { const v = env[name] || "0"; if (!["0", "1"].includes(v)) fail("PROFILE_FLAG"); return v; };
  return { fixture: "terminal-e2e.v1", buildMode: "next-dev", sharedShell: flag("MMX_SHARED_SHELL"), investorShellPreview: flag("MMX_INVESTOR_SHELL_PREVIEW"), theme: "dark" };
}
function key(packet, project, title, locale) { return `${packet}:${project}:${locale}:${title}`; }
function requirements(packet) {
  if (packet === "vi") return Object.keys(VIEWPORTS).flatMap(project => TITLES.map((title, i) => ({ key: key(packet, project, title, i === 9 ? "zh" : "en"), packet, project, title, file: "visual-intelligence.spec.ts", locale: i === 9 ? "zh" : "en", viewport: VIEWPORTS[project] })));
  if (packet === "pl6") return ["desktop", "mobile"].flatMap(project => ["en", "zh"].flatMap(locale => SURFACES.map(surface => ({ key: key(packet, project, `capture ${surface}`, locale), packet, project, title: `capture ${surface}`, file: "capture_pl6_batch1.cjs", locale, viewport: VIEWPORTS[project] }))));
  fail("UNKNOWN_PACKET");
}
function imageInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > LIMIT.image || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail("PNG_INVALID");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000) fail("PNG_BOUND");
  const png = PNG.sync.read(bytes, { checkCRC: true }); if (png.width !== width || png.height !== height || png.data.length !== width * height * 4) fail("PNG_INVALID");
  let first, variation = false;
  for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3]) { const c = png.data.readUInt32BE(i) >>> 8; if (first === undefined) first = c; else if (first !== c) variation = true; }
  if (!variation) fail("PNG_BLANK"); return { sha256: sha(bytes), width, height };
}
function composeCases({ operations, selections, requiredCases, currentSources, profile: expectedProfile }) {
  if (!Array.isArray(operations) || !Array.isArray(selections) || !Array.isArray(requiredCases)) fail("COMPOSITION_SHAPE");
  const ops = new Map();
  for (const op of operations) { if (!plain(op) || !ID.test(op.id || "") || ops.has(op.id) || !PACKETS[op.packet] || !Array.isArray(op.cases)) fail("COMPOSITION_SHAPE"); ops.set(op.id, op); }
  const required = new Map(requiredCases.map(c => [c.key, c])); if (required.size !== requiredCases.length) fail("DUPLICATE_CASE");
  const chosen = new Map();
  for (const s of selections) {
    if (!plain(s) || !ops.has(s.operationId) || !required.has(s.key)) fail("UNKNOWN_SELECTION");
    if (chosen.has(s.key)) fail("DUPLICATE_CASE");
    const op = ops.get(s.operationId), spec = required.get(s.key);
    if (!equal(op.sourceFiles, currentSources)) fail("SOURCE_MISMATCH"); if (!equal(op.profile, expectedProfile)) fail("PROFILE_MISMATCH");
    const matches = op.cases.filter(c => c.key === s.key); if (matches.length !== 1) fail("CASE_BINDING");
    const c = matches[0], e = c.execution, v = c.observation, im = c.image;
    if (c.packet !== op.packet || c.packet !== spec.packet || !e || e.file !== spec.file || e.title !== spec.title || e.project !== spec.project || e.status !== "passed" || e.expectedStatus !== "passed" || e.retry !== 0 || !Array.isArray(e.errors) || e.errors.length || c.locale !== spec.locale || !equal(c.viewport, spec.viewport) || !v || v.lang !== spec.locale || v.theme !== expectedProfile.theme || !equal(v.viewport, spec.viewport) || !im || !HASH.test(im.sha256 || "") || !safeRelative(im.path) || im.path.includes("/") || !im.path.endsWith(".png") || !Number.isInteger(im.width) || !Number.isInteger(im.height) || im.width < 1 || im.height < 1 || im.width > spec.viewport.width || im.height > spec.viewport.height || (spec.packet === "vi" && (im.width !== spec.viewport.width || im.height !== spec.viewport.height))) fail("CASE_BINDING");
    chosen.set(s.key, c);
  }
  if (chosen.size !== required.size) fail("MISSING_CASE");
  return [...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);
}
function beginOperation({ repoRoot, packet, operationId, env }) {
  if (!PACKETS[packet] || !ID.test(operationId || "")) fail("OPERATION_ID");
  const repo = fs.realpathSync(repoRoot); if (path.resolve(repoRoot) !== repo) fail("UNSAFE_DIRECTORY");
  io(repo, `${PACKETS[packet]}/operations`, "create_operation", { id: operationId });
  const relative = `${PACKETS[packet]}/operations/${operationId}`, d = walk(repo, relative);
  try {
    const start = { schema: "terminal.visual-operation-start.v1", id: operationId, packet, profile: profile(env), sourceFiles: sourceSnapshot(repo) };
    write(d, "start.json", Buffer.from(canonical(start))); return { repoRoot: repo, relative, id: operationId, packet, identity: d.identity };
  } finally { d.close(); }
}
function openOperation(repoRoot, relative, expectedIdentity, maximum = LIMIT.json) {
  if (!Object.values(PACKETS).some(p => relative.startsWith(`${p}/operations/`)) || relative.split("/").length !== 6 || !ID.test(path.basename(relative))) fail("OPERATION_PATH");
  const d = walk(repoRoot, relative);
  if (expectedIdentity && !equal(expectedIdentity, d.identity)) fail("DIRECTORY_REPLACED");
  try { const startBytes = read(d, "start.json", Math.min(LIMIT.json, maximum)); const start = JSON.parse(startBytes); if (start.schema !== "terminal.visual-operation-start.v1" || start.id !== path.basename(relative) || PACKETS[start.packet] !== relative.split("/operations/")[0]) fail("OPERATION_BINDING"); return { d, start, startBytes: startBytes.length }; } catch (e) { d.close(); throw e; }
}
function writePayload(op, name, bytes) { const { d } = openOperation(op.repoRoot, op.relative, op.identity); try { if (exists(d, "operation.json")) fail("OPERATION_COMPLETE"); write(d, member(name), bytes); } finally { d.close(); } }
function writeCase(op, spec, bytes, observation) {
  const digest = sha(Buffer.from(spec.key)).slice(0, 32), imageName = `case-${digest}.png`, observationName = `case-${digest}.json`;
  const image = { path: imageName, ...imageInfo(bytes) };
  const row = { key: spec.key, packet: spec.packet, locale: spec.locale, viewport: spec.viewport, image, observation };
  writePayload(op, imageName, bytes); writePayload(op, observationName, Buffer.from(canonical(row))); return { row, observationName };
}
function reportCases(report, packet) {
  if (packet === "pl6") {
    if (report.schema !== "terminal.pl6-execution.v1" || !Array.isArray(report.cases)) fail("REPORT_SHAPE"); return report.cases;
  }
  if (!Array.isArray(report.errors) || report.errors.length || !report.stats || report.stats.unexpected !== 0 || report.stats.skipped !== 0 || report.stats.flaky !== 0 || report.stats.expected < 1 || !Array.isArray(report.suites)) fail("REPORT_SHAPE");
  const rows = [];
  function visit(suite) { for (const spec of suite.specs || []) for (const t of spec.tests || []) {
    if (!Array.isArray(t.results) || t.results.length !== 1 || t.status !== "expected") fail("REPORT_RESULT");
    const result = t.results[0]; if (result.error || (result.errors || []).length) fail("REPORT_RESULT");
    rows.push({ file: path.basename(spec.file), title: spec.title, project: t.projectName, status: result.status, expectedStatus: t.expectedStatus, retry: result.retry, errors: result.errors || [], attachments: result.attachments || [] });
  } for (const child of suite.suites || []) visit(child); }
  report.suites.forEach(visit); if (rows.length !== report.stats.expected) fail("REPORT_COUNT"); return rows;
}
function finishOperation(op, report) {
  const { d, start } = openOperation(op.repoRoot, op.relative, op.identity);
  try {
    if (exists(d, "operation.json")) fail("OPERATION_COMPLETE");
    if (!equal(start.sourceFiles, sourceSnapshot(op.repoRoot))) fail("SOURCE_MISMATCH");
    const rows = reportCases(report, start.packet), cases = [], seen = new Set();
    for (const execution of rows) {
      if (execution.status !== "passed" || execution.expectedStatus !== "passed" || execution.retry !== 0 || (execution.errors || []).length) fail("REPORT_RESULT");
      const locale = start.packet === "vi" ? (execution.title === TITLES[9] ? "zh" : "en") : execution.locale;
      const k = key(start.packet, execution.project, execution.title, locale); if (seen.has(k)) fail("DUPLICATE_CASE"); seen.add(k);
      const name = `case-${sha(Buffer.from(k)).slice(0,32)}.json`, observedBytes = read(d, name, LIMIT.json), row = JSON.parse(observedBytes);
      if (row.key !== k || row.packet !== start.packet) fail("CASE_BINDING");
      if (start.packet === "vi" && !execution.attachments.some(a => a.name === `visual-evidence:${name}` && a.contentType === "application/json" && a.sha256 === sha(observedBytes) && a.bytes === observedBytes.length)) fail("REPORT_ATTACHMENT");
      if (start.packet === "pl6" && (!execution.observation || execution.observation.path !== name || execution.observation.sha256 !== sha(observedBytes))) fail("REPORT_ATTACHMENT");
      cases.push({ ...row, execution: { file: execution.file, title: execution.title, project: execution.project, status: execution.status, expectedStatus: execution.expectedStatus, retry: execution.retry, errors: execution.errors || [] } });
    }
    if (!cases.length) fail("REPORT_COUNT");
    const reportBytes = Buffer.from(canonical(report)); write(d, "report.json", reportBytes);
    const record = { ...start, schema: "terminal.visual-operation.v1", report: { path: "report.json", sha256: sha(reportBytes) }, cases };
    // Validate each actually executed case; completeness is the composition reader's separate duty.
    const specs = cases.map(c => ({ key: c.key, packet: c.packet, file: c.execution.file, title: c.execution.title, project: c.execution.project, locale: c.locale, viewport: c.viewport }));
    composeCases({ operations: [record], selections: cases.map(c => ({ operationId: record.id, key: c.key })), requiredCases: specs, currentSources: start.sourceFiles, profile: start.profile });
    for (const c of cases) { const actual = imageInfo(read(d, c.image.path, LIMIT.image)); if (!equal(actual, { sha256: c.image.sha256, width: c.image.width, height: c.image.height })) fail("PNG_BINDING"); }
    write(d, "operation.json", Buffer.from(canonical(record))); io(d.root, d.relative, "seal", { name: "operation.json", identity: d.identity });
    return { path: `${op.relative}/operation.json`, sha256: sha(Buffer.from(canonical(record))), operation: record };
  } finally { d.close(); }
}
function readOperation(repo, ref, budget) {
  if (!plain(ref) || !safeRelative(ref.path) || path.basename(ref.path) !== "operation.json" || !HASH.test(ref.sha256 || "")) fail("OPERATION_REFERENCE");
  const { d, start, startBytes } = openOperation(repo, path.dirname(ref.path), undefined, budget.remaining);
  budget.remaining -= startBytes;
  try {
    function bounded(name, cap) { const bytes = read(d, name, Math.min(cap, budget.remaining)); budget.remaining -= bytes.length; return bytes; }
    const bytes = bounded("operation.json", LIMIT.json); if (sha(bytes) !== ref.sha256) fail("OPERATION_HASH");
    const op = JSON.parse(bytes); if (op.schema !== "terminal.visual-operation.v1" || op.id !== start.id || op.packet !== start.packet || !equal(op.sourceFiles, start.sourceFiles) || !equal(op.profile, start.profile) || !Array.isArray(op.cases) || op.cases.length > 64 || !op.report || op.report.path !== "report.json" || !HASH.test(op.report.sha256 || "")) fail("OPERATION_BINDING");
    const reportBytes = bounded("report.json", LIMIT.json); if (sha(reportBytes) !== op.report.sha256) fail("REPORT_HASH");
    const actual = reportCases(JSON.parse(reportBytes), op.packet); if (actual.length !== op.cases.length) fail("REPORT_COUNT");
    for (const c of op.cases) {
      const e = actual.filter(e => e.file === c.execution?.file && e.title === c.execution?.title && e.project === c.execution?.project && (op.packet !== "pl6" || e.locale === c.locale));
      if (e.length !== 1 || !equal(Object.fromEntries(Object.keys(c.execution).map(k => [k, e[0][k]])), c.execution)) fail("CASE_REPORT_BINDING");
      const image = imageInfo(bounded(member(c.image.path), LIMIT.image)); if (!equal(image, { sha256: c.image.sha256, width: c.image.width, height: c.image.height })) fail("PNG_BINDING");
      const observedName = `case-${sha(Buffer.from(c.key)).slice(0,32)}.json`, observedBytes = bounded(observedName, LIMIT.json);
      if (op.packet === "vi" && !e[0].attachments.some(a => a.name === `visual-evidence:${observedName}` && a.contentType === "application/json" && a.sha256 === sha(observedBytes) && a.bytes === observedBytes.length)) fail("REPORT_ATTACHMENT");
      if (op.packet === "pl6" && (!e[0].observation || e[0].observation.path !== observedName || e[0].observation.sha256 !== sha(observedBytes))) fail("REPORT_ATTACHMENT");
      const observed = JSON.parse(observedBytes); if (!equal(observed, Object.fromEntries(Object.entries(c).filter(([k]) => k !== "execution")))) fail("CASE_OBSERVATION_BINDING");
    }
    return op;
  } finally { d.close(); }
}
function readComposition({ repoRoot, compositionPath, expectedProfile = profile() }) {
  const repo = fs.realpathSync(repoRoot), relative = path.relative(repo, path.resolve(repo, compositionPath));
  if (!safeRelative(relative) || !Object.values(PACKETS).some(p => path.dirname(relative) === p) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.composition\.json$/.test(path.basename(relative))) fail("COMPOSITION_PATH");
  const d = walk(repo, path.dirname(relative)); let bytes;
  try { bytes = read(d, path.basename(relative), LIMIT.json); } finally { d.close(); }
  const c = JSON.parse(bytes); if (c.schema !== "terminal.visual-composition.v1" || c.mode !== "records" || !ID.test(c.id || "") || path.basename(relative) !== `${c.id}.composition.json` || !Array.isArray(c.operations) || c.operations.length < 2 || c.operations.length > 64 || !Array.isArray(c.selections) || c.selections.length > 64 || !equal(c.profile, profile(c.profile?.sharedShell === "1" ? { MMX_SHARED_SHELL: "1", MMX_INVESTOR_SHELL_PREVIEW: c.profile.investorShellPreview } : { MMX_INVESTOR_SHELL_PREVIEW: c.profile?.investorShellPreview }))) fail("COMPOSITION_SHAPE");
  if (!equal(c.profile, expectedProfile)) fail("PROFILE_MISMATCH");
  const budget = { remaining: LIMIT.total - bytes.length }, ops = c.operations.map(ref => readOperation(repo, ref, budget));
  const requiredCases = [...requirements("pl6"), ...requirements("vi")];
  const cases = composeCases({ operations: ops, selections: c.selections, requiredCases, currentSources: sourceSnapshot(repo), profile: c.profile });
  return { id: c.id, cases, operations: ops };
}
function selectedComposition(repoRoot, env = process.env) {
  if (env.TERMINAL_EVIDENCE_COMPOSITION === undefined) {
    if (env.TERMINAL_EVIDENCE_MODE !== undefined && env.TERMINAL_EVIDENCE_MODE !== "legacy") fail("EVIDENCE_MODE");
    return null; // Bounded incumbent checks are retained verbatim by each reader.
  }
  if (!env.TERMINAL_EVIDENCE_COMPOSITION || (env.TERMINAL_EVIDENCE_MODE && env.TERMINAL_EVIDENCE_MODE !== "records")) fail("EVIDENCE_SELECTION");
  return readComposition({ repoRoot, compositionPath: env.TERMINAL_EVIDENCE_COMPOSITION, expectedProfile: profile(env) });
}
function writeComposition({ repoRoot, id, packet = "pl6", operations, selections, profile: captureProfile }) {
  if (!ID.test(id || "") || !PACKETS[packet]) fail("COMPOSITION_ID");
  const c = { schema: "terminal.visual-composition.v1", mode: "records", id, profile: captureProfile, operations, selections };
  const d = walk(repoRoot, PACKETS[packet]);
  try { write(d, `${id}.composition.json`, Buffer.from(canonical(c))); } finally { d.close(); }
  // Invalid explicit data stays immutable and ineligible; no legacy fallback or replacement.
  return readComposition({ repoRoot, compositionPath: `${PACKETS[packet]}/${id}.composition.json`, expectedProfile: captureProfile });
}
module.exports = { PACKETS, VIEWPORTS, TITLES, SURFACES, requirements, key, sha, canonical, profile, sourceSnapshot, imageInfo, composeCases, beginOperation, openOperation, writePayload, writeCase, finishOperation, readOperation, readComposition, selectedComposition, writeComposition };
