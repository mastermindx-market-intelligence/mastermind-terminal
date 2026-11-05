/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS contract tests execute the canonical CJS capture tool. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertNoCaptureDotenv, captureServerEnv } = require("./capture_b_f11_10_analysis_theses_entry.cjs");

test("fixture child never inherits provider credentials, auth controls, NODE_OPTIONS or host flags", () => {
  const env = captureServerEnv({ PATH: "/bin", HOME: "/fixture", TIINGO_TOKEN: "not-a-real-token", BRAIN_GATEWAY_URL: "https://unexpected.invalid", NEXT_PUBLIC_SUPABASE_URL: "https://unexpected.invalid", NODE_OPTIONS: "--require /unexpected", MMX_SHARED_SHELL: "1", TERMINAL_REQUIRE_AUTH: "1" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, "/fixture");
  for (const name of ["TIINGO_TOKEN", "BRAIN_GATEWAY_URL", "NODE_OPTIONS"]) assert.equal(Object.hasOwn(env, name), false);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "fixture-anon-key");
  assert.equal(env.MMX_SHARED_SHELL, "0");
  assert.equal(env.MMX_INVESTOR_SHELL_PREVIEW, "0");
  assert.equal(env.TERMINAL_REQUIRE_AUTH, "0");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.CI, "1");
  assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
});

test("each Next development dotenv entrance refuses before any values are read", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f11-dotenv-contract-"));
  try {
    assert.doesNotThrow(() => assertNoCaptureDotenv(root));
    for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
      fs.writeFileSync(path.join(root, name), "NEVER_READ_THIS_VALUE=fixture");
      assert.throws(() => assertNoCaptureDotenv(root), { message: "F11_DOTENV_PRESENT" });
      fs.unlinkSync(path.join(root, name));
    }
    fs.symlinkSync(path.join(root, "absent"), path.join(root, ".env.local"));
    assert.throws(() => assertNoCaptureDotenv(root), { message: "F11_DOTENV_PRESENT" });
    fs.unlinkSync(path.join(root, ".env.local"));
    fs.mkdirSync(path.join(root, ".env"));
    assert.throws(() => assertNoCaptureDotenv(root), { message: "F11_DOTENV_PRESENT" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const { installCaptureBoundary } = require("./capture_b_f11_10_analysis_theses_entry.cjs");
function contextDouble() {
  const registered = {};
  return { registered, routeWebSocket: async (pattern, callback) => { registered.socket = callback; }, route: async (pattern, callback) => { registered.request = callback; } };
}
function requestDouble(url, type, status = 200) {
  const calls = [];
  const response = { status: () => status };
  return { calls, request: () => ({ url: () => url, method: () => "GET", resourceType: () => type }), fetch: async options => { calls.push(["fetch", options]); return response; }, fulfill: async options => { calls.push(["fulfill", options]); }, abort: async code => { calls.push(["abort", code]); } };
}
test("boundary refuses unsupported WebSocket control rather than silently weakening", async () => {
  await assert.rejects(() => installCaptureBoundary({ route: () => { throw new Error("must not register"); } }), { message: "F11_WEBSOCKET_BOUNDARY_UNSUPPORTED" });
});
test("API/data requests never reach the app/server/provider; typed unavailable is a failing HTTP status", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  for (const url of ["http://127.0.0.1:3565/api/quote?syms=NVDA", "http://127.0.0.1:3565/data/NVDA.fund.json", "https://provider.invalid/api/data"]) {
    const route = requestDouble(url, "fetch"); await context.registered.request(route);
    assert.deepEqual(route.calls.map(c => c[0]), ["fulfill"]);
    assert.equal(route.calls[0][1].status, 503);
    assert.equal(route.calls[0][1].headers["Cache-Control"], "no-store");
  }
  assert.equal(counts.unavailable, 3);
});
test("qualified real app/static responses use maxRedirects0 and preserve response; redirects abort", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  const good = requestDouble("http://127.0.0.1:3565/analysis?symbol=NVDA&lang=en", "document");
  await context.registered.request(good);
  assert.deepEqual(good.calls.map(c => c[0]), ["fetch", "fulfill"]);
  assert.deepEqual(good.calls[0][1], { maxRedirects: 0 });
  assert.equal(good.calls[1][1].response.status(), 200);
  const redirect = requestDouble("http://127.0.0.1:3565/_next/static/chunk.js", "script", 302);
  await context.registered.request(redirect);
  assert.deepEqual(redirect.calls.map(c => c[0]), ["fetch", "abort"]);
  assert.equal(counts.redirectOrBadStatus, 1);
});
test("foreign routes and optimizer URLs abort without fetching, and sockets close without connecting", async () => {
  const context = contextDouble(); await installCaptureBoundary(context);
  for (const url of ["https://foreign.invalid/chunk.js", "http://127.0.0.1:3565/_next/image?url=https://provider.invalid/data&w=64&q=75"]) {
    const route = requestDouble(url, "image"); await context.registered.request(route);
    assert.deepEqual(route.calls.map(c => c[0]), ["abort"]);
  }
  let closed = false;
  context.registered.socket({ close: () => { closed = true; }, connectToServer: () => { throw new Error("must not connect"); } });
  assert.equal(closed, true);
});

test("startup waits for the normal component interception event, without issuing a request", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  let resolved = false;
  const waiting = counts.waitForBusinessRequest(1000).then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  assert.equal(counts.businessUnavailable, 0);
  // Synthetic route double only: no browser, app, socket or HTTP request exists.
  const route = requestDouble("http://127.0.0.1:3565/data/NVDA.fund.json", "fetch");
  await context.registered.request(route); await waiting;
  assert.equal(counts.businessUnavailable, 1);
  assert.equal(resolved, true);
  assert.equal(Object.hasOwn({ ...counts }, "waitForBusinessRequest"), false);
});
test("no-interception and blocked-script cases keep the positive guard failing", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  const blockedScript = requestDouble("https://foreign.invalid/app.js", "script");
  await context.registered.request(blockedScript);
  await assert.rejects(counts.waitForBusinessRequest(1), { message: "F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED" });
  assert.deepEqual(blockedScript.calls.map(c => c[0]), ["abort"]);
  assert.equal(counts.businessUnavailable, 0);
});

