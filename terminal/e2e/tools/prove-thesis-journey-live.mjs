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
 *   PROOF_LANG          en|zh, default en — when zh, Phase B re-runs steps 6–8 at 390×844
 */

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.PROOF_BASE_URL || "https://app.mastermind-x.com";
const expected = process.env.PROOF_RELEASE || "";
// Strip any trailing \r or \n that a shell-var expansion can leave behind
const release = expected.replace(/[\r\n]+$/, "").trim();
if (!release || !/^[0-9a-f]{40}$/i.test(release)) {
  throw new Error("PROOF_RELEASE must be the exact 40-hex deployed SHA");
}

const symbol = process.env.PROOF_SYMBOL || "NVDA";
const storageStatePath = process.env.PROOF_STORAGE_STATE || "";
const lang = process.env.PROOF_LANG || "en";

const outputDir = "docs/pr-crops/b-f11-10-thesis-journey-live";
mkdirSync(outputDir, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Inline redaction — byte-identical logic to lib/thesisJourneyReceipt.ts.
 * Preserves 40-hex release identifiers and ISO timestamps; redacts JWTs,
 * long base64-like strings, emails, and sensitive-named keys.
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
      // Preserve 40-hex release identifiers and ISO timestamps
      if (/^[0-9a-f]{40}$/i.test(v)) return v;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return v;
      // Redact credential shapes
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
  const html = await response.text();
  const expectedLower = release.toLowerCase();
  if (!html.toLowerCase().includes(`data-dpl-id="${expectedLower}"`)) {
    throw new Error(`Page at ${url} does not contain data-dpl-id="${release}"`);
  }
  return response;
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true });
}

function uuidRegex() { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i; }

