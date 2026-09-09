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

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-6-alert-prefs");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionAlertDelivery.tsx",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/lib/i18n.tsx",
  // The time-zone option text is rendered from this overlay, so the crops
  // depend on it exactly as they depend on the section and the lexicon.
  "terminal/lib/plainLabels.ts",
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

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
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

function startServer() {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
    HUB_REALTIME_QUOTES: "1",
    FLOW_FIXTURE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (buf) => {
    const line = String(buf);
    if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
  });
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

function stopServer(child) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/dev/settings?s=alertDelivery`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  await stripDevOverlay(page);
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
  await stripDevOverlay(page);
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const card = page.locator(".acs-overlay.open .acs-card");
  await card.screenshot({ path: join(OUT, file) });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  try {
    await waitForServer(180_000);
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
                await page.screenshot({ path: join(OUT, `FAIL-${file}`), fullPage: false });
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
    stopServer(child);
  }

  files.sort();
  const evidence = [
    "# B-F08-6 Alert delivery — capture evidence",
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
    "surfaces: [SectionAlertDelivery]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f08_6_alert_prefs.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
