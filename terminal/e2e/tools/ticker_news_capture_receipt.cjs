"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Node-only capture receipt */

// Observe the existing Playwright command; this tool never launches or kills a
// browser/server and never writes the committed EVIDENCE.yml.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { join, resolve, relative } = require("node:path");
const { createConnection } = require("node:net");
const { PNG } = require("pngjs");

const ROOT = resolve(__dirname, "../..");
const REPO = resolve(ROOT, "..");
const PACKET = "terminal/docs/pr-crops/ticker-news";
const OUTPUT = "test-results/ticker-news-current";
const REPORT = OUTPUT + "/report.json";
const VIEWPORTS = { desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
const SHOTS = [
  ...Object.keys(VIEWPORTS).flatMap(viewport => ["en", "zh"].map(lang =>
    ({ file: viewport + "-" + lang + "-dark.png", viewport, lang, state: "live-feed" }))),
  ...["desktop", "mobile"].flatMap(viewport => ["en", "zh"].map(lang =>
    ({ file: "unavailable-" + viewport + "-" + lang + "-dark.png", viewport, lang, state: "unavailable" }))),
];
const TITLES = [
  "ticker News rail is readable across EN/ZH desktop/tablet/mobile matrix",
  "unavailable snapshot renders without rail overflow",
  "unavailable snapshot retries inside the rail across EN/ZH and theme specimens",
  "grouped reports expand inside the real rail without leaving ticker context",
  "MSFT grouped detail starts while an Apple story response is still held",
  "editorial views filter before display and keep grouped details in the selected context",
  "Chinese and Hong Kong tickers preserve original Chinese headlines",
];
const SOURCES = [
  "terminal/components/news/TickerNewsPanel.tsx", "terminal/components/news/TickerNewsPanel.module.css",
  "terminal/components/TerminalShell.tsx", "terminal/app/globals.css",
  "terminal/lib/i18n.tsx", "terminal/lib/__tests__/fixtures/newsEditorial.ts",
  "terminal/e2e/ticker-news.spec.ts", "terminal/e2e/watchlistStore.ts",
  "terminal/e2e/presentationControls.ts", "terminal/e2e/globalSetup.ts",
  "terminal/e2e/tools/ticker_news_capture_receipt.cjs", "terminal/playwright.config.ts",
  "terminal/docs/specimens/news-flow.light.css", "terminal/next.config.ts",
  "terminal/package.json", "terminal/package-lock.json",
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function regularBytes(path) {
  assert.equal(realpathSync(path), resolve(path), "Symlink input: " + path);
  assert.ok(lstatSync(path).isFile(), "Not a regular file: " + path);
  return readFileSync(path);
}
function sourceHashes() {
  return Object.fromEntries(SOURCES.map(path => [path, sha256(regularBytes(join(REPO, path)))]));
}
function committedSourceHashes(commit) {
  assert.match(commit, /^[0-9a-f]{40}$/);
  return Object.fromEntries(SOURCES.map(path => [path, sha256(execFileSync("git", ["show", commit + ":" + path],
    { cwd: REPO, maxBuffer: 2 * 1024 * 1024 }))]));
}
function inventory(directory) {
  assert.equal(realpathSync(directory), resolve(directory), "Symlink directory");
  const result = {};
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      assert.ok(!entry.isSymbolicLink(), "Symlink evidence member");
      if (entry.isDirectory()) visit(file);
      else result[relative(directory, file)] = sha256(regularBytes(file));
    }
  }
  visit(directory);
  return result;
}
function otherPackets() {
  const parent = join(REPO, "terminal/docs/pr-crops");
  return Object.fromEntries(readdirSync(parent).filter(name => name.startsWith("ticker-news-")).sort()
    .map(name => [name, inventory(join(parent, name))]));
}
function checkout() {
  const git = args => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
  return { commit: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]),
    parents: git(["show", "-s", "--format=%P", "HEAD"]).split(" ").filter(Boolean) };
}
function runtime() {
  const version = name => JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version;
  const lock = JSON.parse(regularBytes(join(ROOT, "package-lock.json")));
  const result = { node: process.version, next: version("next"), playwright: version("@playwright/test"),
    configuredChromium: JSON.parse(readFileSync(join(ROOT, "node_modules/playwright-core/browsers.json"), "utf8"))
      .browsers.filter(row => row.name === "chromium" || row.name === "chromium-headless-shell") };
  assert.equal(result.next, lock.packages["node_modules/next"].version);
  assert.equal(result.playwright, lock.packages["node_modules/@playwright/test"].version);
  return result;
}
function executionEnvironment() {
  assert.equal(process.env.CI, "1");
  assert.equal(process.env.TERMINAL_CROPS, "1");
  assert.equal(process.env.TERMINAL_TICKER_NEWS_CAPTURE_PACKET, "ticker-news");
  assert.equal(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || "", "", "Unexpected JSON report override");
  assert.equal(process.env.PLAYWRIGHT_JSON_OUTPUT_DIR || "", "", "Unexpected JSON report directory");
  assert.equal(resolve(ROOT, process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || ""), join(ROOT, REPORT));
  const port = Number(process.env.TERMINAL_E2E_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  return { CI: "1", TERMINAL_CROPS: "1", TERMINAL_TICKER_NEWS_CAPTURE_PACKET: "ticker-news",
    TERMINAL_E2E_PORT: String(port), PLAYWRIGHT_JSON_OUTPUT_NAME: REPORT };
}
function portClosed(port) {
  return new Promise(resolvePromise => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = closed => { if (!done) { done = true; socket.destroy(); resolvePromise(closed); } };
    socket.once("connect", () => finish(false));
    socket.once("error", error => finish(error.code === "ECONNREFUSED"));
    socket.setTimeout(1000, () => finish(false));
  });
}
function validateReport(report, startedAt) {
  assert.deepEqual(report.errors, [], "Browser runner errors");
  assert.equal(report.config.workers, 1);
  assert.equal(report.stats.expected, 14);
  assert.equal(report.stats.skipped, 7);
  assert.equal(report.stats.unexpected, 0);
  assert.equal(report.stats.flaky, 0);
  assert.ok(Number.isFinite(report.stats.duration) && report.stats.duration > 0);
  assert.ok(Date.parse(report.stats.startTime) >= Date.parse(startedAt), "Report predates capture");
  const rows = [];
  function walk(suite) {
    for (const spec of suite.specs || []) {
      assert.match(spec.file, /(^|\/)ticker-news\.spec\.ts$/);
      assert.equal(spec.ok, true);
      for (const test of spec.tests) rows.push({ title: spec.title, ...test });
    }
    for (const child of suite.suites || []) walk(child);
  }
  for (const suite of report.suites) walk(suite);
  assert.equal(rows.length, 21);
  assert.equal(new Set(rows.map(row => row.projectName + ":" + row.title)).size, 21);
  const cases = [];
  for (const project of Object.keys(VIEWPORTS)) for (const [index, title] of TITLES.entries()) {
    const row = rows.find(item => item.projectName === project && item.title === title);
    assert.ok(row, "Missing case: " + project + ":" + title);
    const skip = ([0, 3, 4].includes(index) && project !== "desktop") || (index === 1 && project === "tablet");
    assert.equal(row.status, skip ? "skipped" : "expected");
    assert.equal(row.expectedStatus, skip ? "skipped" : "passed");
    assert.equal(row.results.length, 1, "Retries are not qualified capture");
    const result = row.results[0];
    assert.equal(result.retry, 0);
    assert.equal(result.status, skip ? "skipped" : "passed");
    assert.deepEqual(result.errors, []);
    assert.ok(!result.error);
    cases.push({ project, title, status: result.status, retry: 0, duration: result.duration });
  }
  return cases;
}
function validateImages(readImage, names) {
  assert.deepEqual([...names].sort(), SHOTS.map(row => row.file).sort());
  return SHOTS.map(shot => {
    const bytes = readImage(shot.file), png = PNG.sync.read(bytes, { checkCRC: true });
    assert.ok(png.width > 0 && png.height > 0 && png.width <= VIEWPORTS[shot.viewport].width);
    assert.equal(png.data.length, png.width * png.height * 4);
    return { ...shot, viewport: VIEWPORTS[shot.viewport],
      image: { width: png.width, height: png.height, sha256: sha256(bytes) } };
  });
}
async function prepare() {
  const env = executionEnvironment();
  assert.equal(await portClosed(Number(env.TERMINAL_E2E_PORT)), true, "Existing lane port is occupied; do not reuse or kill it");
  // Next's advisory lock is released at process exit even when Playwright's
  // normal teardown leaves its POSIX directory entry behind. Existence is a
  // diagnostic only; Next itself refuses a genuinely held lock at startup.
  const devLockFilePresent = existsSync(join(ROOT, ".next/dev/lock"));
  const directory = join(ROOT, OUTPUT), packet = join(REPO, PACKET);
  assert.equal(existsSync(directory), false, "Capture receipt already exists");
  const prior = inventory(packet);
  assert.deepEqual(Object.keys(prior).sort(), ["EVIDENCE.yml", ...SHOTS.map(row => row.file)].sort());
  mkdirSync(directory); mkdirSync(join(directory, "prior"));
  for (const file of Object.keys(prior)) copyFileSync(join(packet, file), join(directory, "prior", file));
  assert.deepEqual(inventory(join(directory, "prior")), prior);
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const identity = checkout(), sources = sourceHashes();
  assert.deepEqual(sources, committedSourceHashes(identity.commit), "Capture sources differ from the recorded checkout");
  const receipt = { schema: "ticker-news.hosted-capture.v1", qualified: false, startedAt: new Date().toISOString(),
    checkout: identity, sources, runtime: runtime(), environment: env,
    preflight: { portIsClosed: true, devLockFilePresent },
    workflow: { repository: process.env.GITHUB_REPOSITORY, run: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB,
      event: process.env.GITHUB_EVENT_NAME, head: event.pull_request?.head?.sha,
      base: event.pull_request?.base?.sha },
    command: "npm run test:e2e:responsive -- e2e/ticker-news.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --output=" + OUTPUT + "/playwright --reporter=github,json",
    prior, otherPackets: otherPackets(), producerActivation: false, productionAcceptance: false,
    visualAcceptance: false };
  writeFileSync(join(directory, "prepared.json"), JSON.stringify(receipt, null, 2) + "\n");
  // Absence before the command is the freshness proof, even when new pixels
  // legitimately match prior pixels. Preserve the old manifest verbatim.
  for (const shot of SHOTS) rmSync(join(packet, shot.file));
  assert.deepEqual(readdirSync(packet), ["EVIDENCE.yml"]);
  writeFileSync(join(directory, "images-cleared.json"), JSON.stringify({
    startedAt: receipt.startedAt, absent: SHOTS.map(row => row.file), manifest: prior["EVIDENCE.yml"],
  }, null, 2) + "\n");
}
async function verify() {
  const directory = join(ROOT, OUTPUT), packet = join(REPO, PACKET);
  const prepared = JSON.parse(regularBytes(join(directory, "prepared.json")));
  const cleared = JSON.parse(regularBytes(join(directory, "images-cleared.json")));
  assert.equal(prepared.schema, "ticker-news.hosted-capture.v1");
  assert.equal(prepared.qualified, false);
  assert.deepEqual(cleared.absent, SHOTS.map(row => row.file));
  assert.equal(cleared.startedAt, prepared.startedAt);
  assert.equal(cleared.manifest, prepared.prior["EVIDENCE.yml"]);
  assert.deepEqual(executionEnvironment(), prepared.environment);
  assert.deepEqual(checkout(), prepared.checkout);
  assert.deepEqual(sourceHashes(), prepared.sources);
  assert.deepEqual(committedSourceHashes(prepared.checkout.commit), prepared.sources);
  assert.deepEqual(runtime(), prepared.runtime);
  assert.deepEqual(otherPackets(), prepared.otherPackets);
  assert.deepEqual(inventory(join(directory, "prior")), prepared.prior);
  assert.equal(sha256(regularBytes(join(packet, "EVIDENCE.yml"))), prepared.prior["EVIDENCE.yml"]);
  const reportBytes = regularBytes(join(ROOT, REPORT));
  const cases = validateReport(JSON.parse(reportBytes), prepared.startedAt);
  const names = readdirSync(packet).filter(file => file !== "EVIDENCE.yml");
  const images = validateImages(file => regularBytes(join(packet, file)), names);
  for (const shot of SHOTS) assert.ok(statSync(join(packet, shot.file)).mtimeMs >= Date.parse(prepared.startedAt), "Stale crop: " + shot.file);
  const portIsClosed = await portClosed(Number(prepared.environment.TERMINAL_E2E_PORT));
  const devLockFilePresent = existsSync(join(ROOT, ".next/dev/lock"));
  assert.equal(portIsClosed, true, "Playwright returned but lane port is not closed");
  mkdirSync(join(directory, "crops"));
  for (const shot of SHOTS) copyFileSync(join(packet, shot.file), join(directory, "crops", shot.file));
  assert.deepEqual(validateImages(file => regularBytes(join(directory, "crops", file)), readdirSync(join(directory, "crops"))), images);
  const receipt = { ...prepared, qualified: true, completedAt: new Date().toISOString(),
    reportSha256: sha256(reportBytes), cases, images, lifecycle: { playwrightReturned: true, portIsClosed, devLockFilePresent },
    manifestDisposition: "Prior manifest preserved; fresh images require a qualified artifact import before new source locks are committed." };
  writeFileSync(join(directory, "capture.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("Qualified ticker-news capture: 14 passed, 7 authored skips, 0 failures/flakes/retries; 10 fresh PNGs. Manifest unchanged.");
}

module.exports = { TITLES, SHOTS, SOURCES, VIEWPORTS, sha256, regularBytes, validateReport, validateImages };
if (require.main === module) {
  const mode = process.argv[2];
  assert.equal(process.argv.length, 3, "Use --prepare or --verify");
  assert.ok(mode === "--prepare" || mode === "--verify");
  (mode === "--prepare" ? prepare() : verify()).catch(error => { console.error(error); process.exitCode = 1; });
}
