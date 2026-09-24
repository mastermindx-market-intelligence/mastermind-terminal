#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redactReceipt, validateReceipt } from "./thesisJourneyReceipt.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const base = process.env.PROOF_BASE_URL || "https://app.mastermind-x.com";
const release = (process.env.PROOF_RELEASE || "").trim();
const symbol = process.env.PROOF_SYMBOL || "NVDA";
const storageStateArgument = process.env.PROOF_STORAGE_STATE || "";
const outputDir = join(root, "docs/pr-crops/b-f11-10-thesis-journey-live");

if (!/^[0-9a-f]{40}$/.test(release)) {
  console.error("Proof failed: PROOF_RELEASE must be the exact served 40-character release id.");
  process.exit(2);
}

function assertion(message) {
  throw new Error(message);
}

async function assertResponse(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response || response.status() !== 200) assertion(`Navigation did not return 200 at ${url}.`);
  const marker = `data-dpl-id="${release}"`;
  if (!(await response.text()).includes(marker)) assertion(`Deployed release does not match the requested release.`);
  return response;
}

async function assertJson(response, expectedStatus, expectedError) {
  if (response.status() !== expectedStatus) assertion(`API returned ${response.status()} instead of ${expectedStatus}.`);
  if (expectedError) {
    const body = await response.json().catch(() => null);
    if (body?.error !== expectedError) assertion(`API error body did not confirm ${expectedError}.`);
  }
}

function thesisIdFromUrl(rawUrl) {
  const thesisId = new URL(rawUrl).searchParams.get("thesis");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(thesisId || "")) {
    assertion("Created proof thesis id was not returned through the URL.");
  }
  return thesisId.toLowerCase();
}

function assertThesisScope(thesis, thesisId) {
  if (thesis?.id !== thesisId) assertion("Detail response belonged to a different thesis.");
  return thesis;
}

async function assertOwnThesis(request, thesisId) {
  const response = await request.get(`${base}/api/theses?id=${thesisId}`);
  if (response.status() !== 200) assertion("Detail response did not return 200.");
  const body = await response.json().catch(() => null);
  return assertThesisScope(body?.thesis, thesisId);
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!body) assertion("API response was not valid JSON.");
  return body;
}

function subjectPayload() {
  return {
    schema: "mastermind.thesis-subject-ref/v1",
    kind: "issuer",
    owner: "terminal.analysis_symbol",
    key: symbol,
    identityState: "listing_scoped",
    listing: { symbol, mic: null, securityId: null },
    companyId: null,
    display: `${symbol} · listing scoped`,
  };
}

function contentPayload(title, statement, revisionNote = null) {
  return {
    schema: "mastermind.thesis-content/v1",
    title,
    statement,
    catalysts: [],
    falsifiers: [],
    risks: [],
    horizon: "quarters",
    effectiveAt: null,
    revisionNote,
  };
}

function checkStorageState(path) {
  if (!path) return "operator storage state was not supplied";
  const statePath = resolve(path);
  if (!existsSync(statePath)) return "operator storage state file does not exist";
  if (!statePath.startsWith(join(root, "e2e/.live-state/"))) {
    return "operator storage state must be inside the git-ignored live-state directory";
  }
  if (!readFileSync(join(root, ".gitignore"), "utf8").includes("e2e/.live-state/")) {
    return "operator storage state directory is not git-ignored";
  }
  const relative = join("e2e/.live-state", statePath.slice(join(root, "e2e/.live-state/").length));
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relative], { cwd: root, stdio: "pipe" });
    return "operator storage state is tracked by git";
  } catch {}
  return null;
}