test("chrome, foreign and other-symbol reads never substitute for the actual NVDA component event", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  for (const url of ["http://127.0.0.1:3565/api/me", "http://127.0.0.1:3565/data/AAPL.fund.json", "https://foreign.invalid/data/NVDA.fund.json"]) {
    await context.registered.request(requestDouble(url, "fetch"));
  }
  assert.equal(counts.businessUnavailable, 3);
  assert.equal(counts.componentFundUnavailable, 0);
  await assert.rejects(counts.waitForBusinessRequest(1), { message: "F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED" });
});

// The original hosted failure had one non-200 but omitted its resource role/status.
test("failed allowed responses retain bounded public resource family/type/status only", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  const routes = [
    requestDouble("http://127.0.0.1:3565/_next/static/chunks/app.js?private=never-retain", "script", 404),
    requestDouble("http://127.0.0.1:3565/favicon.ico?private=never-retain", "image", 307),
  ];
  for (const route of routes) await context.registered.request(route);
  assert.deepEqual(counts.failedAllowedResponses, [
    { family: "next-script", resourceType: "script", status: 404, scriptPath: "/_next/static/chunks/app.js" },
    { family: "static-image", resourceType: "image", status: 307 },
  ]);
  assert.equal(JSON.stringify(counts).includes("never-retain"), false);
  assert.equal(JSON.stringify(counts).includes("http"), false);
  for (const route of routes) assert.deepEqual(route.calls.map(c => c[0]), ["fetch", "abort"]);
  assert.equal(counts.componentFundUnavailable, 0);
});
test("failed allowed response diagnostic cap never weakens200/redirect rejection or eventguard", async () => {
  const context = contextDouble(); const counts = await installCaptureBoundary(context);
  for (let i=0;i<12;i++) await context.registered.request(requestDouble("http://127.0.0.1:3565/_next/static/app.js", "script", 503));
  assert.equal(counts.failedAllowedResponses.length, 8);
  assert.equal(counts.redirectOrBadStatus, 12);
  const good=requestDouble("http://127.0.0.1:3565/_next/static/app.js", "script", 200);
  await context.registered.request(good);
  assert.deepEqual(good.calls.map(c => c[0]), ["fetch", "fulfill"]);
  assert.equal(counts.failedAllowedResponses.length, 8);
  await assert.rejects(counts.waitForBusinessRequest(1), {message:"F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED"});
});

