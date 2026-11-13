"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the real wrapper's main path; no operation, browser or process is launched.
const source = fs.readFileSync(path.join(__dirname, "capture_visual_evidence.cjs"), "utf8");
const flag = "--no-experimental-webstorage";
function invoke(callerEnv, allowedFlags) {
  const before = { ...callerEnv }, caller = Object.freeze({ ...callerEnv });
  let start, child;
  const op = { id: "ci-synthetic-vi", packet: "vi" };
  function mockRequire(name) {
    if (name === "node:path") return path;
    if (name === "node:child_process") return { spawnSync(command, args, options) {
      child = { command, args, options }; return { status: 0, signal: null };
    } };
    if (name === "./visualEvidence.cjs") return { beginOperation(options) { start = options; return op; } };
    throw new Error(`Unexpected dependency: ${name}`);
  }
  mockRequire.resolve = name => {
    assert.equal(name, "@playwright/test/cli"); return "/synthetic/playwright-cli.cjs";
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: mockRequire, __dirname: "/synthetic/terminal/e2e/tools",
    process: { env: caller, allowedNodeEnvironmentFlags: allowedFlags, execPath: "/synthetic/node" } });
  assert.equal(module.exports.main(["--id", op.id, "--port", "3537"]), op);
  assert.deepEqual(caller, before);
  assert.equal(start.env.TERMINAL_E2E_PORT, "3537");
  assert.equal(child.options.env.TERMINAL_E2E_PORT, "3537");
  assert.deepEqual(JSON.parse(child.options.env.TERMINAL_VISUAL_EVIDENCE_OPERATION), op);
  assert.equal(child.command, "/synthetic/node");
  assert.deepEqual(Array.from(child.args), ["/synthetic/playwright-cli.cjs", "test", "e2e/visual-evidence-capture.spec.ts",
    "--project=desktop", "--project=tablet", "--project=mobile", "--workers=1", "--retries=0",
    "--reporter=./e2e/tools/visualEvidenceReporter.cjs"]);
  return { start: start.env, child: child.options.env };
}

for (const [name, env, flags, expected] of [
  ["supported flag supplies default only when absent", { KEEP: "caller" }, new Set([flag]), flag],
  ["unsupported flag remains absent", { KEEP: "caller" }, new Set(), undefined],
  ["absent capability remains absent", { KEEP: "caller" }, undefined, undefined],
  ["explicit option retained on supported runtime", { NODE_OPTIONS: "--trace-warnings" }, new Set([flag]), "--trace-warnings"],
  ["explicit option retained on unsupported runtime", { NODE_OPTIONS: "--trace-warnings" }, new Set(), "--trace-warnings"],
  ["explicit option retained without capability", { NODE_OPTIONS: "--trace-warnings" }, undefined, "--trace-warnings"],
  ["explicit empty retained on unsupported runtime", { NODE_OPTIONS: "" }, new Set(), ""],
  ["explicit empty retained on supported runtime", { NODE_OPTIONS: "" }, new Set([flag]), ""],
  ["explicit empty retained without capability", { NODE_OPTIONS: "" }, undefined, ""],
]) test(name, () => {
  const result = invoke(env, flags);
  for (const actual of [result.start, result.child]) {
    assert.equal(actual.NODE_OPTIONS, expected);
    assert.equal(Object.hasOwn(actual, "NODE_OPTIONS"), expected !== undefined);
    if (env.KEEP) assert.equal(actual.KEEP, env.KEEP);
  }
});

test("explicit empty does not consult or override runtime capability", () => {
  const result = invoke({ NODE_OPTIONS: "" }, { has() { throw new Error("Capability must not be queried"); } });
  assert.equal(result.child.NODE_OPTIONS, "");
});
