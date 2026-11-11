"use strict";
// Offline, bounded qualification of the original hosted ticker capture.
// This program never starts a browser, observes a port, or changes a capture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const [repoArg, captureArg, metadataArg, canonicalArg, bindingsArg, zipArg, outputArg] = process.argv.slice(2);
assert.equal(process.argv.length, 9, "repo capture metadata canonical bindings zip output");
const repo = path.resolve(repoArg), captureDir = path.resolve(captureArg);
const sourceHead = "55d087c30f9b011d5dfd6cbcfe5596be306dab74";
const run = 43073040314, job = 130706212136;
const packet = "terminal/docs/pr-crops/ticker-news";
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p));
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const git = args => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const atHead = p => git(["show", sourceHead + ":" + p]);
const relInventory = (root) => {
  const result = {};
  const walk = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), "symlink in evidence: " + entry.name);
      const rel = prefix + entry.name, p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, rel + "/");
      else { assert.ok(entry.isFile()); result[rel] = sha256(read(p)); }
    }
  };
  walk(root); return result;
};
const localTree = (prefix) => Object.fromEntries(git(["ls-tree", "-r", "-z", sourceHead, "--", prefix])
  .toString("utf8").split("\0").filter(Boolean).map(row => {
    const [left, p] = row.split("\t"), [mode, type, sha] = left.split(" ");
    return [p, { mode, type, sha }];
  }));
const keys = x => Object.keys(x).sort();
const receiptModule = "terminal/e2e/tools/ticker_news_capture_receipt.cjs";
assert.equal(sha256(read(path.join(repo, receiptModule))), sha256(atHead(receiptModule)));
const { SOURCES, SHOTS, validateReport, validateImages, validateFontWitnesses } = require(path.join(repo, receiptModule));
const prepared = json(path.join(captureDir, "prepared.json"));
const capture = json(path.join(captureDir, "capture.json"));
const cleared = json(path.join(captureDir, "images-cleared.json"));
const reportBytes = read(path.join(captureDir, "report.json"));
const metadata = json(metadataArg), canonical = json(canonicalArg), bindings = json(bindingsArg);

assert.equal(metadata.name, "responsive-qa-" + run + "-serial");
assert.equal(metadata.expired, false);
assert.equal(metadata.workflow_run.id, run);
assert.equal(metadata.workflow_run.head_sha, sourceHead);
assert.equal(metadata.workflow_run.head_branch, "sol/web-chart-ai-drawing-workspace-20261018-c4-001");
assert.match(metadata.digest, /^sha256:[0-9a-f]{64}$/);
assert.equal(fs.statSync(zipArg).size, metadata.size_in_bytes, "artifact ZIP size");
assert.equal("sha256:" + sha256(read(zipArg)), metadata.digest, "artifact ZIP digest");
assert.equal(capture.schema, "ticker-news.hosted-capture.v1");
assert.equal(prepared.schema, capture.schema);
assert.equal(prepared.qualified, false);
assert.equal(capture.qualified, true);
for (const field of ["startedAt", "checkout", "sources", "runtime", "environment", "preflight", "workflow", "command", "prior", "otherPackets", "producerActivation", "productionAcceptance", "visualAcceptance"]) {
  assert.deepEqual(capture[field], prepared[field], "prepared/capture " + field);
}
assert.equal(capture.workflow.repository, "mastermindx-market-intelligence/mastermind-terminal");
assert.equal(String(capture.workflow.run), String(run));
assert.equal(String(capture.workflow.attempt), "1");
assert.equal(capture.workflow.event, "pull_request");
assert.equal(capture.workflow.job, "terminal-e2e");
assert.equal(capture.workflow.head, sourceHead);
assert.match(capture.workflow.base, /^[0-9a-f]{40}$/);
assert.equal(capture.checkout.commit, canonical.commit);
assert.equal(capture.checkout.tree, canonical.tree);
assert.equal(canonical.parents.length, 2);
assert.equal(canonical.parents[1], sourceHead);
assert.ok(Array.isArray(capture.checkout.parents));
if (capture.checkout.parents.length) assert.deepEqual(capture.checkout.parents, canonical.parents);
// The actual merge may contain newly protected commits after the durable head.
// Bind its canonical complete tree; verify each capture input against both trees.
assert.equal(git(["rev-parse", canonical.commit + "^{tree}"]).toString("utf8").trim(), canonical.tree);
assert.deepEqual(git(["show", "-s", "--format=%P", canonical.commit]).toString("utf8").trim().split(" "), canonical.parents);
const sourceHeadTree = git(["rev-parse", sourceHead + "^{tree}"]).toString("utf8").trim();
assert.equal(bindings.commit, canonical.commit);
assert.equal(bindings.tree, canonical.tree);
assert.equal(bindings.truncated, false);
const actualFiles = bindings.files;
const verifyPath = p => {
  const actual = actualFiles[p];
  assert.ok(actual, "canonical path absent: " + p);
  assert.equal(actual.type, "blob");
  assert.ok(["100644", "100755"].includes(actual.mode));
  const local = localTree(p)[p];
  assert.deepEqual(actual, local, "actual checkout differs from durable source head: " + p);
  const actualBytes = git(["show", canonical.commit + ":" + p]);
  assert.equal(sha256(actualBytes), sha256(atHead(p)), "actual merge input differs from durable source: " + p);
  return sha256(actualBytes);
};
assert.equal(SOURCES.length, 19);
assert.deepEqual(keys(capture.sources), [...SOURCES].sort());
for (const p of SOURCES) {
  assert.equal(capture.sources[p], verifyPath(p), "source binding: " + p);
  assert.equal(sha256(read(path.join(repo, p))), capture.sources[p], "import worktree source differs: " + p);
}
const lock = JSON.parse(atHead("terminal/package-lock.json"));
assert.equal(capture.runtime.next, lock.packages["node_modules/next"].version);
assert.equal(capture.runtime.playwright, lock.packages["node_modules/@playwright/test"].version);
assert.match(capture.runtime.node, /^v20\./);
const chromium = json(path.join(repo, "terminal/node_modules/playwright-core/browsers.json")).browsers
  .filter(x => ["chromium", "chromium-headless-shell"].includes(x.name));
