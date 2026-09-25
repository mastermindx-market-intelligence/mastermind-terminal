#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  buildCompanyIntelligenceReceipt,
  COMPANY_INTELLIGENCE_LENSES,
  exitCodeFor,
  normalizeLensLabel,
  validateProofMeta,
} from "./companyIntelligenceLiveProofLib.mjs";
import {
  checkStorageState,
  redactReceipt,
  releaseFromHtml,
} from "./thesisJourneyLib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const meta = validateProofMeta({
  base: process.env.PROOF_BASE_URL || "https://app.mastermind-x.com",
  expectedRelease: (process.env.PROOF_RELEASE || "").trim(),
  symbol: (process.env.PROOF_SYMBOL || "NVDA").trim().toUpperCase(),
});
const storageStateArgument = process.env.PROOF_STORAGE_STATE || "";
const outputDir = resolve(process.env.PROOF_OUTPUT_DIR || join(root, "e2e/.live-state/company-intelligence"));

class ProofFailure extends Error {
  constructor(message, kind = "assertion") {
    super(message);
    this.kind = kind;
  }
}

function fail(message, kind = "assertion") {
  throw new ProofFailure(message, kind);
}

async function routeWithRelease(page, path) {
  const response = await page.goto(`${meta.base}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  }).catch(() => null);
  const body = response ? await response.text().catch(() => "") : "";
  const servedRelease = releaseFromHtml(body);
  if (!response || response.status() !== 200) fail(`Route ${path} did not return 200.`);
  if (servedRelease !== meta.expectedRelease) {
    fail(`Route ${path} served ${servedRelease || "no release"}, expected ${meta.expectedRelease}.`, "release");
  }
  return servedRelease;
}

async function visibleExactlyOnce(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 30_000 }).catch(() => fail(`${label} was not visible.`));
  if (await locator.count() !== 1) fail(`${label} was not unique.`);
  return locator;
}

async function waitForAttribute(locator, name, value, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await locator.getAttribute(name) === value) return;
    await locator.page().waitForTimeout(100);
  }
  fail(`${label} did not become ${name}=${value}.`);
}

async function applyProofPreferences(context) {
  await context.addInitScript(() => {
    window.localStorage.setItem("mm.lang", "en");
    window.localStorage.setItem("mm.theme", "dark");
  });
}

async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

function monitor(page) {
  let browserErrorCount = 0;
  page.on("pageerror", () => { browserErrorCount += 1; });
  return () => browserErrorCount;
}

async function runAnonymous() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await applyProofPreferences(context);
    const page = await context.newPage();
    const errors = monitor(page);
    const servedRelease = await routeWithRelease(
      page,
      `/analysis?symbol=${encodeURIComponent(meta.symbol)}&page=intelligence`,
    );
    const authGateVisible = await page.locator('input[type="email"], input[name="email"]').first().isVisible().catch(() => false)
      || await page.getByRole("button", { name: /sign in/i }).first().isVisible().catch(() => false)
      || await page.getByRole("link", { name: /sign in/i }).first().isVisible().catch(() => false);
    const workspaceAbsent = await page.locator(".ci-page").count() === 0;
    const screenshot = join(outputDir, "anonymous-auth-gate.png");
    await page.screenshot({ path: screenshot, fullPage: false });
    await context.close();
    return {
      ran: true,
      status: 200,
      route: `/analysis?symbol=${meta.symbol}&page=intelligence`,
      servedRelease,
      authGateVisible,
      workspaceAbsent,
      browserErrorCount: errors(),
      screenshot,
    };
  } finally {
    await browser.close();
  }
}

async function readLenses(page) {
  return page.locator(".ci-lenses [role=tab]").allTextContents()
    .then((labels) => [...new Set(labels.map(normalizeLensLabel))]);
}

async function proveEvidenceOverlay(page) {
  const canvas = page.locator(".ci-canvas");
  const before = await canvas.evaluate((element) => element.getBoundingClientRect().width);
  const receipts = await visibleExactlyOnce(
    page.locator(".ci-hero").getByRole("button", { name: /view receipts/i }),
    "The Company Intelligence receipts control",
  );
  await receipts.click();
  const evidence = await visibleExactlyOnce(page.locator(".ci-evidence"), "The Evidence overlay");
  await waitForAttribute(evidence, "aria-hidden", "false", "The Evidence overlay");
  const style = await evidence.evaluate((element) => getComputedStyle(element).position);
  if (style !== "fixed") fail("The Evidence overlay is not fixed over the research canvas.");
  const after = await canvas.evaluate((element) => element.getBoundingClientRect().width);
  if (Math.abs(after - before) > 1) fail("Opening Evidence reflowed the research canvas.");
  const close = await visibleExactlyOnce(page.locator(".ci-evidence-close"), "The Evidence close control");
  await close.click();
  await waitForAttribute(evidence, "aria-hidden", "true", "The Evidence overlay");
  return true;
}

async function proveIntelligenceViewport(browser, storageState, viewportName, viewport) {
  const context = await browser.newContext({ viewport, storageState });
  await applyProofPreferences(context);
  const page = await context.newPage();
  const errors = monitor(page);
  try {
    const servedRelease = await routeWithRelease(
      page,
      `/analysis?symbol=${encodeURIComponent(meta.symbol)}&page=intelligence`,
    );
    const workspace = await visibleExactlyOnce(page.locator(".ci-page"), "The Company Intelligence workspace");
    await page.locator(".ci-page[aria-busy='true']").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
    const symbolMatched = (await page.locator(".sym-pick strong").first().textContent())?.trim() === meta.symbol;
    const intelligenceFamilySelected = await page.locator('[data-fin-family="intelligence"]').first().getAttribute("aria-selected") === "true"
      || await page.locator(".fin-family-mobile-trigger").first().textContent().then((text) => /intelligence/i.test(text || "")).catch(() => false);
    const lenses = await readLenses(page);
    if (!COMPANY_INTELLIGENCE_LENSES.every((lens) => lenses.includes(lens))) {
      fail(`The ${viewportName} lens set was incomplete: ${lenses.join(", ")}.`);
    }

    const briefVisible = await page.locator("[data-ci-paper-brief]").isVisible();
    const companyVisual = await page.locator("[data-company-visual]").isVisible();
    const evidenceOverlay = await proveEvidenceOverlay(page);

    await page.locator(".ci-lenses").getByRole("tab", { name: "Results", exact: true }).click();
    const resultsVisible = await page.locator("[data-ci-paper-results]").isVisible();

    await page.locator(".ci-lenses").getByRole("tab", { name: "Call + Q&A", exact: true }).click();
    const call = await visibleExactlyOnce(page.locator("[data-ci-paper-call]"), "The Call + Q&A workspace");
    const callVisible = await call.isVisible();
    if (!(await call.textContent())?.includes("TOPIC MAP UNAVAILABLE")) {
      fail("Call + Q&A did not preserve the explicit unavailable topic-map boundary.");
    }

    await page.locator(".ci-lenses").getByRole("tab", { name: /^Sources(?:\s+\d+)?$/ }).click();
    const sourcesVisible = await page.locator("[data-ci-paper-sources]").isVisible();
    const overflowSafe = await noOverflow(page);
    const screenshot = join(outputDir, `${viewportName}-company-intelligence.png`);
    await page.screenshot({ path: screenshot, fullPage: false });

    if (!briefVisible || !resultsVisible || !callVisible || !sourcesVisible || !companyVisual || !overflowSafe) {
      fail(`The ${viewportName} Company Intelligence contract was incomplete.`);
    }
    if (errors() !== 0) fail(`The ${viewportName} journey emitted a browser error.`);

    return {
      viewport: viewportName,
      servedRelease,
      symbolMatched,
      intelligenceFamilySelected,
      lenses,
      plane: await workspace.getAttribute("data-ci-plane") || "company_intelligence_context.v1",
      briefVisible,
      resultsVisible,
      callVisible,
      sourcesVisible,
      evidenceOverlay,
      companyVisual,
      noOverflow: overflowSafe,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function proveOwnership(browser, storageState) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  await applyProofPreferences(context);
  const page = await context.newPage();
  try {
    await routeWithRelease(page, `/analysis?symbol=${encodeURIComponent(meta.symbol)}&page=ownership`);
    const ownership = await visibleExactlyOnce(page.locator(".fin-ownership-page"), "The Institutional Ownership workspace");
    await page.locator('[data-fin-family="ownership"]').waitFor({ state: "visible", timeout: 30_000 });
    const text = await ownership.textContent();
    return /not total ownership/i.test(text || "") && await noOverflow(page);
  } finally {
    await context.close();
  }
}

async function proveChartJourney(browser, storageState) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
  await applyProofPreferences(context);
  const page = await context.newPage();
  try {
    await routeWithRelease(page, `/terminal?symbol=${encodeURIComponent(meta.symbol)}`);
    await visibleExactlyOnce(page.locator(".chart-wrap canvas").first(), "The Terminal chart");
    const analysisLink = page.getByRole("link", { name: "Analysis", exact: true }).first();
    await analysisLink.click();
    await page.waitForURL(/\/analysis(?:\?|$)/, { timeout: 30_000 });
    const intelligenceFamily = await visibleExactlyOnce(
      page.locator('[data-fin-family="intelligence"]'),
      "The Intelligence family control",
    );
    await intelligenceFamily.click();
    await page.waitForURL(/[?&]page=intelligence(?:&|$)/, { timeout: 30_000 });
    await visibleExactlyOnce(page.locator(".ci-page"), "The chart-hosted Intelligence workspace");
    return (await page.locator(".sym-pick strong").first().textContent())?.trim() === meta.symbol;
  } finally {
    await context.close();
  }
}

async function runSignedIn(storageState) {
  const browser = await chromium.launch({ headless: true });
  try {
    const viewports = [];
    viewports.push(await proveIntelligenceViewport(browser, storageState, "desktop", { width: 1440, height: 900 }));
    viewports.push(await proveIntelligenceViewport(browser, storageState, "mobile", { width: 390, height: 844 }));
    const ownershipJourney = await proveOwnership(browser, storageState);
    const chartJourney = await proveChartJourney(browser, storageState);
    return {
      ran: true,
      viewports,
      ownershipJourney,
      chartJourney,
      browserErrorCount: 0,
    };
  } finally {
    await browser.close();
  }
}

function receiptPath() {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return join(outputDir, `receipt-${stamp}-${meta.expectedRelease.slice(0, 12)}.json`);
}

async function main() {
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const anonymous = await runAnonymous();
  const blockedReason = checkStorageState(storageStateArgument, { root });
  let signedIn;
  let exitKind = null;
  if (blockedReason) {
    signedIn = { ran: false, blockedReason };
    exitKind = "auth";
  } else {
    const storageState = JSON.parse(readFileSync(resolve(storageStateArgument), "utf8"));
    signedIn = await runSignedIn(storageState);
  }
  const receipt = redactReceipt(buildCompanyIntelligenceReceipt({
    capturedAt: new Date(),
    ...meta,
    anonymous,
    signedIn,
  }));
  const path = receiptPath();
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`Release: ${meta.expectedRelease}`);
  console.log(`Anonymous gate: ${anonymous.authGateVisible ? "PASS" : "FAIL"}`);
  console.log(signedIn.ran ? "Signed-in journeys: PASS" : `Signed-in journeys blocked: ${signedIn.blockedReason}`);
  console.log(`Receipt: ${path}`);
  return exitCodeFor(exitKind);
}

try {
  process.exit(await main());
} catch (error) {
  const kind = error instanceof ProofFailure ? error.kind : "assertion";
  console.error(error instanceof Error ? error.message : "The Company Intelligence live proof failed.");
  process.exit(exitCodeFor(kind));
}
