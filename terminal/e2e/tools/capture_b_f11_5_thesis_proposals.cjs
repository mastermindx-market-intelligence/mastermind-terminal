#!/usr/bin/env node
/**
 * B-F11-5 thesis amendment proposals — dark evidence crops.
 *
 * Playwright against the real /analysis?view=theses harness. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f11_5_thesis_proposals.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-5-thesis-proposals/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { startLegacyServer, waitLegacyServer, settleLegacyServer, reportLegacyServer,
  emitLegacyReceipt, captureRefusal } = require("./capture_ci_evidence.cjs");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-5-thesis-proposals");
const LAYOUT_FILES = [
  "terminal/components/workspaces/ThesisWorkspace.tsx",
  "terminal/components/workspaces/ThesisWorkspace.module.css",
  "terminal/lib/thesisAmendmentProposals.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3564);
const BASE = `http://127.0.0.1:${PORT}`;
const SYM = "NVDA";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  { viewport: "desktop", lang: "en", populated: false, file: "desktop-en-empty.png" },
  { viewport: "desktop", lang: "zh", populated: false, file: "desktop-zh-empty.png" },
  { viewport: "mobile", lang: "en", populated: false, file: "mobile-en-empty.png" },
  { viewport: "mobile", lang: "zh", populated: false, file: "mobile-zh-empty.png" },
  { viewport: "desktop", lang: "en", populated: true, file: "desktop-en-populated.png" },
  { viewport: "desktop", lang: "zh", populated: true, file: "desktop-zh-populated.png" },
  { viewport: "mobile", lang: "en", populated: true, file: "mobile-en-populated.png" },
  { viewport: "mobile", lang: "zh", populated: true, file: "mobile-zh-populated.png" },
];


function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function seedThesis(page, populated, lang) {
  const created = await page.request.post(`${BASE}/api/theses`, {
    data: {
      action: "create",
      clientRequestId: randomUUID(),
      subject: {
        schema: "mastermind.thesis-subject-ref/v1",
        kind: "issuer",
        owner: "terminal.analysis_symbol",
        key: SYM,
        identityState: "listing_scoped",
        listing: { symbol: SYM, mic: null, securityId: null },
        companyId: null,
        display: `${SYM} · listing scoped`,
      },
      content: {
        schema: "mastermind.thesis-content/v1",
        title: lang === "zh" ? "需求会继续复合" : "Demand keeps compounding",
        statement: lang === "zh" ? "需求将在下一个平台周期超过供给。" : "Demand will outrun supply through the next platform cycle.",
        catalysts: [],
        falsifiers: [],
        risks: [],
        horizon: "quarters",
        effectiveAt: null,
        revisionNote: null,
      },
    },
  });
  if (created.status() !== 201) {
    throw new Error(`create thesis failed: ${created.status()} ${await created.text()}`);
  }
  const thesisId = (await created.json()).thesisId;
  const detail = await page.request.get(`${BASE}/api/theses?id=${thesisId}`);
  if (!detail.ok()) throw new Error(`read thesis failed: ${detail.status()}`);
  const payload = await detail.json();
  const versionId = payload.thesis?.current?.id;
  if (!versionId) throw new Error("created thesis has no current version id");
  const proposals = [];
  if (populated) {
    // H2 (Round-1 heal): seed accepted, then rejected, then a still-proposed
    // row. Accepting first avoids the function superseding the later proposed
    // sibling, so the crop shows a coloured chip beside a Suggested chip.
    const acceptedBody = lang === "zh"
      ? "把地平线从季度改为月。"
      : "Shorten the horizon from quarters to months.";
    const declinedBody = lang === "zh"
      ? "把催化剂清单替换成下一季财报日列表。"
      : "Swap the catalysts list for the next earnings calendar.";
    const proposedBody = lang === "zh"
      ? "把论点收窄到必须持续增长的那一块需求。"
      : "Name the demand that has to keep compounding.";
    const accepted = await page.request.post(`${BASE}/api/thesis/${thesisId}/proposals`, {
      data: { amended_from: versionId, body: acceptedBody, evidence_refs: [] },
    });
    if (accepted.status() !== 201) {
      throw new Error(`create proposal (accepted) failed: ${accepted.status()} ${await accepted.text()}`);
    }
    const acceptedRow = (await accepted.json()).proposal;
    const acceptedId = acceptedRow?.proposalId;
    const accept = await page.request.patch(`${BASE}/api/thesis/${thesisId}/proposals/${acceptedId}`, {
      data: { state: "accepted" },
    });
    if (accept.status() !== 200) {
      throw new Error(`accept proposal failed: ${accept.status()} ${await accept.text()}`);
    }
    const acceptedState = await accept.json();
    if (acceptedState.proposalId !== acceptedId || acceptedState.state !== "accepted") {
      throw new Error("accepted proposal fixture did not confirm the transition");
    }
    proposals.push({ ...acceptedRow, state: acceptedState.state });
    const declined = await page.request.post(`${BASE}/api/thesis/${thesisId}/proposals`, {
      data: { amended_from: versionId, body: declinedBody, evidence_refs: [] },
    });
    if (declined.status() !== 201) {
      throw new Error(`create proposal (declined) failed: ${declined.status()} ${await declined.text()}`);
    }
    const declinedRow = (await declined.json()).proposal;
    const declinedId = declinedRow?.proposalId;
    const decline = await page.request.patch(`${BASE}/api/thesis/${thesisId}/proposals/${declinedId}`, {
      data: { state: "rejected" },
    });
    if (decline.status() !== 200) {
      throw new Error(`decline proposal failed: ${decline.status()} ${await decline.text()}`);
    }
    const declinedState = await decline.json();
    if (declinedState.proposalId !== declinedId || declinedState.state !== "rejected") {
      throw new Error("declined proposal fixture did not confirm the transition");
    }
    proposals.push({ ...declinedRow, state: declinedState.state });
    const proposed = await page.request.post(`${BASE}/api/thesis/${thesisId}/proposals`, {
      data: { amended_from: versionId, body: proposedBody, evidence_refs: [] },
    });
    if (proposed.status() !== 201) {
      throw new Error(`create proposal (proposed) failed: ${proposed.status()} ${await proposed.text()}`);
    }
    const proposedRow = (await proposed.json()).proposal;
    if (!proposedRow?.proposalId || proposedRow.state !== "proposed") {
      throw new Error("suggested proposal fixture did not return a proposed row");
    }
    proposals.push(proposedRow);
  }
  // The server fixture's list query treats its internal __order marker as a
  // row filter, so GET returns [] even after successful POST/PATCH seeding.
  // Keep this visual fixture local to the capture: use the returned rows and
  // confirmed transitions, newest first, without changing the application.
  // This adapter proves rendering, not production list persistence.
  await page.route(`${BASE}/api/thesis/${thesisId}/proposals`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { proposals: [...proposals].reverse() } });
  });
  return thesisId;
}

async function openPanel(page, lang, viewport, populated) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    const applyAttributes = () => {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.setAttribute("data-lang", l);
      document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    };
    if (document.documentElement) applyAttributes();
    else document.addEventListener("DOMContentLoaded", applyAttributes, { once: true });
  }, lang);
  await page.goto(`${BASE}/analysis?view=theses&symbol=${SYM}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("thesis-workspace").waitFor({ state: "visible", timeout: 45_000 });
  const thesisId = await seedThesis(page, populated, lang);
  await page.goto(`${BASE}/analysis?view=theses&thesis=${thesisId}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("thesis-amendment-panel").waitFor({ state: "visible", timeout: 45_000 });
  if (populated) {
    // Three rows (proposed + declined + accepted) share this test id; wait on
    // the first card and on a non-proposed chip so the crop cannot land before
    // the coloured data-state styles apply.
    await page.getByTestId("thesis-proposal-row").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-testid="thesis-proposal-row"] i[data-state="proposed"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-testid="thesis-proposal-row"] i[data-state="accepted"], [data-testid="thesis-proposal-row"] i[data-state="rejected"]').first().waitFor({ state: "visible", timeout: 15_000 });
  } else {
    await page.getByTestId("thesis-proposals-empty").waitFor({ state: "visible", timeout: 15_000 });
  }
  await page.getByTestId("thesis-amendment-panel").evaluate((el) => el.scrollIntoView({ block: "start" }));
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.getByTestId("thesis-amendment-panel").screenshot({ path: join(OUT, file) });
}

async function main() {
  if (process.env.TERMINAL_LEGACY_CAPTURE_ID && (process.env.CAPTURE_ONLY || "").trim()) throw new Error("CI_EVIDENCE_CAPTURE_FILTER");
  const { chromium } = require("@playwright/test");
  mkdirSync(OUT, { recursive: true });
  const capturedAtHead = currentGitHead();
  const child = startLegacyServer(ROOT, PORT);
  const files = [];
  try {
    await reportLegacyServer(child, "started");
    await waitLegacyServer(child, `${BASE}/analysis?view=theses`, 180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const shot of SHOTS) {
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: VIEWPORTS[shot.viewport],
          hasTouch: shot.viewport === "mobile",
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
          colorScheme: "dark",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        try {
          await openPanel(page, shot.lang, VIEWPORTS[shot.viewport], shot.populated);
          await shoot(page, shot.file);
          files.push(shot.file);
          console.log("ok");
        } catch (err) {
          if (captureRefusal(err)) throw err;
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          try {
            await page.screenshot({ path: join(OUT, `FAIL-${shot.file}`), fullPage: false });
          } catch { /* ignore */ }
          throw err;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await settleLegacyServer(child);
  }

  const evidence = [
    "# B-F11-5 Suggested changes to your thesis — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { url: "/analysis?view=theses&lang=${s.lang}", state: ${s.populated ? "populated" : "empty"} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_5_thesis_proposals.cjs",
    "files:",
    ...SHOTS.map((s) => `  - ${s.file}`),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), `${evidence.join("\n")}\n`);
  emitLegacyReceipt({ packet: "proposals", outputDir: OUT, files, capturedAtHead });
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at ${capturedAtHead}`);
}

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

module.exports = { assertNoNextIndicator, LAYOUT_FILES, FILES: SHOTS.map(shot => shot.file), VIEWPORTS };
