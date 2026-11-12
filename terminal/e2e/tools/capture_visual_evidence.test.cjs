"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the real wrapper's main path; no operation, browser or process is launched.
const source = fs.readFileSync(path.join(__dirname, "capture_visual_evidence.cjs"), "utf8");
const fontFixture = require("./retainedFontFixture.cjs");
const evidenceContract = require("./visualEvidence.cjs");
const flag = "--no-experimental-webstorage";
const VIEWPORTS = { desktop: {}, tablet: {}, mobile: {} };
function load(callerEnv = {}) {
  let start, child;
  const op = { id: "ci-synthetic-vi", packet: "vi" };
  function mockRequire(name) {
    if (name === "node:path") return path;
    if (name === "node:child_process") return { spawnSync(command, args, options) {
      child = { command, args, options }; return { status: 0, signal: null };
    } };
    if (name === "./visualEvidence.cjs") return { VIEWPORTS, fonts: fontFixture, captureEnvironment: evidenceContract.captureEnvironment, beginOperation(options) { start = options; return op; } };
    throw new Error(`Unexpected dependency: ${name}`);
  }
  mockRequire.resolve = () => "/synthetic/playwright-cli.cjs";
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: mockRequire, __dirname: "/synthetic/terminal/e2e/tools",
    process: { env: Object.freeze({ ...callerEnv }), allowedNodeEnvironmentFlags: undefined, execPath: "/synthetic/node" } });
  return { main: module.exports.main, started: () => start, child: () => child };
}
function invoke(callerEnv, allowedFlags, expectedError) {
  const before = { ...callerEnv }, caller = Object.freeze({ ...callerEnv });
  let start, child;
  const op = { id: "ci-synthetic-vi", packet: "vi" };
  function mockRequire(name) {
    if (name === "node:path") return path;
    if (name === "node:child_process") return { spawnSync(command, args, options) {
      child = { command, args, options }; return { status: 0, signal: null };
    } };
    if (name === "./visualEvidence.cjs") return { VIEWPORTS, fonts: fontFixture, captureEnvironment: evidenceContract.captureEnvironment, beginOperation(options) { start = options; return op; } };
    throw new Error(`Unexpected dependency: ${name}`);
  }
  mockRequire.resolve = name => {
    assert.equal(name, "@playwright/test/cli"); return "/synthetic/playwright-cli.cjs";
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: mockRequire, __dirname: "/synthetic/terminal/e2e/tools",
    process: { env: caller, allowedNodeEnvironmentFlags: allowedFlags, execPath: "/synthetic/node" } });
  if (expectedError) {
    assert.throws(() => module.exports.main(["--id", op.id, "--port", "3537"]), expectedError);
    assert.equal(start, undefined);
    assert.equal(child, undefined);
    assert.deepEqual(caller, before);
    return;
  }
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


test("retained font preparation reaches both operation and child without changing the caller", () => {
  const result = invoke({ TERMINAL_EVIDENCE_FONTS: fontFixture.ID, KEEP: "caller" }, new Set());
  for (const actual of [result.start, result.child]) {
    assert.ok(actual.NEXT_FONT_GOOGLE_MOCKED_RESPONSES.endsWith("retained-fonts-34fb/responses.cjs"));
    assert.equal(actual.KEEP, "caller");
  }
});
test("no font declaration invents no mock-response override", () => {
  const result = invoke({ KEEP: "caller" }, new Set());
  for (const actual of [result.start, result.child]) assert.equal(Object.hasOwn(actual, "NEXT_FONT_GOOGLE_MOCKED_RESPONSES"), false);
});
test("font binding refusal precedes VI operation and child creation", () => {
  invoke({ TERMINAL_EVIDENCE_FONTS: "foreign" }, new Set(), /FONT_FIXTURE_BINDING/);
});
for (const compiler of ["", "turbopack"]) test("VI refuses supplied compiler before any effect: " + JSON.stringify(compiler), () => {
  invoke({ TERMINAL_EVIDENCE_COMPILER: compiler }, new Set(), /CAPTURE_COMPILER_UNSUPPORTED/);
});

