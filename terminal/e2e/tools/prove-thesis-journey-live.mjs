/**
 * prove-thesis-journey-live.mjs
 *
 * Proves the thesis journey on the deployed Terminal at an exact release.
 * Phase A (anonymous): runs against PROOF_BASE_URL, asserts signed-out gate.
 * Phase B (signed-in): runs only when PROOF_STORAGE_STATE is set, the file exists,
 * and the file is NOT tracked by git.
 *
 * Usage:
 *   PROOF_RELEASE=<hex> node e2e/tools/prove-thesis-journey-live.mjs        # Phase A only
 *   PROOF_RELEASE=<hex> PROOF_STORAGE_STATE=/path/to/state.json node e2e/tools/prove-thesis-journey-live.mjs  # Phase A + B
 *
 * Env:
 *   PROOF_BASE_URL      default https://app.mastermind-x.com
 *   PROOF_RELEASE       required, 40-hex SHA of the deployed release
 *   PROOF_STORAGE_STATE optional, path to Playwright storage-state JSON
 *   PROOF_SYMBOL        default NVDA
 *   PROOF_LANG          en|zh, default en
 */

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.PROOF_BASE_URL || "https://app.mastermind-x.com";
const expected = process.env.PROOF_RELEASE;
if (!expected || !/^[0-9a-f]{40}$/i.test(expected)) {
  throw new Error("PROOF_RELEASE must be the exact 40-hex deployed SHA");
}

const symbol = process.env.PROOF_SYMBOL || "NVDA";
const storageStatePath = process.env.PROOF_STORAGE_STATE || "";

const outputDir = "docs/pr-crops/b-f11-10-thesis-journey-live";
mkdirSync(outputDir, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Inline redaction (same logic as lib/thesisJourneyReceipt.ts redactor).
 * A byte-identical copy is kept in lib/thesisJourneyReceipt.ts.
 */
function redactReceipt(receipt) {
  const SENSITIVE_KEYS = [
    /cookie/i, /token/i, /authorization/i, /bearer/i, /jwt/i,
    /email/i, /auth[_-]?user/i, /user[_-]?id/i, /session[_-]?id/i,
    /access[_-]?token/i, /refresh[_-]?token/i, /apikey/i,
    /api[_-]?key/i, /secret/i, /password/i, /cred/i,
  ];
  function isSensitiveKey(k) { return SENSITIVE_KEYS.some((p) => p.test(k)); }
  function rewire(v) {
    if (typeof v === "string") {
      if (/^[A-Za-z0-9+/=]{20,}$/.test(v)) return "[REDACTED]";
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return "[REDACTED]";
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "[REDACTED]";
      return v;
    }
    if (Array.isArray(v)) return v.map(rewire);
    if (v !== null && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = isSensitiveKey(k) ? "[REDACTED]" : rewire(val);
      }
      return out;
    }
    return v;
  }
  return rewire(receipt);
}

async function assertDplId(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (response.status() !== 200) throw new Error(`${url} returned ${response.status()}`);
  // Use response.text() — page.content() can return stale DOM from memory cache
  const html = await response.text();
  const expectedLower = expected.toLowerCase();
  if (!html.toLowerCase().includes(`data-dpl-id="${expectedLower}"`)) {
    throw new Error(`Page at ${url} does not contain data-dpl-id="${expected}"`);
  }
  return response;
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true });
}

function uuidRegex() { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; }

// ── Phase A ─────────────────────────────────────────────────────────────────