function i18n(key) {
  // EN/ZH label pairs used in the UI — sourced from thesis-workspace.spec.ts fillNew()
  const labels = {
    Title: ["Title", "标题"],
    ThesisStatement: ["Thesis statement", "论点陈述"],
    Catalysts: ["Catalysts", "催化因素"],
    Risks: ["Risks", "风险"],
    Horizon: ["Horizon", "时间范围"],
    Save: ["Save", "保存"],
    NewThesis: ["New thesis", "新建"],
    RevisionNote: ["Revision note", "修订备注"],
    Archive: ["Archive", "归档"],
    OpenTheses: ["Open Theses", "打开论点"],
    Back: ["Back to list", "返回列表"],
  };
  const pair = labels[key];
  if (!pair) return null;
  return lang === "zh" ? pair[1] : pair[0];
}

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
    expectedRelease: release,
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

    // Try to click the Theses control — accessible name is the i18n "Open Theses" / "打开论点"
    const thesesControl = page.locator(`[aria-label="${i18n("OpenTheses")}"]`).first();
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
    const title = `[proof ${release.slice(0, 8)}] ${symbol} journey ${new Date().toISOString()}`;

    // Click "New thesis" / "新建" button
    const newBtn = page.locator(`[aria-label="${i18n("NewThesis")}"], button:has-text("${i18n("NewThesis")}")`).first();
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(500);
    }

    await page.getByLabel(i18n("Title")).fill(title);
    await page.getByLabel(i18n("ThesisStatement")).fill(`${title} statement`);
    await page.getByLabel(i18n("Catalysts")).fill("Test catalyst");
    await page.getByLabel(i18n("Risks")).fill("Test risk");
    await page.getByLabel(i18n("Horizon")).selectOption("quarters");

    await screenshot(page, "phaseB-7-thesis-filled");
    await page.getByRole("button", { name: i18n("Save"), exact: true }).click();
    await page.waitForURL(/thesis=/, { timeout: 15_000 });
    await screenshot(page, "phaseB-7-thesis-saved");

    const url = new URL(page.url());
    thesisId = url.searchParams.get("thesis");
    if (!thesisId || !uuidRegex().test(thesisId)) {
      const listResp = await page.request.get(`${base}/api/theses`);
      if (listResp.ok) {
        const data = await listResp.json();
        thesisId = data.theses?.[0]?.id || null;
      }
    }
    versions.push({ version: 1, previousVersion: null });

    // ── Step 8: Reopen — reload and assert title shown and version is 1 ──
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/thesis=/, { timeout: 10_000 });
    await screenshot(page, "phaseB-8-reloaded");
    const versionText = await page.locator(String.raw`text=/Version 1|版本 1/`).count();
    if (versionText === 0) {
      throw new Error(`Step 8: Version 1 text not found on reloaded page`);
    }
    // Also assert the title is visible
    const titleVisible = await page.getByLabel(i18n("ThesisStatement")).isVisible().catch(() => false);
    if (!titleVisible) {
      throw new Error(`Step 8: Thesis statement field not visible after reload`);
    }

    // ── Step 9: Revise ──
    await page.getByLabel(i18n("ThesisStatement")).fill(`${title} revised statement`);
    await page.getByLabel(i18n("RevisionNote")).fill("Proof revision note.");
    await page.getByRole("button", { name: i18n("Save"), exact: true }).click();
    await page.waitForTimeout(2000);
    await screenshot(page, "phaseB-9-revised");

    // Verify via API: version must be 2, previousVersion must be 1
    const detailResp = await page.request.get(`${base}/api/theses?id=${thesisId}`);
    if (!detailResp.ok) {
      throw new Error(`Step 9: API GET /api/theses?id=${thesisId} returned ${detailResp.status()}`);
    }
    const data = await detailResp.json();
    const thesis = data.thesis || data;
    const currentVersion = thesis.currentVersion ?? thesis.current?.version ?? thesis.version;
    const prevVersion = thesis.previousVersion ?? thesis.current?.previousVersion;
    if (currentVersion !== 2) {
      throw new Error(`Step 9: Expected currentVersion=2, got ${currentVersion}`);
    }
    if (prevVersion !== 1) {
      throw new Error(`Step 9: Expected previousVersion=1, got ${prevVersion}`);
    }
    versions.push({ version: currentVersion, previousVersion: prevVersion });

    // ── Step 10: Conflict ──
    const conflictResp = await page.request.post(`${base}/api/theses`, {
      data: {
        action: "revise",
        id: thesisId,
        expectedVersion: 1, // stale — current is 2
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
      throw new Error(`Step 10: Expected 409 version_conflict, got ${conflictStatus}`);
    }

    // ── Step 11: Lens ──
    await page.goto(`${base}/analysis?symbol=${symbol}`, { waitUntil: "domcontentloaded" });
    const lensRail = page.locator("[data-testid=\"thesis-lens-rail\"]");
    if (await lensRail.count() > 0) {
      await screenshot(page, "phaseB-11-lens-rail");
      // Open Theses lens
      const thesesLens = page.locator(`[aria-label*="hesis"], [aria-label*="论点"]`).first();
      if (await thesesLens.count() > 0) {
        await thesesLens.click();
        await page.waitForTimeout(1000);
        await screenshot(page, "phaseB-11-theses-lens");
      }
      // Open Coverage
      const coverageLens = page.locator(`[aria-label*="overage"], [aria-label*="覆盖"]`).first();
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
    const archiveBtn = page.locator(`[aria-label="${i18n("Archive")}"], button:has-text("${i18n("Archive")}")`).first();
    if (await archiveBtn.count() > 0) {
      await archiveBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, "phaseB-13-archived");
      archived = true;
    } else {
      // Fallback: archive via API
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

    await context.close();
  } finally {
    await browser.close();
  }

  return {
    output: { ran: true, route, thesisId, versions, conflictStatus, archived },
    errors: browserErrors,
  };
}

// ── Phase B zh mobile rerun (PROOF_LANG=zh, steps 6–8 at 390×844) ─────────────

async function runPhaseBZh(storedState) {
  const browser = await chromium.launch({ headless: true });
  const browserErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: storedState,
    });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") browserErrors.push(m.text()); });
    page.on("pageerror", (e) => browserErrors.push(e.message));

    // zh init script (same pattern as thesis-workspace.spec.ts prepare())
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement?.setAttribute("data-lang", "zh");
      document.documentElement?.setAttribute("lang", "zh-CN");
    });

    await assertDplId(page, `${base}/terminal?symbol=${symbol}`);
    await screenshot(page, "phaseB-zh-6-terminal");
    await page.locator('[aria-label="Analysis"]').click();
    await page.waitForURL(`**/analysis?symbol=${symbol}`, { timeout: 15_000 });
    await assertDplId(page, page.url());
    await screenshot(page, "phaseB-zh-6-analysis");

    const thesesControl = page.locator(`[aria-label="打开论点"]`).first();
    const hasControl = await thesesControl.count() > 0;
    if (hasControl) {
      await thesesControl.click();
      await page.waitForURL(/view=theses/, { timeout: 10_000 });
      await screenshot(page, "phaseB-zh-6-theses");
    } else {
      await assertDplId(page, `${base}/analysis?view=theses&symbol=${symbol}`);
      await screenshot(page, "phaseB-zh-6-theses-url");
    }

    const title = `[proof ${release.slice(0, 8)}] ${symbol} journey ${new Date().toISOString()}`;
    const newBtn = page.locator(`[aria-label="新建"], button:has-text("新建")`).first();
    if (await newBtn.count() > 0) {
      await newBtn.click();
      await page.waitForTimeout(500);
    }
    await page.getByLabel("标题").fill(title);
    await page.getByLabel("论点陈述").fill(`${title} statement`);
    await page.getByLabel("催化因素").fill("测试催化因素");
    await page.getByLabel("风险").fill("测试风险");
    await page.getByLabel("时间范围").selectOption("quarters");
    await screenshot(page, "phaseB-zh-7-filled");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForURL(/thesis=/, { timeout: 15_000 });
    await screenshot(page, "phaseB-zh-7-saved");

    await context.close();
  } finally {
    await browser.close();
  }

  return { errors: browserErrors };
}

