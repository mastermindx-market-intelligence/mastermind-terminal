#!/usr/bin/env node
/**
 * Capture the complete active recurring-inbox matrix on /alerts.
 * From terminal/: node e2e/tools/capture_b_f11_7_recurring_briefs.cjs --active-inbox
 * The original mixed inbox/subscription packet remains historical.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- plain Node capture tool */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync,
  existsSync, readdirSync, realpathSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { chromium, expect } = require("@playwright/test");
const { startLegacyServer, reportLegacyServer, waitLegacyServer, settleLegacyServer } =
  require("./capture_ci_evidence.cjs");
const { SCHEMA, CONTRACT, MANIFEST, PACKET_PATH, VIEWPORTS, SHOTS, sha256,
  sourceHashes, lockedVersions, pngSize, regularBytes, readInboxPacket } = require("./briefs_inbox_capture_contract.cjs");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(REPO, PACKET_PATH);
const PORT = Number(process.env.TERMINAL_CROP_PORT || 47284);
const BASE = "http://127.0.0.1:" + PORT;
const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const READY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const READY_BODY = {
  target: { kind: "thesis", id: THESIS, name: "NVDA cycle", version_or_asof: "v3" },
  market_read: [
    { section: "tape", sentence_en: "The close held above last week's range.",
      sentence_zh: "收盘守住了上周的区间。", translation_status: "available", asof: "2026-09-11" },
    { section: "flow", sentence_en: "Call buying stayed in the front week.",
      sentence_zh: null, translation_status: "unavailable", asof: "2026-09-11" },
    { section: "watch_items", sentence_en: "Watch credit.", sentence_zh: null,
      translation_status: "unavailable", asof: "2026-09-11" },
  ],
  monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
  artifact: { name: "US session digest", asof: "2026-09-11T20:05:00.000Z" },
};
const SUBSCRIPTION = { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close",
  state: "active", targetName: "NVDA cycle" };
const LIST_DELIVERIES = [
  { deliveryId: "d-deg", subscriptionId: "s1", slotAsof: "2026-09-11", state: "degraded",
    body: {}, createdAt: "2026-09-11T20:10:00.000Z", subscription: SUBSCRIPTION },
  { deliveryId: READY_ID, subscriptionId: "s1", slotAsof: "2026-09-10", state: "ready",
    pinned: true, body: READY_BODY, createdAt: "2026-09-10T20:10:00.000Z", subscription: SUBSCRIPTION },
];
const COPY = {
  en: { title: "Briefs", email: "Briefs appear here in the Terminal. Email delivery isn't available yet.",
    empty: "No briefs yet — subscribe a thesis or watchlist to get one after the next close.",
    sharing: "Review team sharing" },
  zh: { title: "简报", email: "简报会出现在终端里。邮件送达尚未开通。",
    empty: "还没有简报。订阅一份论点或观察列表，下次收盘后就会收到。", sharing: "查看团队分享" },
};

function checkoutIdentity() {
  const git = argument => execFileSync("git", ["rev-parse", argument], { cwd: ROOT, encoding: "utf8" }).trim();
  return { commit: git("HEAD"), tree: git("HEAD^{tree}") };
}

function runtimeVersions() {
  const version = name => JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version;
  return { node: process.version, next: version("next"), playwright: version("@playwright/test") };
}

async function installInputs(page, deliveries, reads, writes, invalidReads) {
  await page.route("**/api/briefs/deliveries**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ status: 405, json: { error: "unexpected_write" } });
    }
    if (url.searchParams.get("contract") !== CONTRACT) {
      invalidReads.push(url.pathname + url.search);
      return route.fulfill({ status: 400, json: { error: "contract_required" } });
    }
    reads.push({ method: "GET", path: url.pathname, contract: CONTRACT });
    return route.fulfill({ json: { contract: CONTRACT, deliveries } });
  });
  await page.route("**/api/briefs/subscriptions**", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { subscriptions: [] } });
    writes.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
    return route.fulfill({ status: 405, json: { error: "unexpected_write" } });
  });
  await page.route("**/api/alerts**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push({ method: request.method(), path });
      return route.fulfill({ status: 405, json: { error: "unexpected_write" } });
    }
    if (path === "/api/alerts") return route.fulfill({ json: { alerts: [] } });
    if (path === "/api/alerts/receipts") return route.fulfill({ json: {
      run: null, runs_state: "READ_OK_ZERO", last_success_at: null, outbox: [], outbox_state: "READ_OK_ZERO",
    } });
    return route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } });
  });
}