// Run the actual PL6 entrypoint until its existing wait boundary, with only
// filesystem/process/browser boundaries replaced. No server or artifact is created.
const pl6Source = fs.readFileSync(path.join(__dirname, "capture_pl6_batch1.cjs"), "utf8");
async function invokePl6(callerEnv, expectedError) {
  const env = { ...callerEnv, TERMINAL_PL6_EVIDENCE_OPERATION_ID: "synthetic-pl6" };
  const effects = { operations: 0, launches: [], settled: [] };
  const child = { pid: 1, exitCode: null, signalCode: null, captureReady: true };
  function mockRequire(name) {
    if (name === "node:path") return path;
    if (name === "node:crypto") return require("node:crypto");
    if (name === "node:fs") return { ...fs, mkdirSync() { throw new Error("NO_FILESYSTEM_WRITE"); } };
    if (name === "node:child_process") return { execFileSync(command, args, options) {
      assert.equal(command, "git");
      assert.deepEqual(Array.from(args), ["rev-parse", "HEAD"]);
      assert.equal(options.cwd, "/synthetic/terminal");
      return "f".repeat(40);
    } };
    if (name === "@playwright/test") return { chromium: { launch() { throw new Error("NO_BROWSER_LAUNCH"); } }, expect() { throw new Error("NO_BROWSER_ASSERTION"); } };
    if (name === "../fixtureWarmup.cjs") return { warmFixtureRoutes() { throw new Error("NO_ROUTE_WARMUP"); } };
    if (name === "./visualEvidence.cjs") return { fonts: fontFixture, captureEnvironment: evidenceContract.captureEnvironment, beginOperation() {
      effects.operations++; return { id: "synthetic-pl6", packet: "pl6" };
    } };
    if (name === "./fixtureServerWait.cjs") return { async waitForFixtureServer() { throw new Error("STOP_BEFORE_BROWSER"); } };
    if (name === "./capture_ci_evidence.cjs") return {
      startLegacyServer(root, port) { effects.launches.push({ root, port, env: { ...env } }); return child; },
      async settleLegacyServer(value) { effects.settled.push(value); },
      captureOptions() { throw new Error("NO_OPTIONS_CAPTURE"); },
    };
    throw new Error("Unexpected dependency: " + name);
  }
  const module = { exports: {} };
  const main = vm.runInNewContext(pl6Source + "\n; main;", { module, require: mockRequire,
    __dirname: "/synthetic/terminal/e2e/tools", process: { env }, console });
  await assert.rejects(main(), expectedError || /STOP_BEFORE_BROWSER/);
  if (expectedError) {
    assert.equal(effects.operations, 0);
    assert.equal(effects.launches.length, 0);
    assert.equal(effects.settled.length, 0);
  } else {
    assert.equal(effects.operations, 1);
    assert.equal(effects.launches.length, 1);
    assert.equal(effects.launches[0].root, "/synthetic/terminal");
    assert.equal(effects.launches[0].port, 3536);
    assert.equal(effects.settled.length, 1);
    assert.equal(effects.settled[0], child);
  }
  return effects;
}
test("PL6 forwards validated retained fonts to the unchanged launcher and settles its same child", async () => {
  const effects = await invokePl6({ TERMINAL_EVIDENCE_FONTS: fontFixture.ID, KEEP: "caller" });
  assert.ok(effects.launches[0].env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES.endsWith("retained-fonts-34fb/responses.cjs"));
  assert.equal(effects.launches[0].env.KEEP, "caller");
});
test("PL6 without declared fonts invents no override", async () => {
  const effects = await invokePl6({ KEEP: "caller" });
  assert.equal(Object.hasOwn(effects.launches[0].env, "NEXT_FONT_GOOGLE_MOCKED_RESPONSES"), false);
});
test("PL6 font binding refusal precedes operation and launcher", async () => {
  await invokePl6({ TERMINAL_EVIDENCE_FONTS: "foreign" }, /FONT_FIXTURE_BINDING/);
});
for (const compiler of ["", "turbopack"]) test("PL6 refuses supplied compiler before any effect: " + JSON.stringify(compiler), async () => {
  await invokePl6({ TERMINAL_EVIDENCE_COMPILER: compiler }, /CAPTURE_COMPILER_UNSUPPORTED/);
});

