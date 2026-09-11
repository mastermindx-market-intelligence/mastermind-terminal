#!/usr/bin/env node
/**
 * B-F12-B5-3b Account completeness — dark evidence crops.
 *
 * Same method as B-F12-5 (capture_f12_5_account_polish.cjs): Playwright against
 * the real /dev/settings harness. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f12_b5_3_account_completeness.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-b5-3-account-completeness/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-b5-3-account-completeness");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionAccount.tsx",
  "terminal/lib/teamSummary.ts",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3547);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const ONE_TEAM = {
  teams: [{ id: "t-1", name: "Acme", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }],
  truncated: false,
};

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
      const res = await fetch(`${BASE}/dev/settings?s=account`, { redirect: "manual" });
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

async function mockTeams(page) {
  await page.route("**/api/teams", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ONE_TEAM),
    });
  });
}

async function openAccount(page, lang, viewport, provider) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await mockTeams(page);
  const qs = `s=account&lang=${lang}&provider=${provider}`;
  await page.goto(`${BASE}/dev/settings?${qs}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  await page.locator(".acs-id-name").waitFor({ state: "visible", timeout: 15_000 });
  const dataLabel = lang === "zh" ? "你的数据" : "Your data";
  await page.getByText(dataLabel, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function measureLayout(page, lang) {
  return page.evaluate((l) => {
    const passwordLabel = l === "zh" ? "密码" : "Password";
    const groups = Array.from(document.querySelectorAll(".acs-group"));
    const security = groups.find((g) => {
      const title = (g.querySelector(".acs-group-t")?.textContent || "").trim();
      return title === "Security" || title === "安全";
    });
    const teamLbl = security ? security.querySelector(".acs-row .acs-row-lbl") : null;
    const passwordRow = Array.from(document.querySelectorAll(".acs-row")).find((row) => {
      const lbl = (row.querySelector(".acs-row-lbl")?.textContent || "").trim();
      return lbl === passwordLabel;
    });
    const currentField = document.querySelector('input[autocomplete="current-password"]');
    const currentForm = currentField ? currentField.closest(".acs-form") : null;
    const currentVisible = !!(currentForm && getComputedStyle(currentForm).display !== "none" && currentField);
    const editBtn = passwordRow ? passwordRow.querySelector("button.acs-edit") : null;
    const noPassword = passwordRow ? (passwordRow.querySelector(".acs-row-desc")?.textContent || "").trim() : "";
    return {
      teamLine: teamLbl ? (teamLbl.textContent || "").trim() : "",
      currentPasswordField: currentVisible,
      passwordEditVisible: !!(editBtn && getComputedStyle(editBtn).display !== "none"),
      noPasswordLine: noPassword,
    };
  }, lang);
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const overlay = page.locator(".acs-overlay.open");
  await overlay.screenshot({ path: join(OUT, file) });
}

async function openPasswordForm(page, lang) {
  const passwordLabel = lang === "zh" ? "密码" : "Password";
  const row = page.locator(".acs-row", { hasText: passwordLabel }).first();
  await row.locator("button.acs-edit").click();
  await page.locator('input[autocomplete="current-password"]').waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  const measurements = {};
  const failDir = process.env.TMPDIR || process.env.TEMP || "/var/tmp";
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      const shots = [
        { viewport: "desktop", lang: "en", form: false, provider: "google", file: "desktop-en-overview.png" },
        { viewport: "desktop", lang: "zh", form: false, provider: "google", file: "desktop-zh-overview.png" },
        { viewport: "desktop", lang: "en", form: true, provider: "email", file: "desktop-en-password.png" },
        { viewport: "desktop", lang: "zh", form: true, provider: "email", file: "desktop-zh-password.png" },
        { viewport: "mobile", lang: "en", form: false, provider: "google", file: "mobile-en-overview.png" },
        { viewport: "mobile", lang: "zh", form: false, provider: "google", file: "mobile-zh-overview.png" },
        { viewport: "mobile", lang: "en", form: true, provider: "email", file: "mobile-en-password.png" },
        { viewport: "mobile", lang: "zh", form: true, provider: "email", file: "mobile-zh-password.png" },
      ];
      for (const shot of shots) {
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
          await openAccount(page, shot.lang, VIEWPORTS[shot.viewport], shot.provider);
          if (shot.form) {
            await openPasswordForm(page, shot.lang);
            await page.locator(".acs-row.editing > .acs-form").scrollIntoViewIfNeeded();
            if (shot.viewport === "mobile") {
              await page.locator("button.acs-signout-m").scrollIntoViewIfNeeded();
            }
            await page.waitForTimeout(200);
          }
          const m = await measureLayout(page, shot.lang);
          measurements[shot.file] = m;
          if (!m.teamLine) {
            throw new Error(`${shot.file}: team line is empty`);
          }
          if (shot.form) {
            if (!m.currentPasswordField) {
              throw new Error(`${shot.file}: current-password field missing`);
            }
            if (m.noPasswordLine) {
              throw new Error(`${shot.file}: no-password line shown on email provider`);
            }
          } else {
            if (m.currentPasswordField) {
              throw new Error(`${shot.file}: current-password field visible on google provider`);
            }
            if (m.passwordEditVisible) {
              throw new Error(`${shot.file}: password edit control visible on google provider`);
            }
            if (!m.noPasswordLine) {
              throw new Error(`${shot.file}: no-password sentence missing`);
            }
          }
          await shoot(page, shot.file);
          files.push(shot.file);
          console.log("ok");
        } catch (err) {
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          try {
            await page.screenshot({ path: join(failDir, `FAIL-${shot.file}`), fullPage: false });
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
    stopServer(child);
  }

  const yamlVal = (v) => {
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") return String(v);
    return JSON.stringify(v);
  };
  const evidence = [
    "# B-F12-B5-3b Account completeness — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is the code commit the pixels depict. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness: /dev/settings?s=account&lang=<en|zh>&provider=<google|email>",
    "teams_fixture: The team line is produced by a capture-time Playwright route stub at e2e/tools/capture_b_f12_b5_3_account_completeness.cjs:125-133 (mockTeams fulfills **/api/teams with one owner team named Acme). It is not a live GET /api/teams.",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f12_b5_3_account_completeness.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) =>
      `  ${file}: { teamLine: ${yamlVal(m.teamLine)}, currentPasswordField: ${yamlVal(m.currentPasswordField)}, passwordEditVisible: ${yamlVal(m.passwordEditVisible)}, noPasswordLine: ${yamlVal(m.noPasswordLine)} }`),
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