async function assertState(page, shot) {
  const inbox = page.locator('[data-briefs-module="inbox"]'), copy = COPY[shot.lang];
  await expect(inbox).toBeVisible();
  await inbox.scrollIntoViewIfNeeded();
  await expect(inbox).toHaveAttribute("aria-busy", "false");
  await expect(inbox.getByRole("heading", { name: copy.title, exact: true })).toBeVisible();
  await expect(inbox.getByTestId("briefs-email-null")).toHaveText(copy.email);
  await expect(page.getByTestId("brief-subscribe")).toHaveCount(0);
  await expect(page.locator("[data-nextjs-dev-tools-button]")).toHaveCount(0);
  if (shot.kind === "list") {
    await expect(inbox.locator("[data-brief-row]")).toHaveCount(2);
    await expect(inbox.locator("[data-brief-miss]")).toHaveCount(1);
    await expect(inbox.locator("[data-brief-pinned]")).toHaveCount(1);
    await expect(inbox.locator("[data-brief-date]")).toHaveText(["2026-09-11", "2026-09-10"]);
    await expect(inbox.locator("[data-brief-language-availability]"))
      .toContainText(shot.lang === "zh" ? "1/3" : "1 of 3");
    await expect(inbox).toContainText(shot.lang === "zh"
      ? "英文原文：" + READY_BODY.market_read[1].sentence_en : READY_BODY.market_read[1].sentence_en);
    await expect(inbox).toContainText(shot.lang === "zh"
      ? READY_BODY.market_read[0].sentence_zh : READY_BODY.market_read[0].sentence_en);
    await expect(inbox).not.toContainText("Watch credit.");
    await expect(inbox).not.toContainText("翻译待补");
    await expect(inbox.getByRole("link", { name: copy.sharing, exact: true }))
      .toHaveAttribute("href", "/briefs/" + READY_ID + "/sharing");
  } else {
    await expect(inbox.locator("[data-brief-row]")).toHaveCount(0);
    await expect(inbox.locator('[data-briefs-state="empty"]')).toHaveText(copy.empty);
  }
  assert.ok(await inbox.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    "Inbox has horizontal overflow");
  return inbox;
}

async function captureCase(browser, shot, stage) {
  const viewport = VIEWPORTS[shot.viewport];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1,
    hasTouch: shot.viewport === "mobile", locale: shot.lang === "zh" ? "zh-CN" : "en-US", colorScheme: "dark" });
  const reads = [], writes = [], invalidReads = [], browserErrors = [];
  let result, failure;
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    page.on("pageerror", error => browserErrors.push(error.message));
    await installInputs(page, shot.kind === "list" ? LIST_DELIVERIES : [], reads, writes, invalidReads);
    await page.addInitScript(lang => {
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("theme", "dark");
      localStorage.setItem("theme_auto", "0");
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.setAttribute("data-lang", lang);
      document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    }, shot.lang);
    await page.goto(BASE + "/alerts?lang=" + shot.lang, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const inbox = await assertState(page, shot);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.mouse.move(0, 0);
    const before = { crop: await inbox.boundingBox(), text: await inbox.innerText() };
    assert.ok(before.crop);
    const bytes = await inbox.screenshot({ path: join(stage, shot.file), animations: "disabled" });
    await assertState(page, shot);
    assert.deepEqual({ crop: await inbox.boundingBox(), text: await inbox.innerText() }, before,
      "Inbox state changed while the screenshot was taken");
    result = { file: shot.file, kind: shot.kind, lang: shot.lang, route: "/alerts", viewport,
      deviceScaleFactor: 1, crop: before.crop, image: { ...pngSize(bytes), sha256: sha256(bytes) },
      proof: { settled: true, rows: shot.kind === "list" ? 2 : 0,
        missRows: shot.kind === "list" ? 1 : 0, pinnedRows: shot.kind === "list" ? 1 : 0,
        subscriptionControls: 0, unexpectedWrites: 0, devIndicators: 0, browserErrors,
        text: before.text, textSha256: sha256(Buffer.from(before.text)) } };
  } catch (error) { failure = error; }
  finally {
    try { await context.close(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], "Capture and context cleanup failed") : error; }
  }
  if (failure) throw failure;
  assert.deepEqual(writes, [], "Unexpected fixture write");
  assert.deepEqual(invalidReads, [], "The current explicit-language request was not used");
  assert.deepEqual(browserErrors, [], "Browser error during inbox capture");
  assert.ok(reads.length > 0);
  result.proof.contractReads = reads.length;
  return result;
}