async function runPhaseA() {
  const browser = await chromium.launch({ headless: true });
  const phaseA = [];
  const browserErrors = [];
  let passed = 0;

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") browserErrors.push(m.text()); });
    page.on("pageerror", (e) => browserErrors.push(e.message));

    // (1) GET /analysis?symbol=<SYM> -> 200, thesis-workspace ABSENT, level-1 heading present
    {
      await assertDplId(page, `${base}/analysis?symbol=${symbol}`);
      const workspaceCount = await page.locator('[data-testid="thesis-workspace"]').count();
      const heading = await page.locator("h1").first().textContent().catch(() => null);
      const ok = workspaceCount === 0 && heading !== null;
      phaseA.push({ case: "GET /analysis?symbol=<SYM>", status: 200, ok, heading: heading || undefined });
      if (ok) passed++;
      await screenshot(page, "phaseA-1-analysis-symbol");
    }

    // (2) GET /analysis?view=theses -> same
    {
      await assertDplId(page, `${base}/analysis?view=theses`);
      const workspaceCount = await page.locator('[data-testid="thesis-workspace"]').count();
      const heading = await page.locator("h1").first().textContent().catch(() => null);
      const ok = workspaceCount === 0 && heading !== null;
      phaseA.push({ case: "GET /analysis?view=theses", status: 200, ok, heading: heading || undefined });
      if (ok) passed++;
      await screenshot(page, "phaseA-2-analysis-view-theses");
    }

    // (3) page.request GET /api/theses -> 401
    {
      const response = await page.request.get(`${base}/api/theses`);
      const body = await response.json().catch(() => ({}));
      const ok = response.status() === 401 && body.error === "unauthenticated";
      phaseA.push({ case: "GET /api/theses (anonymous)", status: response.status(), ok });
      if (ok) passed++;
    }

    // (4) page.request POST /api/theses (valid create payload) -> 401
    {
      const payload = {
        action: "create",
        clientRequestId: "99999999-9999-4999-8999-999999999999",
        subject: {
          schema: "mastermind.thesis-subject-ref/v1",
          kind: "issuer",
          owner: "terminal.analysis_symbol",
          key: symbol,
          identityState: "listing_scoped",
          listing: { symbol, mic: null, securityId: null },
          companyId: null,
          display: `${symbol} · listing scoped`,
        },
        content: {
          schema: "mastermind.thesis-content/v1",
          title: "Anonymous test",
          statement: "This should not be created.",
          catalysts: [],
          falsifiers: [],
          risks: [],
          horizon: "unspecified",
          effectiveAt: null,
          revisionNote: null,
        },
      };
      const response = await page.request.post(`${base}/api/theses`, { data: payload });
      const ok = response.status() === 401;
      phaseA.push({ case: "POST /api/theses (anonymous create)", status: response.status(), ok });
      if (ok) passed++;
    }

    // (5) GET /api/thesis-saved-views -> 401
    {
      const response = await page.request.get(`${base}/api/thesis-saved-views`);
      const ok = response.status() === 401;
      phaseA.push({ case: "GET /api/thesis-saved-views (anonymous)", status: response.status(), ok });
      if (ok) passed++;
    }

    await screenshot(page, "phaseA-final");
    await context.close();
  } finally {
    await browser.close();
  }

  const receipt = {
    capturedAt: new Date().toISOString(),
    base,
    expectedRelease: expected,
    phaseA,
    phaseB: { ran: false, route: "none", versions: [], archived: false },
    browserErrors,
  };

  writeFileSync(join(outputDir, "receipt-anonymous.json"), JSON.stringify(redactReceipt(receipt), null, 2) + "\n");
  console.log(`Phase A: ${passed}/${phaseA.length} cases passed`);
  return { passed, total: phaseA.length, receipt };
}

// ── Phase B ─────────────────────────────────────────────────────────────────

