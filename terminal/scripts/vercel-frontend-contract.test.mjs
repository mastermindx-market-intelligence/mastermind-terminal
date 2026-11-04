import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const terminal = fileURLToPath(new URL("../", import.meta.url));
const base = { ...process.env };
delete base.VERCEL;
delete base.MMX_SHARED_SHELL;
delete base.MMX_MARKET_DATA_ORIGIN;
delete base.VERCEL_GIT_COMMIT_SHA;

function evaluate(overrides = {}) {
  const env = {
    ...base,
    ...(overrides.VERCEL === "1" ? { VERCEL_GIT_COMMIT_SHA: "a".repeat(40) } : {}),
    ...overrides,
  };
  const code = [
    "globalThis.__dirname = process.cwd();",
    "const config = (await import('./next.config.ts')).default;",
    "console.log('RESULT:' + JSON.stringify({rewrites: await config.rewrites(), deploymentId: config.deploymentId, shell: config.env.MMX_SHARED_SHELL, headers: await config.headers()}));",
  ].join("\n");
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
    env,
    cwd: terminal,
    encoding: "utf8",
    timeout: 15000,
  });
  return { ...run, result: run.stdout.includes("RESULT:") ? JSON.parse(run.stdout.split("RESULT:")[1].split("\n")[0]) : null };
}

test("incumbent VPS routes remain untouched without Vercel", () => {
  const run = evaluate();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.result.rewrites, []);
  assert.equal(run.result.shell, "0");
});

test("Vercel requires an explicitly selected shell mode", () => {
  const run = evaluate({ VERCEL: "1", MMX_MARKET_DATA_ORIGIN: "https://data.mastermind-x.com" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /VERCEL_FRONTEND_MODE_REQUIRED/);
});

test("Vercel fails closed without a market data origin", () => {
  const run = evaluate({ VERCEL: "1", MMX_SHARED_SHELL: "1" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /VERCEL_MARKET_DATA_ORIGIN_REQUIRED/);
});

for (const origin of [
  "https://app.mastermind-x.com",
  "https://beta.mastermind-x.com",
  "http://data.mastermind-x.com",
  "https://data.mastermind-x.com/extra",
  "https://data.mastermind-x.com?debug=1",
  "https://someone@data.mastermind-x.com",
  "https://data.mastermind-x.com:444",
  "https://data.mastermind-x.com.evil.example",
]) {
  test(`Vercel refuses unsafe upstream: ${origin}`, () => {
    const run = evaluate({ VERCEL: "1", MMX_SHARED_SHELL: "0", MMX_MARKET_DATA_ORIGIN: origin });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /VERCEL_MARKET_DATA_ORIGIN_UNAPPROVED/);
  });
}

for (const [mode, origin] of [
  ["0", "https://data.mastermind-x.com"],
  ["1", "https://terminal-origin.mastermind-x.com"],
]) {
  test(`Vercel forwards data before static files with mode ${mode}`, () => {
    const run = evaluate({
      VERCEL: "1",
      VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
      MMX_SHARED_SHELL: mode,
      MMX_MARKET_DATA_ORIGIN: origin,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.result.deploymentId, "b".repeat(40));
    assert.equal(run.result.shell, mode);
    assert.deepEqual(run.result.rewrites, {
      beforeFiles: [{ source: "/data/:path*", destination: `${origin}/data/:path*` }],
      afterFiles: [],
      fallback: [],
    });
    for (const source of ["/data/manifest.json", "/data/coverage.json"]) {
      const index = run.result.headers.find(h => h.source === source);
      assert.ok(index, "publisher indexes require a 60s independent edge TTL");
      assert.match(index.headers[0].value, /s-maxage=60/);
    }
  });
}

test("Vercel rejects missing source commit despite legacy fallback", () => {
  const run = evaluate({
    VERCEL: "1",
    MMX_SHARED_SHELL: "1",
    MMX_MARKET_DATA_ORIGIN: "https://data.mastermind-x.com",
    VERCEL_GIT_COMMIT_SHA: "",
    GIT_SHA: "c".repeat(40),
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /VERCEL_GIT_COMMIT_SHA_REQUIRED/);
});

test("Vercel rejects malformed source identity", () => {
  const run = evaluate({
    VERCEL: "1",
    MMX_SHARED_SHELL: "0",
    MMX_MARKET_DATA_ORIGIN: "https://data.mastermind-x.com",
    VERCEL_GIT_COMMIT_SHA: "short",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /VERCEL_GIT_COMMIT_SHA_REQUIRED/);
});

test("Vercel prebuild never writes a fixture-derived freshness index", () => {
  const run = spawnSync(process.execPath, [path.join(terminal, "scripts", "prepare-data-coverage.mjs")], {
    cwd: terminal,
    env: { ...base, VERCEL: "1" },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /no fixture index generated/);
});