async function main(args = process.argv.slice(2)) {
  assert.deepEqual(args, ["--active-inbox"],
    "Use --active-inbox for the complete current packet; the original mixed packet is historical");
  assert.equal((process.env.CAPTURE_ONLY || "").trim(), "", "A subset cannot qualify active inbox evidence");
  const checkout = checkoutIdentity(), sources = sourceHashes(REPO), runtime = runtimeVersions();
  const versions = lockedVersions(REPO);
  assert.equal(runtime.next, versions.next);
  assert.equal(runtime.playwright, versions.playwright);
  const stageRoot = mkdtempSync(join(tmpdir(), "mmx-briefs-active-inbox-"));
  const stage = join(stageRoot, "packet");
  mkdirSync(stage);
  console.log("capture stage " + stageRoot);
  const cases = [], failures = [];
  let child, browser, browserClosed = false, serverSettled = false;
  try {
    child = startLegacyServer(ROOT, PORT);
    await reportLegacyServer(child, "started");
    await waitLegacyServer(child, BASE + "/alerts?lang=en", 180_000);
    browser = await chromium.launch({ headless: true });
    for (const shot of SHOTS) {
      cases.push(await captureCase(browser, shot, stage));
      console.log("capture " + shot.file + " ok");
    }
  } catch (error) { failures.push(error); }
  finally {
    if (browser) {
      try { await browser.close(); browserClosed = true; } catch (error) { failures.push(error); }
    }
    if (child) {
      try { await settleLegacyServer(child); serverSettled = true; } catch (error) { failures.push(error); }
    }
  }
  const cleanup = { contextsClosed: cases.length, browserClosed, serverSettled };
  writeFileSync(join(stageRoot, "capture-proof.json"), JSON.stringify({
    checkout, sources, runtime, cleanup, cases, errors: failures.map(error => String(error)),
  }, null, 2) + "\n");
  if (failures.length) throw new AggregateError(failures, "Inbox capture or cleanup failed; prior packets preserved");
  assert.deepEqual(checkoutIdentity(), checkout, "Checkout changed during capture");
  assert.deepEqual(sourceHashes(REPO), sources, "Source changed during capture");
  const packet = { schema: SCHEMA, scope: "active-inbox", theme: "dark", contract: CONTRACT,
    producerActivation: false, productionAcceptance: false, captureFlag: "TERMINAL_E2E_FIXTURE",
    mechanism: "playwright-locator-screenshot", capturedAt: new Date().toISOString(),
    checkout, sources, runtime, cleanup, cases };
  writeFileSync(join(stage, MANIFEST), JSON.stringify(packet, null, 2) + "\n");
  readInboxPacket(REPO, stage);
  if (existsSync(OUT)) {
    assert.equal(realpathSync(OUT), resolve(OUT), "Symlink output directory");
    const allowed = new Set([MANIFEST, ...SHOTS.map(shot => shot.file)]);
    assert.ok(readdirSync(OUT).every(file => allowed.has(file)), "Unexpected existing active packet member");
    for (const file of readdirSync(OUT)) regularBytes(join(OUT, file));
  }
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) copyFileSync(join(stage, shot.file), join(OUT, shot.file));
  // The selector is written only after all eight qualified images are present.
  copyFileSync(join(stage, MANIFEST), join(OUT, MANIFEST));
  readInboxPacket(REPO);
  console.log(JSON.stringify({ briefsInboxEvidence: { packet: PACKET_PATH, cases: cases.length,
    checkout, runtime, stage: stageRoot, producerActivation: false, productionAcceptance: false } }));
}

module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