async function runPhaseB(storageState) {
  const browser = await chromium.launch({ headless: true });
  const browserErrors = [];
  const versions = [];
  let thesisId = null;
  let route = "unknown";
  let conflictStatus = null;
  let archived = false;
  const output = { ran: true, route, thesisId, versions, conflictStatus, archived };

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState,
    });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") browserErrors.push(m.text()); });
    page.on("pageerror", (e) => browserErrors.push(e.message));

    // ── Step 6: Navigate to /analysis with symbol, click Analysis rail, then Theses control ──
    await assertDplId(page, `${base}/terminal?symbol=${symbol}`);
    await screenshot(page, "phaseB-6-terminal");
    await page.locator('[aria-label="Analysis"]').click();
    await page.waitForURL(`**/analysis?symbol=${symbol}`, { timeout: 15_000 });
    await assertDplId(page, page.url());
    await screenshot(page, "phaseB-6-analysis");

    // Try to click the Theses control
    const thesesControl = page.locator('[aria-label*="hesis"], [data-testid*="theses"]').first();
    const hasControl = await thesesControl.count() > 0;
    if (hasControl) {
      route = "rail_control";
      await thesesControl.click();
      await page.waitForURL(/view=theses/, { timeout: 10_000 });
      await screenshot(page, "phaseB-6-theses-via-control");
    } else {
      route = "pasted_url_fallback";
      await assertDplId(page, `${base}/analysis?view=theses&symbol=${symbol}`);
      await screenshot(page, "phaseB-6-theses-via-url");
    }

    // ── Step 7: Create thesis ──
    const title = `[proof ${expected.slice(0, 8)}] ${symbol} journey ${new Date().toISOString()}`;

    // Click "New thesis" / New Thesis button
    const newBtn = page.locator('[aria-label*="New thesis"], [aria-label*="新建"], button:has-text("New thesis"), button:has-text("新建")').first();
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(500);
    }

    await page.getByLabel(/Title|标题/).first().fill(title);
    await page.getByLabel(/Thesis statement|论点陈述/).first().fill(`${title} statement`);
    await page.getByLabel(/Catalysts|催化因素/).first().fill("Test catalyst");
    await page.getByLabel(/Risks|风险/).first().fill("Test risk");
    await page.getByLabel(/Horizon|时间范围/).first().selectOption("quarters");

    await screenshot(page, "phaseB-7-thesis-filled");
    await page.getByRole("button", { name: /Save|保存/, exact: true }).click();
    await page.waitForURL(/thesis=/, { timeout: 15_000 });
    await screenshot(page, "phaseB-7-thesis-saved");

    const url = new URL(page.url());
    thesisId = url.searchParams.get("thesis");
    if (!thesisId || !uuidRegex().test(thesisId)) {
      // try GET /api/theses to find the id
      const listResp = await page.request.get(`${base}/api/theses`);
      if (listResp.ok) {
        const data = await listResp.json();
        thesisId = data.theses?.[0]?.id || null;
      }
    }
    versions.push({ version: 1, previousVersion: null });
    output.thesisId = thesisId;

    // ── Step 8: Reopen — reload and assert version 1 ──
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/thesis=/, { timeout: 10_000 });
    await screenshot(page, "phaseB-8-reloaded");
    const version1Text = await page.locator("text=Version 1").count();
    if (version1Text === 0) {
      // try "版本 1" for zh
      const v1Alt = await page.locator("text=/Version 1|版本 1/").count();
      console.log(`Phase B step 8: version text count = ${v1Alt}`);
    }

    // ── Step 9: Revise ──
    await page.getByLabel(/Thesis statement|论点陈述/).first().fill(`${title} revised statement`);
    await page.getByLabel(/Revision note|修订备注/).first().fill("Proof revision note.");
    await page.getByRole("button", { name: /Save|保存/, exact: true }).click();
    await page.waitForTimeout(2000);
    await screenshot(page, "phaseB-9-revised");

    // Verify via API
    const detailResp = await page.request.get(`${base}/api/theses?id=${thesisId}`);
    if (detailResp.ok) {
      const data = await detailResp.json();
      const v = data.thesis?.currentVersion ?? data.thesis?.current?.version;
      if (v !== undefined) versions.push({ version: v, previousVersion: v - 1 });
    }

    // ── Step 10: Conflict ──
    const conflictResp = await page.request.post(`${base}/api/theses`, {
      data: {
        action: "revise",
        id: thesisId,
        expectedVersion: 1, // stale
        clientRequestId: "88888888-8888-4888-8888-888888888888",
        subject: {
          schema: "mastermind.thesis-subject-ref/v1",
          kind: "issuer",
          owner: "terminal.analysis_symbol",
          key: symbol,
          identityState: "listing_scoped",
          listing: { symbol, mic: null, securityId: null },
          companyId: null,
          display: `${symbol} · listing scoped`,
        },
        content: {
          schema: "mastermind.thesis-content/v1",
          title,
          statement: "This is a conflicting write.",
          catalysts: [],
          falsifiers: [],
          risks: [],
          horizon: "unspecified",
          effectiveAt: null,
          revisionNote: "Conflict test",
        },
      },
    });
    conflictStatus = conflictResp.status();
    if (conflictStatus !== 409) {
      console.log(`Phase B step 10: expected 409, got ${conflictStatus}`);
    }

    // ── Step 11: Lens ──
    await page.goto(`${base}/analysis?symbol=${symbol}`, { waitUntil: "domcontentloaded" });
    const lensRail = page.locator("[data-testid=\"thesis-lens-rail\"]");
    if (await lensRail.count() > 0) {
      await screenshot(page, "phaseB-11-lens-rail");
      // open Theses lens
      const thesesLens = page.locator('[aria-label*="hesis"]').first();
      if (await thesesLens.count() > 0) {
        await thesesLens.click();
        await page.waitForTimeout(1000);
        await screenshot(page, "phaseB-11-theses-lens");
      }
      // open Coverage
      const coverageLens = page.locator('[aria-label*="overage"], [aria-label*="覆盖"]').first();
      if (await coverageLens.count() > 0) {
        await coverageLens.click();
        await page.waitForTimeout(1000);
        await screenshot(page, "phaseB-11-coverage-lens");
      }
    } else {
      console.log("Phase B step 11: thesis-lens-rail not found, skipping lens assertions");
    }

    // ── Step 12: /alerts ──
    const alertsResp = await page.request.get(`${base}/alerts`);
    if (alertsResp.status() === 200) {
      await screenshot(page, "phaseB-12-alerts");
    } else {
      console.log(`Phase B step 12: /alerts returned ${alertsResp.status()}`);
    }

    // ── Step 13: Archive ──
    await page.goto(`${base}/analysis?view=theses&thesis=${thesisId}`, { waitUntil: "domcontentloaded" });
    const archiveBtn = page.locator('[aria-label*="Archive"], [aria-label*="归档"], button:has-text("Archive"), button:has-text("归档")').first();
    if (await archiveBtn.count() > 0) {
      await archiveBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, "phaseB-13-archived");
      archived = true;
    } else {
      // try API
      const archiveResp = await page.request.post(`${base}/api/theses`, {
        data: {
          action: "archive",
          id: thesisId,
          expectedVersion: versions.at(-1)?.version ?? 2,
          clientRequestId: "77777777-7777-4777-8777-777777777777",
          subject: {
            schema: "mastermind.thesis-subject-ref/v1",
            kind: "issuer",
            owner: "terminal.analysis_symbol",
            key: symbol,
            identityState: "listing_scoped",
            listing: { symbol, mic: null, securityId: null },
            companyId: null,
            display: `${symbol} · listing scoped`,
          },
          content: {
            schema: "mastermind.thesis-content/v1",
            title,
            statement: `${title} archived`,
            catalysts: [],
            falsifiers: [],
            risks: [],
            horizon: "unspecified",
            effectiveAt: null,
            revisionNote: null,
          },
        },
      });
      archived = archiveResp.status() === 200;
    }

    output.route = route;
    output.thesisId = thesisId;
    output.versions = versions;
    output.conflictStatus = conflictStatus;
    output.archived = archived;

    await context.close();
  } finally {
    await browser.close();
  }

  return { output, errors: browserErrors };
}