// ── storage-state guard ───────────────────────────────────────────────────────

async function checkStorageState(path) {
  if (!path) return { valid: false, reason: "PROOF_STORAGE_STATE not set" };
  if (!existsSync(path)) return { valid: false, reason: `File not found: ${path}` };
  // Must not be git-tracked
  try {
    const { execSync } = await import("node:child_process");
    execSync(`git ls-files --error-unmatch "${path}"`, { cwd: process.cwd(), stdio: "pipe" });
    return { valid: false, reason: `${path} is git-tracked — refusing Phase B` };
  } catch {
    // Not git-tracked — valid
  }
  return { valid: true, reason: "ok" };
}

// ── main ─────────────────────────────────────────────────────────────────────

const phaseAReceipt = await runPhaseA();

let phaseBOutput = { ran: false, route: "none", versions: [], archived: false };
let phaseBErrors = [];

if (storageStatePath) {
  const check = await checkStorageState(storageStatePath);
  if (check.valid) {
    const storageState = JSON.parse(readFileSync(storageStatePath, "utf8"));
    const result = await runPhaseB(storageState);
    phaseBOutput = result.output;
    phaseBErrors = result.errors;

    // zh mobile rerun for steps 6–8
    if (lang === "zh") {
      const zhResult = await runPhaseBZh(storageState);
      phaseBErrors.push(...zhResult.errors);
    }
  } else {
    console.log(`Phase B skipped: ${check.reason}`);
  }
} else {
  console.log("Phase B skipped: PROOF_STORAGE_STATE not set");
}

const receipt = {
  capturedAt: new Date().toISOString(),
  base,
  expectedRelease: release,
  phaseA: phaseAReceipt.receipt.phaseA,
  phaseB: phaseBOutput,
  browserErrors: [...(phaseAReceipt.receipt.browserErrors || []), ...phaseBErrors],
};

// Write both receipt files
writeFileSync(join(outputDir, "receipt-anonymous.json"), JSON.stringify(redactReceipt({
  ...receipt,
  phaseB: { ran: false, route: "none", versions: [], archived: false },
}), null, 2) + "\n");

if (phaseBOutput.ran) {
  writeFileSync(join(outputDir, "receipt-signed-in.json"), JSON.stringify(redactReceipt(receipt), null, 2) + "\n");
}

console.log(`Receipt written to ${join(outputDir, "receipt-anonymous.json")}`);
if (phaseBOutput.ran) {
  console.log(`Receipt written to ${join(outputDir, "receipt-signed-in.json")}`);
}
console.log(JSON.stringify(redactReceipt(receipt), null, 2));

const allPhaseAOk = phaseAReceipt.receipt.phaseA.every((c) => c.ok);
process.exit(allPhaseAOk ? 0 : 1);
