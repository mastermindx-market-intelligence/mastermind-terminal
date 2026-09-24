#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exitCodeFor,
  redactReceipt,
  storageStateError,
  thesisIdFromUrl,
  validateReceipt,
  validateVersions,
} from "./thesisJourneyReceipt.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const base = process.env.PROOF_BASE_URL || "https://app.mastermind-x.com";
const release = (process.env.PROOF_RELEASE || "").trim();
const symbol = process.env.PROOF_SYMBOL || "NVDA";
const storageStateArgument = process.env.PROOF_STORAGE_STATE || "";
const outputDir = join(root, "docs/pr-crops/b-f11-10-thesis-journey-live");

class ProofFailure extends Error {
  constructor(message, kind = "assertion") {
    super(message);
    this.kind = kind;
  }
}

if (!/^[0-9a-f]{40}$/.test(release)) {
  console.error("Proof failed: the served release id is missing or malformed.");
  process.exit(2);
}

function assertion(message) {
  throw new ProofFailure(message);
}

async function assertResponse(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response || response.status() !== 200) assertion("Navigation did not return HTTP 200.");
  if (!(await response.text()).includes(`data-dpl-id="${release}"`)) {
    assertion("The deployed release does not match the requested release.");
  }
  return response;
}

async function assertJson(response, expectedStatus, expectedError) {
  if (response.status() !== expectedStatus) {
    assertion(`The API returned ${response.status()} instead of ${expectedStatus}.`);
  }
  if (!expectedError) return null;
  const body = await response.json().catch(() => null);
  if (body?.error !== expectedError) assertion("The API error body did not match the expected error.");
  return body;
}

function assertThesisScope(thesis, thesisId) {
  const requiredFields = ["id", "currentVersion", "lifecycleState", "current", "history"];
  if (requiredFields.some((field) => !(field in (thesis ?? {})))) assertion("The proof thesis detail response was incomplete.");
  if (thesis.id !== thesisId) assertion("The detail response did not return the proof thesis.");
  if (thesis.subject?.key !== symbol) assertion("The proof thesis is bound to the wrong analysis subject.");
  return thesis;
}

async function assertOwnThesis(request, thesisId) {
  const response = await request.get(`${base}/api/theses?id=${thesisId}`);
  if (response.status() !== 200) assertion("The proof thesis detail did not return HTTP 200.");
  const body = await response.json().catch(() => null);
  return assertThesisScope(body?.thesis, thesisId);
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!body) assertion("The API response was not valid JSON.");
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

function listTrackedLiveStateFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "--", "e2e/.live-state"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(output.split("\n").filter(Boolean));
  } catch {
    return null;
  }
}

function checkStorageState(path) {
  return storageStateError(path, {
    existsSync,
    readFileSync,
    resolve,
    root,
    trackedPaths: listTrackedLiveStateFiles,
  });
}