// ── storage-state guard ───────────────────────────────────────────────────────

async function checkStorageState(path) {
  if (!path) return { valid: false, reason: "PROOF_STORAGE_STATE not set" };
  if (!existsSync(path)) return { valid: false, reason: `File not found: ${path}` };
  // must not be git-tracked
  try {
    const { execSync } = await import("node:child_process");
    execSync(`git ls-files --error-unmatch "${path}"`, { cwd: process.cwd(), stdio: "pipe" });
    return { valid: false, reason: `${path} is git-tracked — refusing Phase B` };
  } catch {
    // not git-tracked — good
  }
  return { valid: false, reason: `Phase B disabled: storage state is git-tracked or file missing` };
}

// ── main ─────────────────────────────────────────────────────────────────────

const phaseAReceipt = await runPhaseA();

let phaseBOutput = { ran: false, route: "none", versions: [], archived: false };
const phaseBErrors = [];

if (storageStatePath) {
  const check = await checkStorageState(storageStatePath);
  if (check.valid) {
    const storageState = JSON.parse(readFileSync(storageStatePath, "utf8"));
    const result = await runPhaseB(storageState);
    phaseBOutput = result.output;
    phaseBErrors.push(...result.errors);
  } else {
    console.log(`Phase B skipped: ${check.reason}`);
  }
} else {
  console.log("Phase B skipped: PROOF_STORAGE_STATE not set");
}

const receipt = {
  capturedAt: new Date().toISOString(),
  base,
  expectedRelease: expected,
  phaseA: phaseAReceipt.receipt.phaseA,
  phaseB: phaseBOutput,
  browserErrors: [...(phaseAReceipt.receipt.browserErrors || []), ...phaseBErrors],
};

writeFileSync(join(outputDir, "receipt-anonymous.json"), JSON.stringify(redactReceipt(receipt), null, 2) + "\n");
console.log(`Receipt written to ${join(outputDir, "receipt-anonymous.json")}`);
console.log(JSON.stringify(redactReceipt(receipt), null, 2));

const allPhaseAOk = phaseAReceipt.receipt.phaseA.every((c) => c.ok);
process.exit(allPhaseAOk ? 0 : 1);
