"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS tooling controls; no app bundle. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFileSync } = require("node:child_process");
const Reporter = require("./sharedShellSafeReporter.cjs");
const { frame, Recorder, Output, validate, publish, hash } = Reporter.controls;
const ROOT = path.resolve(__dirname, "../../..");
function specimen(title = "authored case", project = "desktop", file = "shared-shell-refinement.spec.ts") {
  let outcome = "expected";
  return { title, location: { file: path.join(ROOT, "terminal/e2e", file) },
    parent: { project: () => ({ name: project }) }, expectedStatus: "passed",
    outcome: () => outcome, setOutcome: value => { outcome = value; } };
}
function run(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "shared-shell-reporter-test-")); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { RUNNER_TEMP: temp, GITHUB_OUTPUT: path.join(temp, "step-output"), GITHUB_REPOSITORY: "mastermindx-market-intelligence/mastermind-terminal",
    GITHUB_WORKFLOW: "CI", GITHUB_JOB: "terminal-e2e", GITHUB_RUN_ID: "101", GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() };
  fs.writeFileSync(env.GITHUB_OUTPUT, "");
  const binding = frame(ROOT, env), recorder = new Recorder(binding), item = specimen(); recorder.begin([item], ROOT);
  const output = new Output(env);
  const snapshot = value => { output.write(value); const fields = Object.fromEntries(fs.readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").map(s => s.split("=")));
    return { ...env, SAFE_DIRECTORY_DEV: fields.safe_shared_shell_directory_dev, SAFE_DIRECTORY_INO: fields.safe_shared_shell_directory_ino,
      SAFE_FILE_DEV: fields.safe_shared_shell_file_dev, SAFE_FILE_INO: fields.safe_shared_shell_file_ino, SAFE_FILE_SHA256: fields.safe_shared_shell_file_sha256, SAFE_STEP_OUTCOME: "success" }; };
  const complete = () => { recorder.endTest(item, { status: "passed", retry: 0 }); recorder.ended = true; return recorder.project("passed", true); };
  return { temp, env, binding, recorder, item, output, snapshot, complete };
}
test("missing onEnd, missing case and interrupted end never imply complete pass", () => {
  const a = specimen(), b = specimen("second"); const r = new Recorder({ source: "bound" }); r.begin([a, b], ROOT);
  assert.equal(r.project().verdict, "incomplete"); r.endTest(a, { status: "passed", retry: 0 }); r.ended = true;
  assert.equal(r.project("passed", true).verdict, "incomplete");
  r.endTest(b, { status: "interrupted", retry: 0 }); b.setOutcome("unexpected");
  assert.equal(r.project("interrupted", true).verdict, "incomplete");
});
test("unique cases, failed attempts, retries and skips remain distinct and truthful", () => {
  const a = specimen(), b = specimen("skip", "mobile"), r = new Recorder({}); r.begin([a, b], ROOT);
  a.setOutcome("unexpected"); r.endTest(a, { status: "failed", retry: 0 }); a.setOutcome("flaky"); r.endTest(a, { status: "passed", retry: 1 });
  b.expectedStatus = "skipped"; b.setOutcome("skipped"); r.endTest(b, { status: "skipped", retry: 0 }); r.ended = true;
  const row = r.project("passed", true); assert.equal(row.collected, 2); assert.equal(row.observedCaseCount, 2); assert.equal(row.attemptCount, 3);
  assert.deepEqual(row.caseCounts, { expected: 0, unexpected: 0, flaky: 1, skipped: 1, unstarted: 0 }); assert.equal(row.verdict, "not_passed");
  assert.deepEqual(row.cases[0].attempts, [{ status: "failed", retry: 0 }, { status: "passed", retry: 1 }]);
});
test("global errors and unstable binding cannot become passing summary", () => {
  const item = specimen(), r = new Recorder({}); r.begin([item], ROOT); r.endTest(item, { status: "passed", retry: 0 }); r.ended = true;
  const reporter = new Reporter(); reporter.recorder = r;
  reporter.onError(new Proxy({}, { get() { throw Error("private error must not be read"); } }));
  assert.equal(r.project("passed", true).verdict, "not_passed"); r.errors = 0; assert.equal(r.project("passed", false).verdict, "not_passed");
});
test("a stale or forged expected outcome never erases an actually failed attempt", () => {
  const item = specimen(), r = new Recorder({}); r.begin([item], ROOT);
  r.endTest(item, { status: "failed", retry: 0 }); r.ended = true;
  const row = r.project("passed", true); assert.equal(row.verdict, "not_passed"); assert.equal(validate(row, {}).verdict, "not_passed");
});
test("actual Playwright interrupted/skipped outcome mapping never means that the body ran", () => {
  const item = specimen(), r = new Recorder({}); r.begin([item], ROOT); item.setOutcome("skipped");
  r.endTest(item, { status: "interrupted", retry: 0 }); r.ended = true;
  const row = r.project("interrupted", true); assert.equal(row.verdict, "incomplete"); assert.equal(row.executionCounts.interrupted, 1);
  assert.equal(validate(row, {}).verdict, "incomplete");
  const b = specimen("not started"), other = new Recorder({}); other.begin([b], ROOT); b.setOutcome("skipped");
  other.endTest(b, { status: "skipped", retry: 0 }); other.ended = true;
  assert.equal(other.project("failed", true).executionCounts.notRun, 1); assert.equal(other.project("failed", true).state, "incomplete");
});
test("generated titles are always opaque and result payload getters are never touched", () => {
  for (const title of ["private_generated_unbracketed", "authored[private parameter]", "quoted\"private\nvalue"]) {
    const item = specimen(title), r = new Recorder({}); r.begin([item], ROOT);
    r.endTest(item, new Proxy({ status: "passed", retry: 0 }, { get(o, k) { if (!["status", "retry"].includes(k)) throw Error("private payload"); return o[k]; } }));
    r.ended = true; const s = JSON.stringify(r.project("passed", true)); assert(!s.includes("private")); assert(s.includes(hash(title)));
  }
});
test("finite projects/source files and retry sequence reject malformed or duplicate records", () => {
  for (const item of [specimen("x", "foreign"), specimen("x", "desktop", "private.spec.ts"), specimen("x".repeat(9000))]) assert.throws(() => new Recorder({}).begin([item], ROOT));
  const a = specimen(), b = specimen(); assert.throws(() => new Recorder({}).begin([a, b], ROOT));
  const r = new Recorder({}); r.begin([a], ROOT); assert.throws(() => r.endTest(a, { status: "passed", retry: 1 }));
});
test("strict projection rejects forged completeness/counts, unknown fields and source drift", t => {
  const x = run(t), row = x.complete(); assert.deepEqual(validate(row, x.binding), row);
  for (const change of [r => { r.collected++; }, r => { r.verdict = "incomplete"; }, r => { r.cases[0].attempts = []; },
    r => { r.private = "secret"; }, r => { r.cases[0].stdout = "secret"; }, r => { r.binding.runId = "102"; }]) {
    const bad = JSON.parse(JSON.stringify(row)); change(bad); assert.throws(() => validate(bad, x.binding));
  }
});
test("actual complete and incomplete snapshots publish only freshly projected safe files", t => {
  const x = run(t), env = x.snapshot(x.complete()), target = publish(ROOT, env), row = JSON.parse(fs.readFileSync(target));
  assert.equal(row.verdict, "passed"); assert.equal(row.stepOutcome, "success"); assert.notEqual(target, x.output.file);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(target)).mode & 0o777, 0o700);
  const y = run(t), incomplete = y.snapshot(y.recorder.project()); incomplete.SAFE_STEP_OUTCOME = "failure";
  const initial = JSON.parse(fs.readFileSync(publish(ROOT, incomplete))); assert.equal(initial.verdict, "incomplete"); assert.equal(initial.stepOutcome, "failure");
});
test("directory substitution and producer file symlink/inode/digest drift refuse readiness", t => {
  for (const variant of ["directory", "symlink", "inode", "digest"]) {
    const x = run(t), env = x.snapshot(x.complete()), outside = path.join(x.temp, "outside"); fs.writeFileSync(outside, "private sentinel");
    if (variant === "directory") { fs.renameSync(x.output.dir, x.output.dir + "-old"); fs.symlinkSync(x.output.dir + "-old", x.output.dir); }
    if (variant === "symlink") { fs.unlinkSync(x.output.file); fs.symlinkSync(outside, x.output.file); }
    if (variant === "inode") {
      const b = fs.readFileSync(x.output.file), retained = x.output.file + "-old";
      // Keep the original inode allocated so replacement cannot reuse it.
      fs.renameSync(x.output.file, retained); fs.writeFileSync(x.output.file, b, { mode: 0o600 });
      assert.notEqual(fs.statSync(x.output.file).ino, fs.statSync(retained).ino);
    }
    if (variant === "digest") fs.appendFileSync(x.output.file, "private");
    fs.writeFileSync(env.GITHUB_OUTPUT, ""); assert.throws(() => publish(ROOT, env)); assert(!fs.readFileSync(env.GITHUB_OUTPUT, "utf8").includes("ready")); assert.equal(fs.readFileSync(outside, "utf8"), "private sentinel");
  }
});
test("unknown producer JSON cannot leak even with matching custody metadata", t => {
  const x = run(t), bad = { ...x.complete(), private_payload: "private sentinel" }, env = x.snapshot(bad);
  fs.writeFileSync(env.GITHUB_OUTPUT, ""); assert.throws(() => publish(ROOT, env)); assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "");
});
test("producer snapshot marks only its own open FD, never a same-byte replacement inode", t => {
  const x = run(t), original = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { original(from, to); const bytes = fs.readFileSync(to); fs.unlinkSync(to); fs.writeFileSync(to, bytes, { mode: 0o600 }); };
    assert.throws(() => x.snapshot(x.complete())); assert(!fs.readFileSync(x.env.GITHUB_OUTPUT, "utf8").includes("initialized=true"));
  } finally { fs.renameSync = original; }
});
test("binding rejects wrong workflow/job/run/checkouts without arbitrary source disclosure", t => {
  const x = run(t);
  for (const [key, value] of [["GITHUB_JOB", "python"], ["GITHUB_WORKFLOW", "other"], ["GITHUB_SHA", "a".repeat(40)], ["GITHUB_RUN_ID", "../bad"]]) assert.throws(() => frame(ROOT, { ...x.env, [key]: value }));
  assert(!JSON.stringify(x.binding).includes("private"));
});
test("truncated JSON and forged complete/incomplete assertions cannot earn readiness", t => {
  const x = run(t), env = x.snapshot(x.complete());
  fs.writeFileSync(x.output.file, '{"schema":"terminal.shared-shell-safe-result.v1"');
  env.SAFE_FILE_SHA256 = hash(fs.readFileSync(x.output.file)); fs.writeFileSync(env.GITHUB_OUTPUT, "");
  assert.throws(() => publish(ROOT, env)); assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "");
  const r = new Recorder({}); r.begin([specimen()], ROOT); r.ended = true;
  const missing = r.project("passed", true); missing.state = "complete"; missing.verdict = "passed";
  assert.throws(() => validate(missing, {})); assert.throws(() => r.project("private-status"));
});
test("fresh output directory and target alias/inode substitution never follows a foreign sentinel", t => {
  for (const kind of ["directory", "file", "inode"]) {
    const x = run(t), env = x.snapshot(x.complete()), outside = path.join(x.temp, "foreign"); fs.mkdirSync(outside, { mode: 0o700 });
    const sentinel = path.join(outside, "sentinel"); fs.writeFileSync(sentinel, "private unchanged");
    const originalMkdir = fs.mkdtempSync, originalOpen = fs.openSync, originalWrite = fs.writeFileSync;
    try {
      if (kind === "directory") fs.mkdtempSync = prefix => { const dir = originalMkdir(prefix); fs.rmdirSync(dir); fs.symlinkSync(outside, dir); return dir; };
      else if (kind === "file") fs.openSync = (file, ...args) => { if (String(file).endsWith("/safe-summary.json")) fs.symlinkSync(sentinel, file); return originalOpen(file, ...args); };
      else {
        let fresh;
        fs.mkdtempSync = prefix => { fresh = originalMkdir(prefix); return fresh; };
        fs.writeFileSync = (file, ...args) => { const result = originalWrite(file, ...args); if (typeof file === "number" && fresh) {
          fs.renameSync(fresh, fresh + "-old"); fs.mkdirSync(fresh, { mode: 0o700 }); fs.symlinkSync(sentinel, path.join(fresh, "safe-summary.json"));
        } return result; };
      }
      fs.writeFileSync(env.GITHUB_OUTPUT, ""); assert.throws(() => publish(ROOT, env));
      assert(!fs.readFileSync(env.GITHUB_OUTPUT, "utf8").includes("ready")); assert.equal(fs.readFileSync(sentinel, "utf8"), "private unchanged");
    } finally { fs.mkdtempSync = originalMkdir; fs.openSync = originalOpen; fs.writeFileSync = originalWrite; }
  }
});
test("the workflow preserves GitHub reporting, selection and the original responsive artifact", () => {
  const text = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert(text.includes("npm run test:e2e:responsive -- e2e/shared-shell-refinement.spec.ts e2e/intl-history-date-intent.spec.ts\n          --project=desktop --project=tablet --project=mobile\n          --workers=1 --retries=0\n          --output=test-results/shared-shell-refinement\n          --reporter=github,./e2e/tools/sharedShellSafeReporter.cjs"));
  assert(text.includes("steps.safe_shared_shell_summary.outcome == 'success' && steps.safe_shared_shell_summary.outputs.safe_shared_shell_summary_ready == 'true'"));
  assert(text.includes("name: responsive-qa-${{ github.run_id }}-${{ matrix.shard }}\n          path: terminal/test-results"));
  assert(text.includes("scripts/ci/plan-evidence-capture.test.cjs e2e/tools/sharedShellSafeReporter.test.cjs"));
});