const { staticScriptPath, consoleErrorKind, writeFailureArtifact } = require("./capture_b_f11_10_analysis_theses_entry.cjs");
test("local script identity diagnostic strips origin query and fragment, accepts only static script names", () => {
  assert.equal(staticScriptPath("http://127.0.0.1:3565/_next/static/chunks/_14q8v-t._.js?token=never#fragment", "script"), "/_next/static/chunks/_14q8v-t._.js");
  for (const [url,type] of [["https://host.invalid/user/name", "script"], ["http://127.0.0.1:3565/_next/static/chunks/test.js", "fetch"], ["invalid", "script"]]) assert.equal(staticScriptPath(url,type),undefined);
});
test("console diagnostics retain fixed classifications, never console content", () => {
  assert.equal(consoleErrorKind("Failed to load resource: secret 404"), "network-resource");
  assert.equal(consoleErrorKind("Refused to execute inline script Content Security Policy secret"), "csp");
  assert.equal(consoleErrorKind("Failed to load chunk secret"), "chunk-load");
  assert.equal(consoleErrorKind("arbitrary secret"), "other");
});
test("failure artifact is distinct from success and excludes raw error message", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(), "f11-failure-artifact-"));
  try {
    writeFailureArtifact(root,"fixture-head",{file:"desktop-en.png",requestBoundary:{componentFundUnavailable:0}},new Error("https://private.invalid/secret"));
    const text=fs.readFileSync(path.join(root,"FAILURE.json"),"utf8"), result=JSON.parse(text);
    assert.equal(result.status,"FAILURE"); assert.equal(result.errorCode,"F11_CAPTURE_FAILED");
    assert.equal(text.includes("private.invalid"),false); assert.equal(fs.existsSync(path.join(root,"FIXTURE.json")),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("F11 source-component server explicitly selects supported webpack, without changing app or boundary flags", () => {
  const source=fs.readFileSync(path.join(__dirname,"capture_b_f11_10_analysis_theses_entry.cjs"),"utf8");
  assert.match(source,/spawn\("npm", \["run", "dev", "--", "--webpack", "--hostname", "127\.0\.0\.1", "--port", String\(PORT\)\]/);
  assert.match(source,/waitForServer\(180_000, owner\)/);
  assert.match(source,/waitForBusinessRequest\(\)/);
  assert.match(source,/maxRedirects: 0/);
});


const { invalidateStaleOutcomeArtifacts, writeSuccessArtifact, assertAllSixObserved, FIXTURE_TEMP } = require("./capture_b_f11_10_analysis_theses_entry.cjs");

// Outcome-manifest lifecycle contract (F11 stale-success repair, C1).
const SIX_FILES = ["desktop-en.png", "desktop-zh.png", "tablet-en.png", "tablet-zh.png", "mobile-en.png", "mobile-zh.png"];
function plantOutcomeObject(dir, name, content) {
  const target = path.join(dir, name);
  fs.writeFileSync(target, content);
  return target;
}

test("invocation start outcome invalidation clears only known stale outcome manifests, preserving images and evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f11-outcome-invalidate-"));
  try {
    const staleFixture = plantOutcomeObject(root, "FIXTURE.json", '{"schema":"terminal.f11-source-component-fixture.v1","stale":true}\n');
    plantOutcomeObject(root, "FAILURE.json", '{"status":"FAILURE","stale":true}\n');
    const png = plantOutcomeObject(root, "desktop-en.png", Buffer.from("old-desktop-png-bytes"));
    plantOutcomeObject(root, "mobile-zh.png", Buffer.from("old-mobile-png-bytes"));
    const evidence = plantOutcomeObject(root, "EVIDENCE.yml", "# capturedAtHead: old-head\n");
    plantOutcomeObject(root, "unrelated.txt", "keep me");
    const cleared = invalidateStaleOutcomeArtifacts(root);
    assert.deepEqual(cleared.slice().sort(), ["FAILURE.json", "FIXTURE.json"]);
    assert.equal(fs.existsSync(staleFixture), false);
    assert.equal(fs.existsSync(path.join(root, "FAILURE.json")), false);
    assert.equal(fs.existsSync(path.join(root, FIXTURE_TEMP)), false);
    assert.ok(fs.readFileSync(png).equals(Buffer.from("old-desktop-png-bytes")));
    assert.ok(fs.readFileSync(path.join(root, "mobile-zh.png")).equals(Buffer.from("old-mobile-png-bytes")));
    assert.equal(fs.readFileSync(evidence, "utf8"), "# capturedAtHead: old-head\n");
    assert.equal(fs.readFileSync(path.join(root, "unrelated.txt"), "utf8"), "keep me");
    // Idempotent when no outcome manifests exist.
    assert.deepEqual(invalidateStaleOutcomeArtifacts(root), []);
    // A directory or symlink occupying a known outcome name is refused, never deleted.
    fs.mkdirSync(path.join(root, "FAILURE.json"));
    assert.throws(() => invalidateStaleOutcomeArtifacts(root), { message: "F11_UNEXPECTED_OUTCOME_OBJECT" });
    fs.rmdirSync(path.join(root, "FAILURE.json"));
    fs.symlinkSync(png, path.join(root, "FIXTURE.json"));
    assert.throws(() => invalidateStaleOutcomeArtifacts(root), { message: "F11_UNEXPECTED_OUTCOME_OBJECT" });
    assert.equal(fs.existsSync(png), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("partial two-desktop-then-forced-tablet-failure outcome leaves no eligible success and only the current FAILURE", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f11-outcome-partial-"));
  try {
    const desktopPng = plantOutcomeObject(root, "desktop-en.png", Buffer.from("old-desktop"));
    const tabletPng = plantOutcomeObject(root, "tablet-en.png", Buffer.from("old-tablet"));
    plantOutcomeObject(root, "FAIL-tablet-en.png", Buffer.from("old-failure-screenshot"));
    const evidence = plantOutcomeObject(root, "EVIDENCE.yml", "# old evidence\n");
    // Reproduce the actual hosted gap: a prior accepted success is planted.
    plantOutcomeObject(root, "FIXTURE.json", '{"capturedAtHead":"old-accepted-head","status":"SUCCESS"}');
    assert.deepEqual(invalidateStaleOutcomeArtifacts(root), ["FIXTURE.json"]);
    // Two desktop observations land, then the tablet-en shot fails hard.
    const files = ["desktop-en.png", "desktop-zh.png"];
    const observations = [
      { file: "desktop-en.png", state: "context-bar-with-theses-control" },
      { file: "desktop-zh.png", state: "context-bar-with-theses-control" },
    ];
    writeFailureArtifact(root, "fixture-head", { file: "tablet-en.png", requestBoundary: { componentFundUnavailable: 0 } }, new Error("F11_PAGE_SCRIPT_ERROR"));
    // Partial sets, duplicates, missing and out-of-order observations all refuse.
    assert.throws(() => assertAllSixObserved(files, observations), { message: "F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS" });
    assert.throws(() => assertAllSixObserved(SIX_FILES, observations), { message: "F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS" });
    const duplicated = [observations[0], observations[1], observations[0], { file: "tablet-zh.png" }, { file: "mobile-en.png" }, { file: "mobile-zh.png" }];
    assert.throws(() => assertAllSixObserved(SIX_FILES, duplicated), { message: "F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS" });
    assert.throws(() => assertAllSixObserved(SIX_FILES, SIX_FILES.map((f) => ({ file: f })).slice(0, 5)), { message: "F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS" });
    assert.throws(() => assertAllSixObserved(SIX_FILES.slice().reverse(), SIX_FILES.map((f) => ({ file: f }))), { message: "F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS" });
    assert.throws(() => writeSuccessArtifact(root, files, { entryObservations: observations }), { message: "F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS" });
    // Failure/partial-six: no eligible success, no torn temp, only current FAILURE.
    assert.equal(fs.existsSync(path.join(root, "FIXTURE.json")), false);
    assert.equal(fs.existsSync(path.join(root, FIXTURE_TEMP)), false);
    const failure = JSON.parse(fs.readFileSync(path.join(root, "FAILURE.json"), "utf8"));
    assert.equal(failure.status, "FAILURE");
    assert.equal(failure.errorCode, "F11_PAGE_SCRIPT_ERROR");
    assert.equal(failure.file, "tablet-en.png");
    assert.equal(failure.capturedAtHead, "fixture-head");
    // Old unrelated images and evidence history are unchanged.
    assert.ok(fs.readFileSync(desktopPng).equals(Buffer.from("old-desktop")));
    assert.ok(fs.readFileSync(tabletPng).equals(Buffer.from("old-tablet")));
    assert.ok(fs.readFileSync(path.join(root, "FAIL-tablet-en.png")).equals(Buffer.from("old-failure-screenshot")));
    assert.equal(fs.readFileSync(evidence, "utf8"), "# old evidence\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stable all-six outcome success publishes atomically via exclusive temp and clears stale failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "f11-outcome-success-"));
  try {
    plantOutcomeObject(root, "FAILURE.json", '{"status":"FAILURE","stale":true}\n');
    const desktopPng = plantOutcomeObject(root, "desktop-en.png", Buffer.from("current-desktop-en"));
    const observations = SIX_FILES.map((file) => ({ file, state: "context-bar-with-theses-control" }));
    assertAllSixObserved(SIX_FILES, observations);
    const bytes = writeSuccessArtifact(root, SIX_FILES, {
      schema: "terminal.f11-source-component-fixture.v1",
      capturedAtHead: "fixture-head",
      scope: "fixture论点",
      entryObservations: observations,
    });
    const written = JSON.parse(fs.readFileSync(path.join(root, "FIXTURE.json"), "utf8"));
    assert.equal(written.schema, "terminal.f11-source-component-fixture.v1");
    assert.equal(written.capturedAtHead, "fixture-head");
    assert.deepEqual(written.entryObservations.map((observation) => observation.file), SIX_FILES);
    assert.equal(bytes, fs.statSync(path.join(root, "FIXTURE.json")).size);
    assert.ok(fs.readFileSync(desktopPng).equals(Buffer.from("current-desktop-en")));
    // Success clears the stale failure record and leaves no temp behind.
    assert.equal(fs.existsSync(path.join(root, "FAILURE.json")), false);
    assert.equal(fs.existsSync(path.join(root, FIXTURE_TEMP)), false);
    // Exclusive temp: a leftover concurrent temp refuses instead of being
    // overwritten; the already-published success manifest stays intact.
    plantOutcomeObject(root, FIXTURE_TEMP, '{"torn":true}');
    assert.throws(() => writeSuccessArtifact(root, SIX_FILES, { entryObservations: observations }), { message: "F11_OUTCOME_TEMP_COLLISION" });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "FIXTURE.json"), "utf8")).capturedAtHead, "fixture-head");
    assert.equal(fs.readFileSync(path.join(root, FIXTURE_TEMP), "utf8"), '{"torn":true}');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function evaluateActualNextConfig(env) {
  const ts=require("typescript"), vm=require("node:vm");
  const source=fs.readFileSync(path.join(__dirname,"../../next.config.ts"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;
  const exports={};
  vm.runInNewContext(compiled,{exports,process:{env},__dirname:"/fixture",require: name => name === "node:fs" ? { readFileSync(){throw Object.assign(new Error("fixture"),{code:"ENOENT"});},readdirSync(){return [];} } : require(name)});
  return exports.default;
}
test("actual Next config disables only F11 development debug transport; production and other capture defaults unchanged", () => {
  const env={NODE_ENV:"development",TERMINAL_E2E_FIXTURE:"1",TERMINAL_F11_PROVIDER_CLOSED:"1"};
  const f11=evaluateActualNextConfig(env);
  assert.equal(f11.experimental.reactDebugChannel,false);
  assert.equal(f11.distDir,".next/f11");
  assert.equal(f11.typescript.tsconfigPath,"tsconfig.f11.json");
  for (const other of [{NODE_ENV:"production",TERMINAL_E2E_FIXTURE:"1",TERMINAL_F11_PROVIDER_CLOSED:"1"},{NODE_ENV:"development"},{NODE_ENV:"development",TERMINAL_E2E_FIXTURE:"1"},{NODE_ENV:"development",TERMINAL_F11_PROVIDER_CLOSED:"1"},{NODE_ENV:"test",TERMINAL_E2E_FIXTURE:"1",TERMINAL_F11_PROVIDER_CLOSED:"1"}]) {
    const normal=evaluateActualNextConfig(other);
    assert.equal(normal.experimental.reactDebugChannel,true);
    assert.equal(normal.distDir,undefined);
    assert.equal(normal.typescript,undefined);
  }
  const ordinary=evaluateActualNextConfig({...env,TERMINAL_F11_PROVIDER_CLOSED:"0"});
  assert.equal(JSON.stringify({...f11,experimental:undefined,distDir:undefined,typescript:undefined}),JSON.stringify({...ordinary,experimental:undefined,distDir:undefined,typescript:undefined}));
  assert.equal(captureServerEnv({TERMINAL_F11_PROVIDER_CLOSED:"0"}).TERMINAL_F11_PROVIDER_CLOSED,"1");
});

function outcomeModuleForTest({ root, fsOverrides={}, rejectPlaywright=false }) {
  const vm=require("node:vm"), source=fs.readFileSync(path.join(__dirname,"capture_b_f11_10_analysis_theses_entry.cjs"),"utf8");
  const sandboxModule={exports:{}};
  const localRequire=name => {
    if (name === "node:fs") return {...fs,...fsOverrides};
    if (name === "@playwright/test" && rejectPlaywright) throw new Error("F11_TEST_LOADER_FAILED");
    if (name === "node:child_process") return {spawn(){throw new Error("UNEXPECTED_SPAWN");},execFileSync(){throw new Error("UNEXPECTED_GIT");}};
    return require(name);
  };
  vm.runInNewContext(source+"\nmodule.exports.mainForTest=main;",{module:sandboxModule,exports:sandboxModule.exports,require:localRequire,__dirname:path.join(root,"terminal/e2e/tools"),process:{env:{},stdout:{write(){}}},console,Buffer});
  return sandboxModule.exports;
}
test("outcome unknown temporary preimage refuses without deleting or overwriting it", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-outcome-unknown-temp-"));
  try {
    const temp=plantOutcomeObject(root,FIXTURE_TEMP,"unknown prior writer");
    assert.throws(()=>invalidateStaleOutcomeArtifacts(root),{message:"F11_OUTCOME_TEMP_COLLISION"});
    assert.equal(fs.readFileSync(temp,"utf8"),"unknown prior writer");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("outcome failure-cleanup refusal cannot leave an eligible success", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-outcome-cleanup-refusal-"));
  try {
    fs.mkdirSync(path.join(root,"FAILURE.json"));
    assert.throws(()=>writeSuccessArtifact(root,SIX_FILES,{entryObservations:SIX_FILES.map(file=>({file}))}),{message:"F11_UNEXPECTED_OUTCOME_OBJECT"});
    assert.equal(fs.existsSync(path.join(root,"FIXTURE.json")),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("outcome atomic publisher does not promote one short write into success", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-outcome-short-write-"));
  try {
    const api=outcomeModuleForTest({root,fsOverrides:{writeSync(fd,body){return fs.writeSync(fd,Buffer.from(body).subarray(0,5));}}});
    const payload={capturedAtHead:"current",entryObservations:SIX_FILES.map(file=>({file}))};
    api.writeSuccessArtifact(root,SIX_FILES,payload);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,"FIXTURE.json"),"utf8")),payload);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("outcome invalidation precedes dependency-loader failure in the actual main", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-outcome-main-loader-"));
  try {
    const out=path.join(root,"terminal/docs/pr-crops/b-f11-10-analysis-theses-entry");fs.mkdirSync(out,{recursive:true});
    plantOutcomeObject(out,"FIXTURE.json",'{"capturedAtHead":"old"}');
    const api=outcomeModuleForTest({root,rejectPlaywright:true});
    await assert.rejects(api.mainForTest(),{message:"F11_TEST_LOADER_FAILED"});
    assert.equal(fs.existsSync(path.join(out,"FIXTURE.json")),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("outcome failure writer refuses a linked marker without changing its target", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-outcome-failure-link-"));
  try {
    const target=plantOutcomeObject(root,"unrelated.txt","unchanged");fs.symlinkSync(target,path.join(root,"FAILURE.json"));
    assert.throws(()=>writeFailureArtifact(root,"current",{file:"tablet-en.png"},new Error("F11_PAGE_SCRIPT_ERROR")));
    assert.equal(fs.readFileSync(target,"utf8"),"unchanged");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test("outcome publisher refuses an already present success instead of overwriting it", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"f11-outcome-existing-success-"));
  try {
    const old=plantOutcomeObject(root,"FIXTURE.json",'{"capturedAtHead":"prior"}');
    assert.throws(()=>writeSuccessArtifact(root,SIX_FILES,{entryObservations:SIX_FILES.map(file=>({file}))}),{message:"F11_SUCCESS_ALREADY_PRESENT"});
    assert.equal(fs.readFileSync(old,"utf8"),'{"capturedAtHead":"prior"}');
    assert.equal(fs.existsSync(path.join(root,FIXTURE_TEMP)),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
