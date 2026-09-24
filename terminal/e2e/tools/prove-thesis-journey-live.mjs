#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  buildProofTitle,
  checkStorageState,
  detailFromResponse,
  exitCodeFor,
  redactReceipt,
  releaseFromHtml,
  thesisIdFromUrl,
  validateReceipt,
  validateSignedInReceipt,
  validateVersions,
  signedReceiptFor,
} from "./thesisJourneyLib.mjs";

const base = process.env.PROOF_BASE_URL || "https://app.mastermind-x.com";
const release = (process.env.PROOF_RELEASE || "").trim();
const symbol = process.env.PROOF_SYMBOL || "NVDA";
const storageStateArgument = process.env.PROOF_STORAGE_STATE || "";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = join(root, "docs/pr-crops/b-f11-10-thesis-journey-live");
const liveStateDir = join(root, "e2e/.live-state");
const anonymousPhaseB = { ran: false, route: "none", versions: [], archived: false };

class ProofFailure extends Error {
  constructor(kind = "assertion") {
    super("The live proof did not pass.");
    this.kind = kind;
  }
}

function assertion() {
  throw new ProofFailure();
}

async function settle(locator, description) {
  try {
    await locator.waitFor({ state: "visible", timeout: 15_000 });
    if (await locator.count() !== 1) throw new Error();
    return locator;
  } catch {
    console.error(`Proof failed: ${description}`);
    throw new ProofFailure();
  }
}

async function assertResponse(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  const body = response ? await response.text().catch(() => "") : "";
  if (!response || response.status() !== 200 || releaseFromHtml(body) !== release) assertion();
  return response;
}

async function assertJson(response, expectedStatus, expectedError) {
  if (response.status() !== expectedStatus) assertion();
  const body = await response.json().catch(() => null);
  if (!body || (expectedError && body.error !== expectedError)) assertion();
  return body;
}

function assertThesisScope(thesis, thesisId) {
  const requiredFields = ["id", "currentVersion", "lifecycleState", "current", "history"];
  if (requiredFields.some((field) => !(field in (thesis ?? {})))) assertion();
  if (thesis.subject?.key !== symbol) assertion();
  return detailFromResponse(thesis, thesisId);
}

async function readThesis(request, thesisId) {
  const response = await request.get(`${base}/api/theses?id=${thesisId}`);
  if (response.status() !== 200) assertion();
  const body = await response.json().catch(() => null);
  return assertThesisScope(body?.thesis, thesisId);
}

