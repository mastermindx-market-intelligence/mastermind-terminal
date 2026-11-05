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