async function runPhaseA() {
  const browser = await chromium.launch({ headless: true });
  const browserErrors = [];
  const phaseA = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await assertResponse(page, `${base}/analysis?symbol=${encodeURIComponent(symbol)}`);
    if (await page.locator('[data-testid="thesis-workspace"]').count() !== 0) assertion("Anonymous Analysis exposed the thesis workspace.");
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 15_000 });
    phaseA.push({ case: "Analysis gate blocks the thesis workspace", status: 200, ok: true });
    await page.screenshot({ path: join(outputDir, "phaseA-1-analysis-symbol.png"), fullPage: true });

    await assertResponse(page, `${base}/analysis?view=theses`);
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 15_000 });
    phaseA.push({ case: "Theses view stays anonymous", status: 200, ok: true });
    await page.screenshot({ path: join(outputDir, "phaseA-2-analysis-view-theses.png"), fullPage: true });

    const listResponse = await page.request.get(`${base}/api/theses`);
    await assertJson(listResponse, 401, "unauthenticated");
    phaseA.push({ case: "Anonymous thesis list is rejected", status: 401, ok: true });

    const createResponse = await page.request.post(`${base}/api/theses`, {
      data: {
        action: "create",
        clientRequestId: "99999999-9999-4999-8999-999999999999",
        subject: subjectPayload(),
        content: contentPayload("Anonymous proof attempt", "Anonymous writes must stay blocked."),
      },
    });
    await assertJson(createResponse, 401, "unauthenticated");
    phaseA.push({ case: "Anonymous thesis creation is rejected", status: 401, ok: true });

    const savedViewsResponse = await page.request.get(`${base}/api/thesis-saved-views`);
    await assertJson(savedViewsResponse, 401);
    phaseA.push({ case: "Anonymous saved views are rejected", status: 401, ok: true });

    await page.screenshot({ path: join(outputDir, "phaseA-final.png"), fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
  return { phaseA, browserErrors };
}

async function runPhaseB(storageState) {
  const browser = await chromium.launch({ headless: true });
  const browserErrors = [];
  let route = "none";
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState,
    });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await assertResponse(page, `${base}/terminal?symbol=${encodeURIComponent(symbol)}`);
    await page.getByTitle("Open full analysis").click();
    await page.waitForURL(`**/analysis?symbol=${symbol}`, { timeout: 15_000 });
    await assertResponse(page, page.url());

    const openTheses = page.getByLabel("Open Theses");
    if (await openTheses.count()) {
      route = "rail_control";
      await openTheses.click();
      await page.waitForURL(/view=theses/, { timeout: 15_000 });
    } else {
      route = "pasted_url_fallback";
      await assertResponse(page, `${base}/analysis?view=theses&symbol=${encodeURIComponent(symbol)}`);
    }
    await page.getByTestId("thesis-lens-rail").waitFor({ state: "visible", timeout: 15_000 });

    const title = `[proof ${release.slice(0, 8)}] ${symbol} journey ${new Date().toISOString()}`;
    await page.getByLabel("New thesis").click();
    await page.getByLabel("Subject").fill(symbol);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Thesis statement").fill("Live proof thesis created only for this release.");
    await page.getByLabel("Catalysts").fill("Live proof catalyst.");
    await page.getByLabel("Risks").fill("Live proof falsifies this thesis if the write is wrong.");
    await page.getByLabel("Horizon").selectOption("quarters");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/thesis=/, { timeout: 30_000 });
    const thesisId = thesisIdFromUrl(page.url());
    await page.getByTestId("thesis-detail-pane").waitFor({ state: "visible", timeout: 15_000 });

    const created = await assertOwnThesis(page.request, thesisId);
    if (created.currentVersion !== 1 || created.current?.previousVersion !== null) {
      assertion("Created thesis did not report version one.");
    }
    if (created.lifecycleState !== "active") assertion("Created thesis was not current.");
    if (created.current?.version !== 1) assertion("Created thesis current snapshot was not version one.");
    if (created.history?.length !== 1) assertion("Created thesis history did not contain one entry.");

    await page.reload({ waitUntil: "domcontentloaded" });
    if (!page.url().includes(`thesis=${thesisId}`)) assertion("Reload lost the proof thesis URL id.");
    await page.getByTestId("thesis-detail-pane").waitFor({ state: "visible", timeout: 15_000 });
    if (await page.getByTestId("thesis-detail-pane").getAttribute("data-thesis-id") !== thesisId) {
      assertion("Reloaded detail pane did not bind to the proof thesis id.");
    }

    await page.getByLabel("Thesis statement").fill("Live proof revision remains scoped to the created thesis.");
    await page.getByLabel("Revision note").fill("Live proof revision.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const revised = await assertOwnThesis(page.request, thesisId);
    if (revised.currentVersion !== 2 || revised.current.previousVersion !== 1 || revised.current.version !== 2) {
      assertion("Revision did not advance the proof thesis from version one to two.");
    }
    if (revised.history?.length !== 2) assertion("Revision history did not contain two entries.");

    const conflictResponse = await page.request.post(`${base}/api/theses`, {
      data: {
        action: "revise",
        id: thesisId,
        expectedVersion: 1,
        clientRequestId: randomUUID(),
        subject: subjectPayload(),
        content: contentPayload(title, "A stale write must not change the proof thesis.", "Conflict proof"),
      },
    });
    if (conflictResponse.status() !== 409) assertion("Stale revision did not return 409.");
    const conflictBody = await readJson(conflictResponse);
    if (conflictBody.error !== "version_conflict" || conflictBody.currentVersion !== 2) {
      assertion("Conflict response did not identify version two.");
    }
    const afterConflict = await assertOwnThesis(page.request, thesisId);
    if (afterConflict.currentVersion !== 2) assertion("Conflict changed the proof thesis.");

    await page.goto(`${base}/analysis?view=theses&symbol=${encodeURIComponent(symbol)}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("thesis-lens-rail").waitFor({ state: "visible", timeout: 15_000 });
    const proofRows = page.getByTestId("thesis-list-pane").getByRole("button").filter({ hasText: title });
    if (await proofRows.count() !== 1) assertion("Proof thesis row was absent or duplicated in the Theses lens.");
    await page.locator('[data-testid="thesis-lens-rail"] [role="tab"][data-view="coverage"]').click();
    if (await page.locator('[data-testid="thesis-lens-rail"] [role="tab"][data-view="coverage"][aria-selected="true"]').count() !== 1) {
      assertion("Coverage lens did not become the selected view.");
    }

    const alertsResponse = await page.request.get(`${base}/alerts`);
    if (alertsResponse.status() !== 200) assertion("Alerts page did not return 200.");
    await assertResponse(page, `${base}/alerts`);
    if (!(await page.locator("body").textContent())?.includes(release.slice(0, 8))) {
      assertion("Alerts page did not show the served release.");
    }

    await page.goto(`${base}/analysis?view=theses&thesis=${thesisId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    const archived = await assertOwnThesis(page.request, thesisId);
    if (archived.lifecycleState !== "archived" || archived.currentVersion !== 3) {
      assertion("Archive did not record version three with archived lifecycle state.");
    }
    if (archived.current?.version !== 3) assertion("Archived snapshot was not version three.");
    if (archived.history?.length !== 3) assertion("Archive history did not contain three entries.");
    await page.screenshot({ path: join(outputDir, "phaseB-archived.png"), fullPage: true });
    if (browserErrors.length > 0) assertion("Browser reported an error during Phase B.");
    await context.close();
    return {
      ran: true,
      route,
      thesisId,
      versions: [
        { version: created.currentVersion, previousVersion: created.current.previousVersion },
        { version: revised.currentVersion, previousVersion: revised.current.previousVersion },
        { version: archived.currentVersion, previousVersion: archived.current.previousVersion },
      ],
      archived: archived.lifecycleState === "archived",
    };
  } finally {
    await browser.close();
  }
  if (browserErrors.length > 0) assertion("Browser reported an error during Phase B.");
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const phaseA = await runPhaseA();
  const receipt = {
    capturedAt: new Date().toISOString(),
    base,
    expectedRelease: release,
    phaseA: phaseA.phaseA,
    phaseB: { ran: false, route: "none", versions: [], archived: false },
    browserErrors: phaseA.browserErrors,
  };
  const blockedReason = storageStateArgument ? checkStorageState(storageStateArgument) : "operator storage state was not supplied";
  if (!blockedReason) {
    const storageState = JSON.parse(readFileSync(resolve(storageStateArgument), "utf8"));
    const phaseB = await runPhaseB(storageState);
    signedReceipt = {
      capturedAt: new Date().toISOString(),
      base,
      expectedRelease: release,
      phaseA: phaseA.phaseA,
      phaseB,
      browserErrors: phaseA.browserErrors,
    };
    writeFileSync(join(outputDir, "receipt-signed-in.json"), `${JSON.stringify(redactReceipt(signedReceipt), null, 2)}\n`);
  }
  const anonymous = redactReceipt(receipt);
  if (!validateReceipt(anonymous)) assertion("Anonymous receipt failed the five-case proof contract.");
  writeFileSync(join(outputDir, "receipt-anonymous.json"), `${JSON.stringify(anonymous, null, 2)}\n`);
  const passed = anonymous.phaseA.filter((entry) => entry.ok).length;
  console.log(`Release: ${release}`);
  console.log(`Phase A: ${passed}/${anonymous.phaseA.length} cases passed`);
  if (blockedReason) {
    console.log(`Phase B not run: ${blockedReason}`);
  } else {
    console.log(`Phase B completed and signed-in receipt written.`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Proof failed: ${error.message}`);
  process.exit(1);
}
