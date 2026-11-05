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
  assert.match(source,/waitForServer\(180_000\)/);
  assert.match(source,/waitForBusinessRequest\(\)/);
  assert.match(source,/maxRedirects: 0/);
});