async function runPhaseA() {
  const browser = await chromium.launch({ headless: true });
  let browserErrorCount = 0;
  const phaseA = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") browserErrorCount += 1; });
    page.on("pageerror", () => { browserErrorCount += 1; });

    await assertResponse(page, `${base}/analysis?symbol=${encodeURIComponent(symbol)}`);
    if (await page.getByTestId("thesis-workspace").count() !== 0) assertion("Anonymous Analysis exposed the thesis workspace.");
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 15_000 });
    phaseA.push({ case: "Analysis gate blocks the thesis workspace", status: 200, ok: true });
    const analysisSymbol = page.getByRole("heading", { level: 1 });
    if (await analysisSymbol.count() !== 1) assertion("The analysis symbol page did not expose one page heading.");
    await analysisSymbol.screenshot({ path: join(outputDir, "phaseA-1-analysis-symbol.png") });

    await assertResponse(page, `${base}/analysis?view=theses`);
    await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible", timeout: 15_000 });
    phaseA.push({ case: "Theses view stays anonymous", status: 200, ok: true });
    const analysisTheses = page.getByRole("heading", { level: 1 });
    if (await analysisTheses.count() !== 1) assertion("The theses page did not expose one page heading.");
    await analysisTheses.screenshot({ path: join(outputDir, "phaseA-2-analysis-view-theses.png") });

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

    if (browserErrorCount > 0) assertion("The browser reported an error during Phase A.");
    await assertResponse(page, `${base}/alerts`);
    const anonymousFinal = page.getByRole("heading", { level: 1 });
    if (await anonymousFinal.count() !== 1) assertion("The final anonymous page did not expose one page heading.");
    await page.screenshot({ path: join(outputDir, "phaseA-final.png"), fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
  return { phaseA, browserErrorCount };
}

async function runPhaseB(storageState) {
  const browser = await chromium.launch({ headless: true });
  let browserErrorCount = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState,
    });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") browserErrorCount += 1; });
    page.on("pageerror", () => { browserErrorCount += 1; });

    await assertResponse(page, `${base}/terminal?symbol=${encodeURIComponent(symbol)}`);
    await page.getByTitle("Open full analysis").click();
    await page.waitForURL(`**/analysis?symbol=${symbol}`, { timeout: 15_000 });
    await assertResponse(page, page.url());
    await assertResponse(page, `${base}/analysis?view=theses&symbol=${encodeURIComponent(symbol)}`);
    await page.getByTestId("thesis-lens-rail").waitFor({ state: "visible", timeout: 15_000 });

    const title = `[proof ${release.slice(0, 8)}] ${symbol} journey ${new Date().toISOString()}`;
    await page.getByRole("button", { name: "New thesis", exact: true }).click();
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
    if (!created.lifecycleState) assertion("The created thesis response was incomplete.");
    await page.reload({ waitUntil: "domcontentloaded" });
    if (thesisIdFromUrl(page.url()) !== thesisId) assertion("Reload lost the proof thesis URL id.");
    await page.getByTestId("thesis-detail-pane").waitFor({ state: "visible", timeout: 15_000 });

    await page.getByLabel("Thesis statement").fill("Live proof revision remains scoped to the created thesis.");
    await page.getByLabel("Revision note").fill("Live proof revision.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const revised = await assertOwnThesis(page.request, thesisId);

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
    if (conflictResponse.status() !== 409) assertion("The stale revision did not return HTTP 409.");
    const conflictBody = await readJson(conflictResponse);
    if (conflictBody.error !== "version_conflict" || conflictBody.currentVersion !== 2) {
      assertion("The conflict response did not identify version two.");
    }
    const afterConflict = await assertOwnThesis(page.request, thesisId);

    await assertResponse(page, `${base}/analysis?view=theses&symbol=${encodeURIComponent(symbol)}`);
    await page.getByTestId("thesis-lens-rail").waitFor({ state: "visible", timeout: 15_000 });
    const proofRows = page.getByTestId("thesis-list-pane").getByRole("button").filter({ hasText: title });
    if (await proofRows.count() !== 1) assertion("The proof thesis row was absent or duplicated in the Theses lens.");
    await page.locator('[data-testid="thesis-lens-rail"] [role="tab"][data-view="coverage"]').click();
    if (await page.locator('[data-testid="thesis-lens-rail"] [role="tab"][data-view="coverage"][aria-selected="true"]').count() !== 1) {
      assertion("The coverage lens did not become the selected view.");
    }

    await assertResponse(page, `${base}/alerts`);
    await assertResponse(page, `${base}/analysis?view=theses&thesis=${thesisId}`);
    await page.getByTestId("thesis-detail-pane").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    const archived = await assertOwnThesis(page.request, thesisId);
    if (!validateVersions({ created, revised, archived })) {
      assertion("Create, revision, and archive did not form the exact version lineage.");
    }
    if (!archived.current || !archived.history) assertion("The archived thesis response was incomplete.");
    if (afterConflict.currentVersion !== 2 || archived.currentVersion !== 3) assertion("The stale conflict changed the proof thesis.");
    if (browserErrorCount > 0) assertion("The browser reported an error during Phase B.");
    await context.close();
    return {
      ran: true,
      route: "operator_url",
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
}

function receiptFor(phaseA, phaseB, browserErrorCount) {
  return {
    capturedAt: new Date().toISOString(),
    base,
    expectedRelease: release,
    phaseA,
    phaseB,
    browserErrorCount,
  };
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const { phaseA, browserErrorCount } = await runPhaseA();
  let anonymous = receiptFor(
    phaseA,
    { ran: false, route: "none", versions: [], archived: false },
    browserErrorCount,
  );
  const blockedReason = storageStateArgument
    ? checkStorageState(storageStateArgument)
    : "operator storage state was not supplied";
  try {
    if (!blockedReason) {
      const storageState = JSON.parse(readFileSync(resolve(storageStateArgument), "utf8"));
      const phaseB = await runPhaseB(storageState);
      const signedReceipt = receiptFor(phaseA, phaseB, browserErrorCount);
      writeFileSync(
        join(outputDir, "receipt-signed-in.json"),
        `${JSON.stringify(redactReceipt(signedReceipt), null, 2)}\n`,
      );
    }
  } catch (error) {
    if (!validateReceipt(redactReceipt(anonymous))) assertion("The anonymous receipt failed the five-case proof contract.");
    writeFileSync(join(outputDir, "receipt-anonymous.json"), `${JSON.stringify(redactReceipt(anonymous), null, 2)}\n`);
    throw error;
  }

  anonymous = redactReceipt(anonymous);
  if (!validateReceipt(anonymous)) assertion("The anonymous receipt failed the five-case proof contract.");
  writeFileSync(join(outputDir, "receipt-anonymous.json"), `${JSON.stringify(anonymous, null, 2)}\n`);
  const passed = anonymous.phaseA.filter((entry) => entry.ok).length;
  console.log(`Release: ${release}`);
  console.log(`Phase A: ${passed}/${anonymous.phaseA.length} cases passed`);
  console.log(blockedReason ? `Phase B not run: ${blockedReason}` : "Phase B completed and signed-in receipt written.");
  return exitCodeFor(null);
}

try {
  const exitCode = await main();
  process.exit(exitCode);
} catch (error) {
  const kind = error instanceof ProofFailure ? error.kind : "unexpected";
  console.error(`Proof failed: ${error.message}`);
  process.exit(exitCodeFor(kind));
}