assert.deepEqual(capture.runtime.configuredChromium, chromium);
const pinBytes = atHead(".github/fonts/noto-cjk/pin.json"), pin = JSON.parse(pinBytes);
const font = capture.runtime.cjkFont;
assert.equal(font.schema, "terminal.cjk-font-runtime.v1");
assert.match(font.receiptSha256, /^[0-9a-f]{64}$/);
assert.equal(font.pinSha256, sha256(pinBytes));
assert.deepEqual(font.workflow, { repository: capture.workflow.repository, run: String(run), attempt: "1", job: "terminal-e2e" });
assert.equal(font.font.sha256, pin.sha256);
assert.equal(font.font.bytes, pin.bytes);
assert.equal(font.font.gitBlobSha, pin.gitBlobSha);
assert.equal(font.font.licenseSha256, sha256(atHead(pin.license.path)));
assert.equal(font.resolvedFor, "sans-serif:lang=zh-cn");
assert.equal(font.resolvedFace.family, pin.family);
assert.equal(font.resolvedFace.postScriptName, pin.postScriptName);
assert.equal(font.resolvedFace.requiredText, pin.requiredText);
assert.equal(font.resolvedFace.file, font.font.file);
assert.equal(path.basename(font.font.file), pin.fileName);
assert.equal(capture.environment.FONTCONFIG_FILE, font.fontconfig.file);
assert.equal(path.dirname(capture.environment.TERMINAL_CJK_FONT_RECEIPT), path.dirname(font.fontconfig.file));
assert.equal(path.basename(capture.environment.TERMINAL_CJK_FONT_RECEIPT), "receipt.json");
assert.equal(path.dirname(path.dirname(font.font.file)), path.dirname(font.fontconfig.file));
assert.equal(path.dirname(font.fontconfig.cacheDirectory), path.dirname(font.fontconfig.file));
assert.match(path.basename(path.dirname(font.fontconfig.file)), /^terminal-cjk-/);
for (const key of ["sha256", "baseSha256"]) assert.match(font.fontconfig[key], /^[0-9a-f]{64}$/);
for (const char of pin.requiredText) assert.ok(font.resolvedFace.charsetRanges.some(([low, high]) =>
  low <= char.codePointAt(0) && char.codePointAt(0) <= high), "Pinned required character missing: " + char);

assert.equal(capture.environment.CI, "1");
assert.equal(capture.environment.TERMINAL_CROPS, "1");
assert.equal(capture.environment.TERMINAL_TICKER_NEWS_CAPTURE_PACKET, "ticker-news");
assert.equal(capture.environment.PLAYWRIGHT_JSON_OUTPUT_NAME, "test-results/ticker-news-current/report.json");
assert.ok(Number(capture.environment.TERMINAL_E2E_PORT) > 0);
assert.equal(capture.command, "npm run test:e2e:responsive -- e2e/ticker-news.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --output=test-results/ticker-news-current/playwright --reporter=github,json");

