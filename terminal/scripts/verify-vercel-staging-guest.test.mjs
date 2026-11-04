import assert from "node:assert/strict";
import { test } from "node:test";
import { runGuestCanary, validateStagingTarget } from "./verify-vercel-staging-guest.mjs";

const SHA = "a".repeat(40);
const STAGE = "https://stage.mastermind-x.com";
const MANIFEST = JSON.stringify({
  source: "macro-multimarket",
  as_of: "2026-11-03",
  symbols: { NVDA: { last: 200 }, AAPL: { last: 100 } },
});

function mockTransport({ mode = "beta", statusOverride = {}, manifest = MANIFEST,
                         legacyManifest = MANIFEST, privateHeader = true, redirect = false } = {}) {
  const calls = [];
  const requests = async (url, options) => {
    calls.push({ url, options });
    if (redirect) return new Response(null, { status: 302, headers: { location: "https://attacker.example" } });
    if (url.endsWith("/api/shared-shell/status")) {
      return new Response(JSON.stringify({
        enabled: mode === "beta",
        protocol: "mmx.shared-shell.v1",
        buildId: SHA,
        registrySha256: "b".repeat(64),
        bridgeVersion: "20261018.1",
        documentVersion: "20261018.1",
        ...statusOverride,
      }), {
        status: 200,
        headers: { "cache-control": privateHeader ? "private, no-store, max-age=0" : "public, s-maxage=3600" },
      });
    }
    const incumbent = url.startsWith("https://app.mastermind-x.com") ||
      url.startsWith("https://beta.mastermind-x.com");
    return new Response(incumbent ? legacyManifest : manifest, { status: 200 });
  };
  return { calls, requests };
}

test("only exact first-party or project-team staging origins qualify", () => {
  const good = [
    STAGE,
    "https://mastermind-terminal-4of1hhh8e-chriswong6031-creator.vercel.app",
  ];
  for (const origin of good) {
    assert.equal(validateStagingTarget(origin, "beta", SHA).target, origin);
  }
  for (const origin of [
    "http://stage.mastermind-x.com",
    "https://stage.mastermind-x.com:444",
    "https://stage.mastermind-x.com/foo",
    "https://other-team.vercel.app",
    "https://app.mastermind-x.com",
    "https://beta.mastermind-x.com",
    "https://user@stage.mastermind-x.com",
    "https://stage.mastermind-x.com.evil.example",
  ]) {
    assert.throws(() => validateStagingTarget(origin, "beta", SHA), /UNAPPROVED|EQUALS_LIVE/);
  }
  assert.throws(() => validateStagingTarget(STAGE, "wrong", SHA), /MODE_REQUIRED/);
  assert.throws(() => validateStagingTarget(STAGE, "beta", "short"), /EXACT_SOURCE_SHA_REQUIRED/);
});

for (const mode of ["beta", "terminal"]) {
  test("staged " + mode + " guest proof checks exact frontend, publisher, and privacy without cookies", async () => {
    const { requests, calls } = mockTransport({ mode });
    const receipt = await runGuestCanary({ target: STAGE, mode, sha: SHA }, requests);
    assert.equal(receipt.status, "GUEST_SOURCE_AND_MARKET_DATA_PROVEN");
    assert.equal(receipt.authenticatedProof, false);
    assert.equal(receipt.productionCutoverProof, false);
    assert.equal(receipt.sourceSha, SHA);
    assert.equal(receipt.symbolCount, 2);
    assert.equal(receipt.marketAsOf, "2026-11-03");
    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ options }) => options.redirect === "manual"));
    assert.ok(calls.every(({ options }) => !options.headers.Authorization && !options.headers.Cookie));
    assert.equal(calls[0].url, STAGE + "/api/shared-shell/status");
    assert.equal(calls[1].url, STAGE + "/data/manifest.json");
  });
}

test("staged shell must report the build that was actually deployed", async () => {
  const { requests } = mockTransport({ statusOverride: { buildId: "c".repeat(40) } });
  await assert.rejects(runGuestCanary({ target: STAGE, mode: "beta", sha: SHA }, requests),
    /WRONG_FRONTEND_BUILD_OR_BRIDGE/);
});

test("market publisher byte mismatch blocks any staging claim", async () => {
  const stale = JSON.stringify({ source: "macro-multimarket", as_of: "2026-11-02", symbols: { NVDA: {} } });
  const { requests } = mockTransport({ manifest: stale });
  await assert.rejects(runGuestCanary({ target: STAGE, mode: "beta", sha: SHA }, requests),
    /MARKET_PUBLISHER_DRIFT/);
});

test("publicly cached shell status cannot qualify", async () => {
  const { requests } = mockTransport({ privateHeader: false });
  await assert.rejects(runGuestCanary({ target: STAGE, mode: "beta", sha: SHA }, requests),
    /STATUS_PRIVACY_HEADERS_MISSING/);
});

test("cross-origin redirects are rejected rather than followed", async () => {
  const { requests, calls } = mockTransport({ redirect: true });
  await assert.rejects(runGuestCanary({ target: STAGE, mode: "beta", sha: SHA }, requests),
    /READ_FAILED/);
  assert.equal(calls.length, 1);
});