function selectedByInstalledNext(env) {
  const parser = require.resolve("next/dist/lib/bundler");
  const code = "const n=require(process.argv[1]); const selected=n.parseBundlerArgs({}); console.log(JSON.stringify({selected,fromEnv:n.getBundlerFromEnv(),name:n.bundlerName(selected),turbopack:process.env.TURBOPACK??null}));";
  const result = require("node:child_process").spawnSync(process.execPath, ["-e", code, parser], {
    cwd: path.resolve(__dirname, "../.."), env: { ...env }, encoding: "utf8",
  });
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test("VI declared Webpack reaches the actual installed Next selector with retained fonts", () => {
  const result = invoke({ TERMINAL_EVIDENCE_COMPILER: "webpack", TERMINAL_EVIDENCE_FONTS: fontFixture.ID, KEEP: "caller" }, new Set());
  for (const env of [result.start, result.child]) {
    assert.equal(env.IS_WEBPACK_TEST, "1");
    assert.equal(env.TERMINAL_EVIDENCE_COMPILER, "webpack");
    assert.ok(env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES.endsWith("retained-fonts-34fb/responses.cjs"));
    assert.deepEqual(selectedByInstalledNext(env), { selected: 1, fromEnv: 1, name: "webpack", turbopack: null });
  }
});
test("PL6 declared Webpack reaches the actual installed Next selector through the incumbent launcher", async () => {
  const result = await invokePl6({ TERMINAL_EVIDENCE_COMPILER: "webpack", TERMINAL_EVIDENCE_FONTS: fontFixture.ID });
  const env = result.launches[0].env;
  assert.equal(env.IS_WEBPACK_TEST, "1");
  assert.equal(env.TERMINAL_EVIDENCE_COMPILER, "webpack");
  assert.ok(env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES.endsWith("retained-fonts-34fb/responses.cjs"));
  assert.deepEqual(selectedByInstalledNext(env), { selected: 1, fromEnv: 1, name: "webpack", turbopack: null });
});
test("undeclared default preserves the installed Next default without selecting Webpack", async () => {
  const vi = invoke({ KEEP: "caller" }, new Set());
  const pl6 = await invokePl6({ KEEP: "caller" });
  for (const env of [vi.start, vi.child, pl6.launches[0].env]) {
    assert.equal(Object.hasOwn(env, "IS_WEBPACK_TEST"), false);
    assert.deepEqual(selectedByInstalledNext(env), { selected: 0, fromEnv: 0, name: "Turbopack", turbopack: "auto" });
  }
});
for (const name of ["TURBOPACK", "IS_TURBOPACK_TEST", "NEXT_RSPACK", "NEXT_TEST_USE_RSPACK"]) {
  for (const value of ["1", "0"]) test("both wrappers refuse conflicting compiler selector " + name + "=" + value + " before effects", async () => {
    const env = { TERMINAL_EVIDENCE_COMPILER: "webpack", [name]: value };
    invoke(env, new Set(), /CAPTURE_COMPILER_CONFLICT/);
    await invokePl6(env, /CAPTURE_COMPILER_CONFLICT/);
  });
}
for (const value of ["1", "0"]) test("both wrappers refuse undeclared Webpack selector " + value + " before effects", async () => {
  invoke({ IS_WEBPACK_TEST: value }, new Set(), /CAPTURE_COMPILER_UNDECLARED/);
  await invokePl6({ IS_WEBPACK_TEST: value }, /CAPTURE_COMPILER_UNDECLARED/);
});

test("a viewport shard runs exactly one Playwright project in its own operation", () => {
  for (const project of ["desktop", "tablet", "mobile"]) {
    const w = load();
    w.main(["--id", "ci-1-1-vi-" + project, "--port", "3537", "--project", project]);
    const args = Array.from(w.child().args);
    assert.deepEqual(args.filter(arg => arg.startsWith("--project=")), [`--project=${project}`]);
    assert.equal(w.started().operationId, "ci-1-1-vi-" + project);
  }
});

test("an unknown, repeated or empty project is refused before any operation starts", () => {
  for (const argv of [["--project", "watch"], ["--project", "desktop", "--project", "tablet"], ["--project", ""],
    ["--project", "__proto__"]]) {
    const w = load();
    assert.throws(() => w.main(["--id", "ci-1-1-vi-x", "--port", "3537", ...argv]), /EVIDENCE_ARGUMENT/);
    assert.equal(w.started(), undefined); assert.equal(w.child(), undefined);
  }
});