const expectedNames = SHOTS.map(x => x.file);
assert.deepEqual(cleared.absent, expectedNames);
assert.equal(cleared.startedAt, prepared.startedAt);
assert.equal(cleared.manifest, prepared.prior["EVIDENCE.yml"]);
assert.deepEqual(keys(prepared.prior), ["EVIDENCE.yml", ...expectedNames].sort());
assert.deepEqual(relInventory(path.join(captureDir, "prior")), prepared.prior);
const actualPrior = keys(actualFiles).filter(p => p.startsWith(packet + "/"));
assert.deepEqual(actualPrior, keys(prepared.prior).map(x => packet + "/" + x));
assert.deepEqual(keys(localTree(packet)), actualPrior);
for (const [p, hash] of Object.entries(prepared.prior)) assert.equal(verifyPath(packet + "/" + p), hash);
const expectedOtherCounts = {
  "ticker-news-cn-hk": 25, "ticker-news-editorial-quality": 15,
  "ticker-news-editorial-views": 41, "ticker-news-recovery": 37,
};
assert.deepEqual(keys(capture.otherPackets), keys(expectedOtherCounts));
let otherCount = 0;
for (const [name, count] of Object.entries(expectedOtherCounts)) {
  const base = "terminal/docs/pr-crops/" + name + "/", inventory = capture.otherPackets[name];
  assert.equal(keys(inventory).length, count);
  const names = keys(inventory).map(p => base + p);
  assert.deepEqual(keys(actualFiles).filter(p => p.startsWith(base)), names);
  assert.deepEqual(keys(localTree(base)), names);
  for (const [p, hash] of Object.entries(inventory)) assert.equal(verifyPath(base + p), hash);
  otherCount += count;
}
assert.equal(otherCount, 118);
assert.equal(keys(actualFiles).length, SOURCES.length + 11 + otherCount);
assert.equal(sha256(reportBytes), capture.reportSha256);
const cases = validateReport(JSON.parse(reportBytes), prepared.startedAt);
assert.deepEqual(cases, capture.cases);
const cropDir = path.join(captureDir, "crops");
const images = validateImages(p => read(path.join(cropDir, p)), fs.readdirSync(cropDir));
assert.deepEqual(images, capture.images);
const witnessDir = path.join(captureDir, "font-witnesses");
const cjkGlyphWitnesses = validateFontWitnesses(file => read(path.join(witnessDir, file)),
  fs.readdirSync(witnessDir), font, prepared.startedAt, capture.completedAt);
assert.deepEqual(cjkGlyphWitnesses, capture.cjkGlyphWitnesses);
assert.equal(cjkGlyphWitnesses.length, 5);
assert.equal(capture.preflight.portIsClosed, true);
assert.equal(capture.lifecycle.playwrightReturned, true);
assert.equal(capture.lifecycle.portIsClosed, true);
assert.ok(Date.parse(capture.completedAt) >= Date.parse(capture.startedAt));
assert.equal(capture.producerActivation, false);
assert.equal(capture.productionAcceptance, false);
assert.equal(capture.visualAcceptance, false);

const qualification = {
  schema: "ticker-news.import-qualification.v1", sourceHead,
  captureCheckout: canonical.commit, captureTree: canonical.tree, captureParents: canonical.parents,
  durableSourceHeadTree: sourceHeadTree, completeTreeEqualsHead: canonical.tree === sourceHeadTree,
  all19InputsAnd129PacketBindingsExactAcrossHeadAndActualMerge: true,
  rawReceiptParents: capture.checkout.parents, eventBaseObservedSeparately: capture.workflow.base,
  run, attempt: 1, job, artifact: metadata, reportSha256: capture.reportSha256,
  sourceCount: SOURCES.length, sources: capture.sources,
  canonicalSourceAndPacketBindings: keys(actualFiles).length,
  cases: { passed: 14, authoredProjectSkips: 7, failed: 0, flaky: 0, retries: 0 }, images,
  priorPacketFiles: 11, otherPacketFilesVerified: otherCount,
  runtime: capture.runtime, cjkGlyphWitnesses, preflight: capture.preflight, lifecycle: capture.lifecycle,
  rawCaptureReceiptUnmodified: true, visualInspection: "Pending principal image inspection before publication",
  producerActivation: false, productionAcceptance: false,
};
fs.writeFileSync(outputArg, JSON.stringify(qualification, null, 2) + "\n");
console.log(JSON.stringify({ captureCheckout: canonical.commit, sourceCount: SOURCES.length,
  cases: qualification.cases, images: images.length, cjkGlyphWitnesses: cjkGlyphWitnesses.length, prior: 11, other: otherCount,
  preflight: capture.preflight, lifecycle: capture.lifecycle }, null, 2));
