"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Incumbent Node CJS reporter/tooling boundary. */
// A bounded projection of the incumbent Playwright Reporter callbacks. It never
// reads errors, stdout, annotations, attachment bodies or generated title text.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { checkoutIdentity } = require("./capture_ci_evidence.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const FILES = ["e2e/shared-shell-refinement.spec.ts", "e2e/intl-history-date-intent.spec.ts", "e2e/discover-focus-continuity.spec.ts"];
const PROJECTS = ["desktop", "tablet", "mobile"];
const STATUS = ["passed", "failed", "timedOut", "skipped", "interrupted"];
const OUTCOME = ["expected", "unexpected", "flaky", "skipped"];
const MAX = 128 * 1024;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (x, names) => x && !Array.isArray(x) && same(Object.keys(x).sort(), [...names].sort());
const integer = (x, max) => Number.isInteger(x) && x >= 0 && x <= max;
const stamp = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs];
function frame(root, env) {
  if (env.GITHUB_REPOSITORY !== "mastermindx-market-intelligence/mastermind-terminal"
    || env.GITHUB_WORKFLOW !== "CI" || env.GITHUB_JOB !== "terminal-e2e"
    || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || "")
    || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ATTEMPT || "")
    || !["pull_request", "merge_group", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) throw Error("SAFE_REPORT_BINDING");
  const identity = checkoutIdentity(root, env);
  if (identity.actualCheckout.commit !== env.GITHUB_SHA) throw Error("SAFE_REPORT_CHECKOUT");
  const sources = {};
  for (const file of [".github/workflows/ci.yml", "terminal/e2e/tools/sharedShellSafeReporter.cjs", ...FILES.map(x => "terminal/" + x)]) {
    const filename = path.join(root, file), s = fs.lstatSync(filename);
    if (!s.isFile() || s.size > 2 * 1024 * 1024) throw Error("SAFE_REPORT_SOURCE");
    sources[file] = hash(fs.readFileSync(filename));
  }
  return { schema: "terminal.shared-shell-run-binding.v1", runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT, event: env.GITHUB_EVENT_NAME,
    checkout: identity.actualCheckout, sources };
}
function caseIdentity(test, root) {
  const file = path.relative(path.join(root, "terminal"), test.location.file).split(path.sep).join("/");
  const project = test.parent.project()?.name, title = test.title;
  if (!FILES.includes(file) || !PROJECTS.includes(project) || typeof title !== "string" || Buffer.byteLength(title) > 8192) throw Error("SAFE_REPORT_CASE");
  // Hash the entire title, including generated/unbracketed identities. No title is disclosed.
  return { file, project, titleSha256: hash(title) };
}
function execution(cases) {
  const counts = { completed: 0, intentionallySkipped: 0, interrupted: 0, notRun: 0 };
  for (const c of cases) {
    const last = c.attempts[c.attempts.length - 1];
    if (!last) counts.notRun++;
    else if (last.status === "interrupted") counts.interrupted++;
    else if (last.status === "skipped") counts[c.expectedStatus === "skipped" ? "intentionallySkipped" : "notRun"]++;
    else counts.completed++;
  }
  return counts;
}
function facts(row) {
  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, unstarted: 0 };
  for (const c of row.cases) counts[c.attempts.length ? c.outcome : "unstarted"]++;
  const observedCaseCount = row.cases.filter(c => c.attempts.length).length;
  const attemptCount = row.cases.reduce((n, c) => n + c.attempts.length, 0);
  const complete = row.state === "complete";
  const verdict = !complete ? "incomplete" : row.runnerStatus === "passed" && row.bindingStable === true
    && row.frameworkErrorCount === 0 && counts.unexpected === 0 && counts.flaky === 0
    && row.cases.every(c => c.attempts.every(a => a.status === (c.outcome === "skipped" ? "skipped" : c.expectedStatus))) ? "passed" : "not_passed";
  return { observedCaseCount, attemptCount, caseCounts: counts, executionCounts: execution(row.cases), verdict };
}
class Recorder {
  constructor(binding) { this.binding = binding; this.cases = new Map(); this.errors = 0; this.ended = false; }
  begin(tests, root) {
    this.root = root;
    if (tests.length < 1 || tests.length > 128) throw Error("SAFE_REPORT_COUNT");
    const ids = new Set();
    for (const test of tests) {
      const id = caseIdentity(test, root), key = JSON.stringify(id);
      if (ids.has(key)) throw Error("SAFE_REPORT_DUPLICATE"); ids.add(key);
      this.cases.set(key, { ...id, expectedStatus: null, outcome: null, attempts: [] });
    }
  }
  endTest(test, result) {
    const row = this.cases.get(JSON.stringify(caseIdentity(test, this.root)));
    if (!row || !STATUS.includes(result.status) || !integer(result.retry, 5)
      || result.retry !== row.attempts.length || !["passed", "failed", "skipped"].includes(test.expectedStatus)) throw Error("SAFE_REPORT_RESULT");
    row.expectedStatus = test.expectedStatus;
    row.attempts.push({ status: result.status, retry: result.retry });
    const outcome = test.outcome();
    if (!OUTCOME.includes(outcome)) throw Error("SAFE_REPORT_OUTCOME"); row.outcome = outcome;
  }
  project(status = null, stable = null) {
    if (![null, "passed", "failed", "timedout", "interrupted"].includes(status)) throw Error("SAFE_REPORT_RUN_STATUS");
    const cases = [...this.cases.values()];
    const observed = execution(cases);
    const complete = this.ended && ["passed", "failed"].includes(status) && observed.notRun === 0 && observed.interrupted === 0;
    const row = { schema: "terminal.shared-shell-safe-result.v1", binding: this.binding,
      state: complete ? "complete" : "incomplete", runnerStatus: status,
      bindingStable: stable, frameworkErrorCount: this.errors, collected: cases.length, cases };
    return { ...row, ...facts(row) };
  }
}
function outputs(env, data) {
  if (!env.GITHUB_OUTPUT) throw Error("SAFE_REPORT_OUTPUT");
  fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(data).map(([k, v]) => k + "=" + v + "\n").join(""));
}
function directory(root, env) {
  if (!path.isAbsolute(env.RUNNER_TEMP || "")) throw Error("SAFE_REPORT_TEMP");
  if (![env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT].every(x => /^[1-9][0-9]{0,19}$/.test(x || ""))) throw Error("SAFE_REPORT_RUN_ID");
  return path.join(env.RUNNER_TEMP, "terminal-shared-shell-results", env.GITHUB_RUN_ID + "-" + env.GITHUB_RUN_ATTEMPT);
}
class Output {
  constructor(env) {
    this.env = env; this.dir = directory(null, env);
    const temp = fs.lstatSync(env.RUNNER_TEMP);
    if (!temp.isDirectory() || temp.uid !== process.getuid()) throw Error("SAFE_REPORT_TEMP");
    fs.mkdirSync(path.dirname(this.dir), { recursive: true, mode: 0o700 });
    const parent = fs.lstatSync(path.dirname(this.dir)); this.parent = parent;
    if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o022)) throw Error("SAFE_REPORT_PARENT");
    fs.mkdirSync(this.dir, { mode: 0o700 });
    this.owner = fs.lstatSync(this.dir); this.file = path.join(this.dir, "safe-results.json");
  }
  write(value) {
    const parent = fs.lstatSync(path.dirname(this.dir));
    if (!parent.isDirectory() || parent.dev !== this.parent.dev || parent.ino !== this.parent.ino) throw Error("SAFE_REPORT_PARENT");
    const dir = fs.lstatSync(this.dir);
    if (!dir.isDirectory() || dir.dev !== this.owner.dev || dir.ino !== this.owner.ino) throw Error("SAFE_REPORT_DIRECTORY");
    if (this.previous) {
      const old = fs.lstatSync(this.file);
      if (!old.isFile() || !same(stamp(old), this.previous)) throw Error("SAFE_REPORT_REPLACED");
    }
    const bytes = Buffer.from(JSON.stringify(value) + "\n"); if (bytes.length > MAX) throw Error("SAFE_REPORT_BOUND");
    const name = path.join(this.dir, "snapshot-" + crypto.randomBytes(8).toString("hex"));
    const fd = fs.openSync(name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    let now, s;
    try {
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); now = fs.lstatSync(this.dir);
      if (!now.isDirectory() || now.dev !== dir.dev || now.ino !== dir.ino) throw Error("SAFE_REPORT_DIRECTORY");
      fs.renameSync(name, this.file); s = fs.lstatSync(this.file);
      if (!s.isFile() || s.nlink !== 1 || !same(stamp(fs.fstatSync(fd)), stamp(s))) throw Error("SAFE_REPORT_REPLACED");
    } finally { fs.closeSync(fd); }
    this.previous = stamp(s);
    outputs(this.env, { safe_shared_shell_initialized: "true", safe_shared_shell_directory_dev: String(now.dev),
      safe_shared_shell_directory_ino: String(now.ino), safe_shared_shell_file_dev: String(s.dev),
      safe_shared_shell_file_ino: String(s.ino), safe_shared_shell_file_sha256: hash(bytes) });
  }
}
function validate(row, expected) {
  if (!keys(row, ["schema", "binding", "state", "runnerStatus", "bindingStable", "frameworkErrorCount", "collected", "cases", "observedCaseCount", "attemptCount", "caseCounts", "executionCounts", "verdict"])
    || row.schema !== "terminal.shared-shell-safe-result.v1" || !same(row.binding, expected)
    || !["complete", "incomplete"].includes(row.state) || ![null, "passed", "failed", "timedout", "interrupted"].includes(row.runnerStatus)
    || ![null, true, false].includes(row.bindingStable) || !integer(row.frameworkErrorCount, 1000000)
    || !Array.isArray(row.cases) || row.collected !== row.cases.length || !integer(row.collected, 128) || !row.collected) throw Error("SAFE_REPORT_SCHEMA");
  const seen = new Set();
  for (const c of row.cases) {
    if (!keys(c, ["file", "project", "titleSha256", "expectedStatus", "outcome", "attempts"])
      || !FILES.includes(c.file) || !PROJECTS.includes(c.project) || !/^[0-9a-f]{64}$/.test(c.titleSha256)
      || ![null, "passed", "failed", "skipped"].includes(c.expectedStatus) || ![null, ...OUTCOME].includes(c.outcome)
      || !Array.isArray(c.attempts) || c.attempts.length > 6) throw Error("SAFE_REPORT_CASE_SCHEMA");
    const id = JSON.stringify([c.file, c.project, c.titleSha256]); if (seen.has(id)) throw Error("SAFE_REPORT_DUPLICATE"); seen.add(id);
    c.attempts.forEach((a, i) => { if (!keys(a, ["status", "retry"]) || !STATUS.includes(a.status) || a.retry !== i) throw Error("SAFE_REPORT_ATTEMPT"); });
    if (c.attempts.length && (c.expectedStatus === null || c.outcome === null)) throw Error("SAFE_REPORT_MISSING_RESULT");
  }
  const observed = execution(row.cases);
  if (row.state === "complete" && (!["passed", "failed"].includes(row.runnerStatus) || observed.notRun || observed.interrupted)) throw Error("SAFE_REPORT_COMPLETENESS");
  const calculated = facts(row);
  if (!same({ observedCaseCount: row.observedCaseCount, attemptCount: row.attemptCount, caseCounts: row.caseCounts, executionCounts: row.executionCounts, verdict: row.verdict }, calculated)) throw Error("SAFE_REPORT_COUNTS");
  return { schema: row.schema, binding: expected, state: row.state, runnerStatus: row.runnerStatus,
    bindingStable: row.bindingStable, frameworkErrorCount: row.frameworkErrorCount, collected: row.collected,
    cases: row.cases.map(c => ({ file: c.file, project: c.project, titleSha256: c.titleSha256,
      expectedStatus: c.expectedStatus, outcome: c.outcome, attempts: c.attempts.map(a => ({ status: a.status, retry: a.retry })) })), ...calculated };
}
function publish(root, env) {
  const expected = frame(root, env), dir = directory(root, env), chain = [env.RUNNER_TEMP, path.dirname(dir), dir].map(p => {
    const s = fs.lstatSync(p); if (!s.isDirectory() || s.uid !== process.getuid() || (p !== env.RUNNER_TEMP && (s.mode & 0o022))) throw Error("SAFE_REPORT_CUSTODY"); return { p, dev: s.dev, ino: s.ino };
  });
  const numeric = ["SAFE_DIRECTORY_DEV", "SAFE_DIRECTORY_INO", "SAFE_FILE_DEV", "SAFE_FILE_INO"].map(k => {
    if (!/^[0-9]{1,20}$/.test(env[k] || "") || !Number.isSafeInteger(Number(env[k]))) throw Error("SAFE_REPORT_CUSTODY"); return Number(env[k]);
  });
  if (!same(numeric.slice(0, 2), [chain[2].dev, chain[2].ino])) throw Error("SAFE_REPORT_CUSTODY");
  const file = path.join(dir, "safe-results.json"), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let bytes;
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid() || before.nlink !== 1 || (before.mode & 0o022)
      || before.size > MAX || !same(numeric.slice(2), [before.dev, before.ino])) throw Error("SAFE_REPORT_CUSTODY");
    const buffer = Buffer.alloc(MAX + 1); let offset = 0;
    while (offset < buffer.length) { const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); if (!n) break; offset += n; }
    bytes = buffer.subarray(0, offset); const after = fs.fstatSync(fd), current = fs.lstatSync(file);
    if (bytes.length > MAX || !same(stamp(before), stamp(after)) || !same(stamp(after), stamp(current))) throw Error("SAFE_REPORT_CHANGED");
  } finally { fs.closeSync(fd); }
  if (!/^[0-9a-f]{64}$/.test(env.SAFE_FILE_SHA256 || "") || hash(bytes) !== env.SAFE_FILE_SHA256) throw Error("SAFE_REPORT_DIGEST");
  const row = JSON.parse(bytes.toString("utf8"));
  if (!bytes.equals(Buffer.from(JSON.stringify(row) + "\n"))) throw Error("SAFE_REPORT_ENCODING"); // Includes duplicate-key refusal.
  const projected = validate(row, expected);
  if (!["success", "failure", "cancelled", "skipped"].includes(env.SAFE_STEP_OUTCOME)) throw Error("SAFE_REPORT_STEP");
  for (const { p, dev, ino } of chain) { const s = fs.lstatSync(p); if (!s.isDirectory() || s.dev !== dev || s.ino !== ino) throw Error("SAFE_REPORT_CHANGED"); }
  if (!same(frame(root, env), expected)) throw Error("SAFE_REPORT_BINDING_CHANGED");
  const fresh = fs.mkdtempSync(path.join(env.RUNNER_TEMP, "terminal-shared-shell-upload-"));
  const before = fs.lstatSync(fresh), target = path.join(fresh, "safe-summary.json");
  if (!before.isDirectory() || before.uid !== process.getuid() || (before.mode & 0o077)) throw Error("SAFE_REPORT_DESTINATION");
  const out = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let written;
  try { fs.writeFileSync(out, JSON.stringify({ ...projected, stepOutcome: env.SAFE_STEP_OUTCOME }) + "\n"); fs.fsyncSync(out); written = fs.fstatSync(out); } finally { fs.closeSync(out); }
  const after = fs.lstatSync(fresh);
  const selected = fs.lstatSync(target);
  if (!after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino || !selected.isFile()
    || selected.uid !== process.getuid() || selected.nlink !== 1 || (selected.mode & 0o077)
    || !same(stamp(written), stamp(selected))) throw Error("SAFE_REPORT_DESTINATION");
  outputs(env, { safe_shared_shell_summary_path: target, safe_shared_shell_summary_ready: "true" }); return target;
}
class SharedShellSafeReporter {
  onBegin(_config, suite) {
    try { this.binding = frame(ROOT, process.env); outputs(process.env, { safe_shared_shell_initialized: "false" }); this.recorder = new Recorder(this.binding); this.recorder.begin(suite.allTests(), ROOT); this.output = new Output(process.env); this.output.write(this.recorder.project()); }
    catch { this.recorder = null; }
  }
  onTestEnd(test, result) { if (this.recorder) { try { this.recorder.endTest(test, result); } catch { this.recorder = null; } } }
  onError() {
    if (this.recorder) {
      this.recorder.errors++;
      if (this.recorder.ended) {
        try { this.output.write(this.recorder.project(this.lastStatus, same(frame(ROOT, process.env), this.binding))); }
        catch { try { outputs(process.env, { safe_shared_shell_initialized: "false" }); } catch { /* No metadata changes the test exit. */ } }
      }
    }
  }
  onEnd(result) {
    if (this.recorder) { try { this.recorder.ended = true; this.lastStatus = result.status; this.output.write(this.recorder.project(result.status, same(frame(ROOT, process.env), this.binding))); } catch { /* Original test exit is untouched; initial incomplete stays honest. */ } }
  }
}
module.exports = SharedShellSafeReporter;
module.exports.controls = { frame, caseIdentity, Recorder, Output, validate, publish, hash };
if (require.main === module) {
  try { if (process.argv.slice(2).join(" ") !== "--publish-safe-summary") throw Error("SAFE_REPORT_COMMAND"); publish(ROOT, process.env); }
  catch { console.log("Safe Shared Shell outcome summary unavailable; no upload readiness published."); }
}
