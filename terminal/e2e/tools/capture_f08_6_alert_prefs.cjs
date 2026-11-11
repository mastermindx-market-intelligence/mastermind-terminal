#!/usr/bin/env node
/**
 * B-F08-6 Alert delivery — dark evidence crops.
 *
 * Playwright against the real /dev/settings harness. BFF responses are mocked
 * (macro #6907 may not be deployed). Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f08_6_alert_prefs.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f08-6-alert-prefs/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { tmpdir } = require("node:os");
const { startLegacyServer, settleLegacyServer, waitLegacyServer } = require("./capture_ci_evidence.cjs");
const { createHash } = require("node:crypto");
const { mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-6-alert-prefs");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/settings/SectionAlertDelivery.tsx",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/lib/i18n.tsx",
  // The time-zone option text is rendered from this overlay, so the crops
  // depend on it exactly as they depend on the section and the lexicon.
  "terminal/lib/plainLabels.ts",
  // Every pixel of the captured card is styled by this sheet — the sibling
  // packet locks it for the same reason (docs/pr-crops/b-f12-5-account-polish).
  "terminal/app/settings.css",
  // Without these two the section does not exist to mount: the provider carries
  // "alertDelivery" in SettingsSection/SETTINGS_SECTIONS and the dev harness
  // lists it among the sections the capture opens.
  "terminal/components/settings/SettingsProvider.tsx",
  "terminal/app/dev/settings/page.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3538);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const ONLY = (process.env.CAPTURE_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

mkdirSync(OUT, { recursive: true });
const CAPTURE_OUT = mkdtempSync(join(tmpdir(), "mmx-b-f08-6-alert-prefs-"));
console.log(`unpromoted capture directory ${CAPTURE_OUT}`);

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock(hashes) {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${hashes[rel]}"`);
}

function cropName(state, width, lang) {
  return `SectionAlertDelivery-${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
}

const POPULATED = {
  ok: true,
  prefs: {
    alert_email_optin: true,
    alert_categories: ["holdings_material_change"],
  },
  unset: ["tz", "quiet_hours"],
  categories_available: ["holdings_material_change", "thesis_window"],
};

const QUIET_HOURS = {
  ok: true,
  prefs: {
    alert_email_optin: true,
    alert_categories: ["holdings_material_change", "thesis_window"],
    tz: "Asia/Shanghai",
    quiet_hours: { start: "22:00", end: "07:00" },
  },
  unset: [],
  categories_available: ["holdings_material_change", "thesis_window"],
};

// The stored zone here is deliberately one the curated picker does not carry
// (Port of Spain, UTC−4 all year). The crop therefore shows the single extra
// "Current setting (UTC−4)" / "当前设置（UTC−4）" option holding the account's
// value, and quiet hours left unset show the "Not set" / "未设置" label rather
// than the browser's "--:-- --".
const FIELD_GET = {
  ok: true,
  prefs: { alert_email_optin: true, tz: "America/Port_of_Spain" },
  unset: ["quiet_hours", "alert_categories"],
  categories_available: ["holdings_material_change", "thesis_window"],
};

const FIELD_POST = {
  detail: {
    field: "tz",
    en: "That time zone isn't one we know. Pick one from the list.",
    zh: "无法识别该时区，请从列表中选择。",
  },
};

function startServer() { return startLegacyServer(ROOT, PORT); }

async function waitForServer(timeoutMs, child) {
  await waitLegacyServer(child, `${BASE}/dev/settings?s=alertDelivery`, timeoutMs);
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function mockBff(page, state) {
  await page.route("**/api/account/alert-prefs", async (route) => {
    const method = route.request().method();
    if (state === "unavailable") {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Not Found" }),
      });
      return;
    }
    if (method === "POST" && state === "field-error") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify(FIELD_POST),
      });
      return;
    }
    if (method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, prefs: {}, metadata: true, email_prefs: false }),
      });
      return;
    }
    const body = state === "quiet-hours" ? QUIET_HOURS : state === "field-error" ? FIELD_GET : POPULATED;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openSection(page, lang, width, state) {
  await page.setViewportSize(VIEWPORTS[width]);
  await mockBff(page, state);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=alertDelivery&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const title = lang === "zh" ? "提醒送达" : "Alert delivery";
  await page.getByRole("heading", { name: title }).waitFor({ state: "visible", timeout: 15_000 });
  if (state === "unavailable") {
    const copy = lang === "zh" ? "提醒送达设置尚未上线。" : "Alert delivery settings are not available yet.";
    await page.getByText(copy, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  } else if (state === "field-error") {
    const select = page.locator('select[data-alert-field="tz"]');
    await select.waitFor({ state: "visible", timeout: 15_000 });
    await select.selectOption("Asia/Shanghai");
    const err = lang === "zh"
      ? "无法识别该时区，请从列表中选择。"
      : "That time zone isn't one we know. Pick one from the list.";
    await page.getByText(err, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  } else if (state === "quiet-hours") {
    await page.locator('input[data-alert-field="qh-start"]').waitFor({ state: "visible", timeout: 15_000 });
  } else {
    await page.locator('button[data-alert-field="optin-on"]').waitFor({ state: "visible", timeout: 15_000 });
  }
}

async function shoot(page, file) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  await assertNoNextIndicator(page, file);
  const card = page.locator(".acs-overlay.open .acs-card");
  await card.screenshot({ path: join(CAPTURE_OUT, file) });
}

async function main() {
  const capturedAtHead = currentGitHead();
  assert.match(capturedAtHead, /^[0-9a-f]{40}$/);
  const sourceHashes = Object.fromEntries(LAYOUT_FILES.map(rel => [rel, sha256File(rel)]));
  const child = startServer();
  const files = [];
  try {
    await waitForServer(180_000, child);
    const browser = await chromium.launch({ headless: true });
    try {
      const states = ["populated", "quiet-hours", "field-error", "unavailable"];
      const widths = [1440, 390];
      const langs = ["en", "zh"];
      for (const state of states) {
        for (const width of widths) {
          for (const lang of langs) {
            const file = cropName(state, width, lang);
            if (ONLY.length && !ONLY.includes(file) && !ONLY.includes(state)) continue;
            process.stdout.write(`capture ${file} … `);
            const context = await browser.newContext({
              viewport: VIEWPORTS[width],
              hasTouch: width === 390,
              locale: lang === "zh" ? "zh-CN" : "en-US",
              colorScheme: "dark",
            });
            const page = await context.newPage();
            page.setDefaultTimeout(45_000);
            try {
              await openSection(page, lang, width, state);
              await shoot(page, file);
              files.push(file);
              console.log("ok");
            } catch (err) {
              console.log(`FAIL ${err && err.message ? err.message : err}`);
              try {
                await page.screenshot({ path: join(CAPTURE_OUT, `FAIL-${file}`), fullPage: false });
              } catch { /* ignore */ }
              throw err;
            } finally {
              await context.close();
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await settleLegacyServer(child);
  }

  files.sort();
  const expectedFiles = ["populated", "quiet-hours", "field-error", "unavailable"].flatMap(state => [1440, 390].flatMap(width => ["en", "zh"].map(lang => cropName(state, width, lang)))).sort();
  assert.deepEqual(files, expectedFiles, "Capture requires the complete unique matrix");
  assert.equal(new Set(files).size, expectedFiles.length);
  assert.equal(currentGitHead(), capturedAtHead, "Source HEAD changed during capture");
  for (const rel of LAYOUT_FILES) assert.equal(sha256File(rel), sourceHashes[rel], `Source changed: ${rel}`);
  const captureFiles = Object.fromEntries(files.map(file => {
    const bytes = readFileSync(join(CAPTURE_OUT, file));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file);
    return [file, createHash("sha256").update(bytes).digest("hex")];
  }));
  const evidence = [
    "# B-F08-6 Alert delivery — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(sourceHashes),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [SectionAlertDelivery]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f08_6_alert_prefs.cjs",
    "captureFiles:",
    ...files.map(file => `  ${file}: "${captureFiles[file]}"`),
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ].join("\n");
  for (const file of files) copyFileSync(join(CAPTURE_OUT, file), join(OUT, file));
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
