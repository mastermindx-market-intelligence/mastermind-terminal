#!/usr/bin/env node
/**
 * B-F12-8 Team roles v1 — dark evidence crops.
 *
 * Same method as B-F12-5: Playwright against the real /dev/settings harness
 * (mounts SettingsPanel / SectionTeam). Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_8_team_roles.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-8-team-roles/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-8-team-roles");
// Round-4 ruling R4(f): icons.tsx is in the lock. This packet edited it (IconTeam), and
// SectionTeam.tsx imports Group / Msg / Row / SectionHead from it — the markup that structures
// every line of these crops. Without it, an edit there moves these pixels without turning the
// lock red, which is the failure mode ruling R2 named.
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/app/settings.css",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3538);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
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
      const res = await fetch(`${BASE}/dev/settings?s=team`, { redirect: "manual" });
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

async function openTeam(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=team&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const locked = lang === "zh" ? "所有者创建了该团队。所有者无法被更改或移除。" : "The owner created this team. The owner cannot be changed or removed.";
  await page.getByText(locked, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("[data-testid=\"team-role-badge\"]").first().waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

// Round-4 ruling R3: the zero-team default state, which no crop depicted. Its own address on the
// harness so the shot is reproducible: /dev/settings?s=team&team=none.
async function openNoTeam(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=team&team=none&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const sentence = lang === "zh"
    ? "您还没有加入任何团队。创建一个团队后即可邀请成员。"
    : "You are not on a team yet. Create one to invite people.";
  await page.getByText(sentence, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("[data-testid=\"team-create\"]").waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

// Round-4 ruling R4(b): the four change-role crops carried no evidence the four team crops did not
// — a scrollIntoView on an element already in view. They now open the confirm state, so
// acsTeamRemoveAsk is on screen in both languages and at both widths.
async function openConfirm(page, file) {
  const row = page.locator(".acs-row", { has: page.locator("[data-testid=\"team-change-role\"]") }).first();
  await row.waitFor({ state: "visible", timeout: 10_000 });
  await row.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
  const remove = row.locator("[data-testid=\"team-actions\"] button.btn-danger").first();
  await remove.waitFor({ state: "visible", timeout: 10_000 });
  await remove.click();
  const asking = page.locator(".acs-row.editing .acs-form .acs-note").first();
  await asking.waitFor({ state: "visible", timeout: 10_000 });
  await asking.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
  await page.waitForTimeout(200);
  const text = (await asking.textContent() || "").trim();
  if (!text) throw new Error(`${file}: confirm prompt is empty`);
  return text;
}

async function assertDeliveryInView(page, file) {
  const delivery = page.locator("[data-testid=\"team-delivery\"]");
  await delivery.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByText("pending@example.com").waitFor({ state: "visible", timeout: 10_000 });
  const inView = await page.evaluate(() => {
    const body = document.querySelector(".acs-overlay.open .acs-body");
    const note = document.querySelector("[data-testid=\"team-delivery\"]");
    const row = Array.from(document.querySelectorAll(".acs-row")).find((el) =>
      (el.textContent || "").includes("pending@example.com"),
    );
    if (!body || !note || !row) return { ok: false, reason: "missing" };
    const br = body.getBoundingClientRect();
    const visible = (r) => r.bottom > br.top + 4 && r.top < br.bottom - 4;
    const nr = note.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      ok: visible(nr) && visible(rr),
      noteTop: nr.top,
      noteBottom: nr.bottom,
      rowTop: rr.top,
      rowBottom: rr.bottom,
      bodyTop: br.top,
      bodyBottom: br.bottom,
    };
  });
  if (!inView.ok) {
    throw new Error(`${file}: pending invitation or no_email_delivery sentence is clipped (${JSON.stringify(inView)})`);
  }
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll("[data-testid=\"team-role-badge\"]")).map((el) => (el.textContent || "").trim());
    const change = document.querySelector("[data-testid=\"team-change-role\"]");
    const remove = document.querySelector("[data-testid=\"team-actions\"] button.btn-danger");
    const changeLabels = Array.from(document.querySelectorAll("[data-testid=\"team-change-role\"] button"))
      .map((el) => (el.textContent || "").trim());
    const none = document.querySelector("[data-testid=\"team-none\"]");
    const create = document.querySelector("[data-testid=\"team-create\"]");
    const asking = document.querySelector(".acs-row.editing .acs-form .acs-note");
    return {
      roleBadgeText: badges.join(" | "),
      changeRolePresent: !!change,
      removeClass: remove ? remove.className : "",
      // Round-4 ruling R4(a): one option per row, never the role the row already holds.
      changeRoleLabels: changeLabels.join(" | "),
      confirmText: asking ? (asking.textContent || "").trim() : "",
      noTeamPresent: !!none,
      createLabel: create ? (create.textContent || "").trim() : "",
    };
  });
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const overlay = page.locator(".acs-overlay.open");
  await overlay.screenshot({ path: join(OUT, file) });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  const measurements = {};
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      const shots = [
        { viewport: "desktop", lang: "en", kind: "team", file: "desktop-en-team.png" },
        { viewport: "desktop", lang: "zh", kind: "team", file: "desktop-zh-team.png" },
        { viewport: "desktop", lang: "en", kind: "change", file: "desktop-en-change-role.png" },
        { viewport: "desktop", lang: "zh", kind: "change", file: "desktop-zh-change-role.png" },
        { viewport: "desktop", lang: "en", kind: "none", file: "desktop-en-no-team.png" },
        { viewport: "desktop", lang: "zh", kind: "none", file: "desktop-zh-no-team.png" },
        { viewport: "mobile", lang: "en", kind: "team", file: "mobile-en-team.png" },
        { viewport: "mobile", lang: "zh", kind: "team", file: "mobile-zh-team.png" },
        { viewport: "mobile", lang: "en", kind: "change", file: "mobile-en-change-role.png" },
        { viewport: "mobile", lang: "zh", kind: "change", file: "mobile-zh-change-role.png" },
        { viewport: "mobile", lang: "en", kind: "none", file: "mobile-en-no-team.png" },
        { viewport: "mobile", lang: "zh", kind: "none", file: "mobile-zh-no-team.png" },
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
          if (shot.kind === "none") {
            await openNoTeam(page, shot.lang, VIEWPORTS[shot.viewport]);
          } else {
            await openTeam(page, shot.lang, VIEWPORTS[shot.viewport]);
            await assertDeliveryInView(page, shot.file);
            if (shot.kind === "change") await openConfirm(page, shot.file);
          }
          const m = await measureLayout(page);
          measurements[shot.file] = m;
          if (shot.kind === "none") {
            if (!m.noTeamPresent) throw new Error(`${shot.file}: zero-team block missing`);
            if (!m.createLabel) throw new Error(`${shot.file}: create-team control missing`);
            if (m.roleBadgeText) throw new Error(`${shot.file}: a roster row is showing in the zero-team state`);
          } else {
            if (!m.roleBadgeText) {
              throw new Error(`${shot.file}: role badge text is empty`);
            }
            if (!m.changeRolePresent) {
              throw new Error(`${shot.file}: change-role control missing`);
            }
            // Ruling R4(a): a changeable row offers exactly one option, never the one it holds.
            const perRow = m.changeRoleLabels.split(" | ").filter(Boolean);
            if (perRow.length !== 2) {
              throw new Error(`${shot.file}: expected one option on each of the two changeable rows, got ${m.changeRoleLabels}`);
            }
            if (shot.kind === "change" && !m.confirmText) {
              throw new Error(`${shot.file}: confirm prompt is not on screen`);
            }
          }
          if (m.removeClass && !/\bbtn-danger\b/.test(m.removeClass)) {
            throw new Error(`${shot.file}: remove class is ${m.removeClass}, expected btn-danger`);
          }
          await shoot(page, shot.file);
          files.push(shot.file);
          console.log("ok");
        } catch (err) {
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
    stopServer(child);
  }

  const evidence = [
    "# B-F12-8 Team roles v1 — capture evidence",
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
    "harness: /dev/settings?s=team&lang=<en|zh>",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f12_8_team_roles.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) =>
      `  ${file}: { roleBadgeText: ${JSON.stringify(m.roleBadgeText)}, changeRolePresent: ${m.changeRolePresent},`
      + ` changeRoleLabels: ${JSON.stringify(m.changeRoleLabels)}, confirmText: ${JSON.stringify(m.confirmText)},`
      + ` noTeamPresent: ${m.noTeamPresent}, createLabel: ${JSON.stringify(m.createLabel)},`
      + ` removeClass: ${JSON.stringify(m.removeClass)} }`),
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