async function readJson(response) {
  const body = await response.json().catch(() => null);
  if (!body) assertion();
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

function proofLocators(page) {
  return {
    workspace: page.getByTestId("thesis-workspace"),
    rail: page.getByTestId("thesis-lens-rail"),
    thesesTab: page.locator('[data-testid="thesis-lens-rail"] [role="tab"][data-view="theses"]'),
    coverageTab: page.locator('[data-testid="thesis-lens-rail"] [role="tab"][data-view="coverage"]'),
    newThesis: page.getByRole("button", { name: "New thesis", exact: true }),
    subject: page.getByLabel("Subject", { exact: true }),
    title: page.getByLabel("Title", { exact: true }),
    statement: page.getByLabel("Thesis statement", { exact: true }),
    catalysts: page.getByLabel("Catalysts", { exact: true }),
    risks: page.getByLabel("Risks", { exact: true }),
    horizon: page.getByLabel("Horizon", { exact: true }),
    revisionNote: page.getByLabel("Revision note", { exact: true }),
    save: page.getByRole("button", { name: "Save", exact: true }),
    archive: page.getByRole("button", { name: "Archive", exact: true }),
  };
}

const INTERACTIVE_LOCATORS = new Set([
  "newThesis", "subject", "title", "statement", "catalysts", "risks", "horizon",
  "revisionNote", "save", "archive",
]);

async function preflightLocators(page, requestedLocators) {
  const locators = proofLocators(page);
  const failures = [];
  await Promise.all(requestedLocators.map(async (name) => {
    try {
      const locator = locators[name];
      await locator.waitFor({ state: "visible", timeout: 5_000 });
      if (await locator.count() !== 1) throw new Error();
      if (INTERACTIVE_LOCATORS.has(name) && !(await locator.isEnabled())) throw new Error();
    } catch {
      failures.push(name);
    }
  }));
  if (failures.length) {
    console.error(`Proof failed: these Phase B controls were not ready: ${failures.sort().join(", ")}.`);
    assertion();
  }
  return locators;
}

async function settleVersion(page, version) {
  const currentVersion = page.locator(`[data-testid="thesis-workspace"] [data-version="${version}"][data-current="true"]`);
  await settle(currentVersion, `Version ${version} did not become current.`);
}

async function archiveBestEffort(request, thesisId) {
  try {
    const detailResponse = await request.get(`${base}/api/theses?id=${thesisId}`);
    if (detailResponse.status() !== 200) return false;
    const thesis = (await detailResponse.json())?.thesis;
    if (!thesis || thesis.id !== thesisId || thesis.lifecycleState !== "active") return false;
    const archiveResponse = await request.post(`${base}/api/theses`, {
      data: {
        action: "archive",
        id: thesisId,
        expectedVersion: thesis.currentVersion,
        clientRequestId: randomUUID(),
        subject: thesis.current.subject,
        content: thesis.current.content,
      },
    });
    return archiveResponse.status() === 200;
  } catch {
    return false;
  }
}

// Failure-path cleanup. By id when the URL surfaced it; otherwise — the create click was sent but the URL never
// yielded ?thesis= (audit M1: a create that lands server-side while the client bails to its "ambiguous" message) —
// by the deterministic proof title through the list API, so a landed create is never orphaned silently. The title
// is always printed as the operator's manual handle. Never throws.
async function cleanupProofThesis(page, thesisId, createAttempted, title) {
  if (!page || !createAttempted) return false;
  try {
    if (thesisId) {
      const ok = await archiveBestEffort(page.request, thesisId);
      console.log(`Cleanup: proof thesis ${thesisId} archive-on-failure ${ok ? "succeeded" : "not needed or failed"}.`);
      return ok;
    }
    console.log(`Cleanup: the URL never surfaced the proof thesis id; searching your theses for the title "${title}".`);
    const listResponse = await page.request.get(`${base}/api/theses`);
    if (listResponse.status() !== 200) {
      console.log("Cleanup: the list request failed; archive the thesis with that title by hand.");
      return false;
    }
    const rows = ((await listResponse.json())?.theses || []).filter((row) => row?.title === title && row?.lifecycleState === "active");
    if (rows.length !== 1) {
      console.log(`Cleanup: ${rows.length} active theses carry that title; nothing archived automatically.`);
      return false;
    }
    const ok = await archiveBestEffort(page.request, rows[0].id);
    console.log(`Cleanup: proof thesis ${rows[0].id} recovered by title; archive ${ok ? "succeeded" : "failed — archive it by hand"}.`);
    return ok;
  } catch {
    console.log(`Cleanup could not run; find the proof thesis by its title "${title}" and archive it by hand.`);
    return false;
  }
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
    await settle(page.getByRole("heading", { level: 1 }), "The anonymous analysis heading was not unique.");
    if ((await page.getByTestId("thesis-workspace").count()) !== 0) assertion();
    phaseA.push({ case: "Analysis gate blocks the thesis workspace.", status: 200, ok: true });
    await page.getByRole("heading", { level: 1 }).screenshot({ path: join(outputDir, "phaseA-1-analysis-symbol.png") });

    await assertResponse(page, `${base}/analysis?view=theses`);
    const anonymousThesesHeading = await settle(page.getByRole("heading", { level: 1 }), "The anonymous theses heading was not unique.");
    if ((await page.getByTestId("thesis-workspace").count()) !== 0) assertion();
    phaseA.push({ case: "Theses view stays anonymous.", status: 200, ok: true });
    await anonymousThesesHeading.screenshot({ path: join(outputDir, "phaseA-2-analysis-view-theses.png") });

    const listResponse = await page.request.get(`${base}/api/theses`);
    await assertJson(listResponse, 401, "unauthenticated");
    phaseA.push({ case: "Anonymous thesis list is rejected.", status: 401, ok: true });

    const createResponse = await page.request.post(`${base}/api/theses`, {
      data: {
        action: "create",
        clientRequestId: "99999999-9999-4999-8999-999999999999",
        subject: subjectPayload(),
        content: contentPayload("Anonymous proof attempt", "Anonymous writes must stay blocked."),
      },
    });
    await assertJson(createResponse, 401, "unauthenticated");
    phaseA.push({ case: "Anonymous thesis creation is rejected.", status: 401, ok: true });

    const savedViewsResponse = await page.request.get(`${base}/api/thesis-saved-views`);
    await assertJson(savedViewsResponse, 401);
    phaseA.push({ case: "Anonymous saved views are rejected.", status: 401, ok: true });

    if (browserErrorCount !== 0) assertion();
    await assertResponse(page, `${base}/alerts`);
    await settle(page.getByRole("heading", { level: 1 }), "The final anonymous heading was not unique.");
    await page.screenshot({ path: join(outputDir, "phaseA-final.png"), fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
  return { phaseA, browserErrorCount };
}

async function runPhaseB(storageState) {
  const browser = await chromium.launch({ headless: true });
  let phaseBBrowserErrorCount = 0;
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
    page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") phaseBBrowserErrorCount += 1; });
    page.on("pageerror", () => { phaseBBrowserErrorCount += 1; });

    await assertResponse(page, `${base}/analysis?view=theses&symbol=${encodeURIComponent(symbol)}`);
    const controls = await preflightLocators(page, [
      "workspace", "rail", "thesesTab", "coverageTab", "newThesis", "subject", "title",
      "statement", "catalysts", "risks", "horizon", "revisionNote", "save",
    ]);
    if (await controls.workspace.getAttribute("data-list-state") !== "ready") assertion();

    const title = buildProofTitle(release, symbol);
    let thesisId = null;
    let createAttempted = false;
    let completed = false;
    try {
      await controls.newThesis.click();
      await settle(controls.subject, "The create form subject field was not ready.");
      await settle(controls.title, "The create form title field was not ready.");
      await settle(controls.statement, "The create form statement field was not ready.");
      await settle(controls.catalysts, "The create form catalysts field was not ready.");
      await settle(controls.risks, "The create form risks field was not ready.");
      await settle(controls.horizon, "The create form horizon field was not ready.");
      await controls.subject.fill(symbol);
      await controls.title.fill(title);
      await controls.statement.fill("This live proof creates one thesis and then archives it. 这次实测创建一个论点，然后将其归档。");
      await controls.catalysts.fill("The release marker matches the requested deployment. 发布标记与请求的部署一致。");
      await controls.risks.fill("A failed proof archives this one thesis. 失败的实测会归档这一个论点。");
      await controls.horizon.selectOption("quarters");
      createAttempted = true;
      await controls.save.click();
      await page.waitForURL(/\/analysis\?view=theses&thesis=[0-9a-f-]{36}$/i, { timeout: 30_000 });
      thesisId = thesisIdFromUrl(page.url());
      await settle(page.getByTestId("thesis-detail-pane"), "The created thesis detail pane was not visible.");
      await settleVersion(page, 1);
      const activeControls = await preflightLocators(page, [
        "workspace", "rail", "thesesTab", "coverageTab", "title", "statement",
        "catalysts", "risks", "horizon", "revisionNote", "save", "archive",
      ]);
      if (await activeControls.workspace.getAttribute("data-list-state") !== "ready") assertion();
      const created = await readThesis(page.request, thesisId);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => thesisIdFromUrl(url.href) === thesisId, { timeout: 30_000 });
      await settle(page.getByTestId("thesis-detail-pane"), "The reloaded thesis detail pane was not visible.");
      await settleVersion(page, 1);
      await settle(controls.statement, "The revision statement field was not ready.");
      await settle(controls.revisionNote, "The revision note field was not ready.");
      await settle(controls.save, "The revision save control was not ready.");
      await activeControls.statement.fill("This revision stays attached to the one thesis created for this proof. 本修订仍属于为本次实测创建的同一论点。");
      await activeControls.revisionNote.fill("This sentence records the live proof revision. 这句话记录实测修订。");
      await activeControls.save.click();
      await settleVersion(page, 2);
      const revised = await readThesis(page.request, thesisId);

      const conflictResponse = await page.request.post(`${base}/api/theses`, {
        data: {
          action: "revise",
          id: thesisId,
          expectedVersion: 1,
          clientRequestId: randomUUID(),
          subject: subjectPayload(),
          content: contentPayload(title, "A stale write must not change this thesis. 过期写入不得更改这个论点。", "Stale proof attempt. 过期实测尝试。"),
        },
      });
      if (conflictResponse.status() !== 409) assertion();
      const conflictBody = await readJson(conflictResponse);
      if (conflictBody.error !== "version_conflict" || conflictBody.currentVersion !== 2) assertion();
      const afterConflict = await readThesis(page.request, thesisId);

      await assertResponse(page, `${base}/analysis?view=theses&symbol=${encodeURIComponent(symbol)}`);
      await settle(controls.rail, "The thesis lens rail was not visible.");
      const selectedTheses = controls.thesesTab.and(page.locator('[aria-selected="true"]'));
      await settle(selectedTheses, "The Theses lens was not selected.");
      const proofRow = page.getByTestId("thesis-list-pane").getByRole("button").filter({ hasText: title });
      await settle(proofRow, "The proof thesis row was not unique in the Theses lens.");
      await controls.coverageTab.click();
      const selectedCoverage = controls.coverageTab.and(page.locator('[aria-selected="true"]'));
      await settle(selectedCoverage, "The Coverage lens was not selected.");

      await assertResponse(page, `${base}/alerts`);
      await assertResponse(page, `${base}/analysis?view=theses&thesis=${thesisId}`);
      await settle(page.getByTestId("thesis-detail-pane"), "The archived thesis detail pane was not visible.");
      await settleVersion(page, 2);
      const archive = await settle(activeControls.archive, "The archive control was not ready.");
      await archive.click();
      await settleVersion(page, 3);
      if (!(await activeControls.title.isDisabled())) assertion();
      const archived = await readThesis(page.request, thesisId);
      if (!validateVersions({ created, revised, archived })) assertion();
      if (afterConflict.currentVersion !== 2 || archived.currentVersion !== 3) assertion();
      if (phaseBBrowserErrorCount !== 0) assertion();
      completed = true;
      await context.close();
      const versions = [
        { version: created.currentVersion, previousVersion: created.current.previousVersion },
        { version: revised.currentVersion, previousVersion: revised.current.previousVersion },
        { version: archived.currentVersion, previousVersion: archived.current.previousVersion },
      ];
      return {
        ran: true,
        route: "operator_url",
        versions,
        archived: archived.lifecycleState === "archived",
        browserErrorCount: phaseBBrowserErrorCount,
      };
    } catch (error) {
      if (error instanceof ProofFailure) throw error;
      throw new ProofFailure();
    } finally {
      // Runs on every non-success exit after the create click was sent — by id when the URL surfaced it, else by title.
      if (!completed) await cleanupProofThesis(page, thesisId, createAttempted, title);
    }
  } finally {
    await browser.close();
  }
}

// Phase B's receipt is built by thesisJourneyLib.signedReceiptFor from the Phase B RESULT (which carries its own
// browser-error count) — never from a counter scoped inside runPhaseB (round-4 ReferenceError on the success path).
function receiptFor(phaseA, phaseB, phaseBrowserErrorCount) {
  return {
    capturedAt: new Date().toISOString(),
    base,
    expectedRelease: release,
    phaseA,
    phaseB,
    browserErrorCount: phaseBrowserErrorCount,
  };
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const { phaseA, browserErrorCount } = await runPhaseA();
  let anonymous = receiptFor(phaseA, anonymousPhaseB, browserErrorCount);
  const blockedReason = storageStateArgument
    ? checkStorageState(storageStateArgument, { root })
    : "The operator storage state was not supplied.";
  try {
    if (!blockedReason) {
      const storageState = JSON.parse(readFileSync(resolve(storageStateArgument), "utf8"));
      const phaseB = await runPhaseB(storageState);
      const signedReceipt = signedReceiptFor(phaseA, phaseB, { base, expectedRelease: release });
      if (!validateSignedInReceipt(signedReceipt)) assertion();
      mkdirSync(liveStateDir, { recursive: true });
      writeFileSync(join(liveStateDir, "receipt-signed-in.json"), `${JSON.stringify(redactReceipt(signedReceipt), null, 2)}\n`);
    }
  } catch (error) {
    anonymous = redactReceipt(anonymous);
    writeFileSync(join(outputDir, "receipt-anonymous.json"), `${JSON.stringify(anonymous, null, 2)}\n`);
    throw error;
  }

  anonymous = redactReceipt(anonymous);
  if (!validateReceipt(anonymous)) assertion();
  writeFileSync(join(outputDir, "receipt-anonymous.json"), `${JSON.stringify(anonymous, null, 2)}\n`);
  const passed = anonymous.phaseA.filter((entry) => entry.ok).length;
  console.log(`Release: ${release}`);
  console.log(`Phase A: ${passed}/${anonymous.phaseA.length} cases passed`);
  console.log(`Browser errors: ${anonymous.browserErrorCount}`);
  console.log(blockedReason ? `Phase B not run: ${blockedReason}` : "Phase B completed and its redacted receipt was written.");
  return exitCodeFor(null);
}

if (!/^[0-9a-f]{40}$/i.test(release)) {
  console.error("Proof failed: the served release id is missing or malformed.");
  process.exit(exitCodeFor("release"));
}

try {
  process.exit(await main());
} catch {
  console.error("Proof failed: the prover did not pass.");
  process.exit(exitCodeFor("assertion"));
}
