import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const terminal = fileURLToPath(new URL("../", import.meta.url));
const base = { ...process.env };
delete base.VERCEL;
delete base.MMX_SHARED_SHELL;
delete base.MMX_MARKET_DATA_ORIGIN;
delete base.MMX_TERMINAL_API_ORIGIN;
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
  "https://terminal-origin.mastermind-x.com",
]) {
  test(`Vercel refuses unsafe upstream: ${origin}`, () => {
    const run = evaluate({ VERCEL: "1", MMX_SHARED_SHELL: "0", MMX_MARKET_DATA_ORIGIN: origin });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /VERCEL_MARKET_DATA_ORIGIN_UNAPPROVED/);
  });
}

for (const [mode, apiOrigin] of [
  ["0", "https://terminal-origin.mastermind-x.com"],
  ["1", "https://beta-origin.mastermind-x.com"],
]) {
  test(`Vercel forwards data and the approved API families with mode ${mode}`, () => {
    const origin = "https://data.mastermind-x.com";
    const run = evaluate({
      VERCEL: "1",
      VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
      MMX_SHARED_SHELL: mode,
      MMX_MARKET_DATA_ORIGIN: origin,
      MMX_TERMINAL_API_ORIGIN: apiOrigin,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.result.deploymentId, "b".repeat(40));
    assert.equal(run.result.shell, mode);
    const rewrites = run.result.rewrites;
    assert.deepEqual(rewrites.afterFiles, []);
    assert.deepEqual(rewrites.fallback, []);
    assert.deepEqual(rewrites.beforeFiles[0], {
      source: "/data/:path*",
      destination: origin + "/data/:path*",
    });

    const grouped = readdirSync(new URL("../app/api/", import.meta.url), { withFileTypes: true })
      .filter(p => p.isDirectory()).map(p => p.name).filter(name => name !== "shared-shell");
    const actual = new Map(rewrites.beforeFiles.slice(1).map(r => [r.source, r.destination]));
    assert.equal(actual.size, grouped.length + 2);
    for (const family of grouped) {
      assert.equal(actual.get(`/api/${family}/:path*`), `${apiOrigin}/api/${family}/:path*`, family);
    }
    // Only these explicitly planned Shared Shell APIs delegate to the matching
    // old beta/Terminal backend. The source-release identity stays local.
    assert.equal(actual.get("/api/shared-shell/today"), `${apiOrigin}/api/shared-shell/today`);
    assert.equal(actual.get("/api/shared-shell/research/:path*"), `${apiOrigin}/api/shared-shell/research/:path*`);
    assert.equal(actual.has("/api/shared-shell/status"), false);
    assert.equal(actual.has("/api/:path*"), false);

    for (const source of ["/data/manifest.json", "/data/coverage.json"]) {
      const index = run.result.headers.find(h => h.source === source);
      assert.ok(index, "publisher indexes require a 60s independent edge TTL");
      assert.match(index.headers[0].value, /s-maxage=60/);
    }
    const api = run.result.headers.find(h => h.source === "/api/:path*");
    assert.ok(api, "API responses must not be publicly cached");
    assert.match(api.headers[0].value, /private, no-store/);
  });
}

test("Vercel fails closed without a mode-specific API origin", () => {
  const run = evaluate({
    VERCEL: "1",
    MMX_SHARED_SHELL: "0",
    MMX_MARKET_DATA_ORIGIN: "https://data.mastermind-x.com",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /VERCEL_TERMINAL_API_ORIGIN_REQUIRED/);
});

for (const origin of [
  "https://app.mastermind-x.com",
  "https://beta.mastermind-x.com",
  "https://beta-origin.mastermind-x.com",
  "http://terminal-origin.mastermind-x.com",
  "https://terminal-origin.mastermind-x.com/extra",
]) {
  test(`Vercel refuses the wrong production API origin: ${origin}`, () => {
    const run = evaluate({
      VERCEL: "1",
      MMX_SHARED_SHELL: "0",
      MMX_MARKET_DATA_ORIGIN: "https://data.mastermind-x.com",
      MMX_TERMINAL_API_ORIGIN: origin,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /VERCEL_TERMINAL_API_ORIGIN_UNAPPROVED/);
  });
}

test("Vercel rejects missing source commit despite legacy fallback", () => {
  const run = evaluate({
    VERCEL: "1",
    MMX_SHARED_SHELL: "1",
    MMX_MARKET_DATA_ORIGIN: "https://data.mastermind-x.com",
    MMX_TERMINAL_API_ORIGIN: "https://beta-origin.mastermind-x.com",
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
    MMX_TERMINAL_API_ORIGIN: "https://terminal-origin.mastermind-x.com",
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
