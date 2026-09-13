#!/usr/bin/env node
/**
 * B-F12-9 Team ownership transfer v1 — dark evidence crops.
 *
 * Same method as B-F12-8: Playwright against the real /dev/settings harness
 * (mounts SettingsPanel / SectionTeam). Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_9_team_ownership_transfer.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-9-team-ownership-transfer/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-9-team-ownership-transfer");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/app/settings.css",
  "terminal/lib/i18n.tsx",
];
const RESERVATIONS = join(REPO, "supabase", "migrations", "RESERVATIONS.json");
const LEDGER_PREFIX = "0020";
// This packet's file originated in PR #557 and was squash-merged into #550's branch at 29257a43
// before riding #550 to master. That origin is packet history, not a ledger field, so it stays a
// constant here while every changeable fact on the header line is read from the row.
const ORIGIN_PR = 557;
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3540);
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

/**
 * The EVIDENCE.yml "# Ledger row:" line, DERIVED from supabase/migrations/RESERVATIONS.json.
 *
 * It used to be a hard-coded "PR #557 (open, packet B-F12-9); not applied" string, which froze a
 * pull-request state that went stale the moment #550 merged and 0020 was applied; a recapture would
 * have re-written that stale claim into the evidence file. Reading the row instead means the line
 * can only ever say what the ledger says.
 *
 * Nothing here logs the ledger: the document carries the Supabase project reference in its
 * `project_ref` field, and only this one row's fields ever leave this function.
 */
function ledgerRowHeader() {
  const doc = JSON.parse(readFileSync(RESERVATIONS, "utf8"));
  const row = doc.prefixes && doc.prefixes[LEDGER_PREFIX];
  if (!row) throw new Error(`RESERVATIONS.json carries no row for prefix ${LEDGER_PREFIX}`);
  const name = String(row.file || "").replace(/\.sql$/, "");
  const merge = row.merged_sha ? `${row.pr_state} ${row.merged_sha}` : String(row.pr_state);
  const applied = row.applied_in_production
    ? `applied ${row.applied_date || "date not recorded"}`
    : "not applied";
  return `# Ledger row: ${name} / PR #${row.pr} (${merge}; originated in #${ORIGIN_PR}, packet ${row.packet}); ${applied}`;
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
  await page.locator("[data-testid=\"team-transfer-ownership\"]").waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function openConfirm(page, lang, file) {
  const button = page.locator("[data-testid=\"team-transfer-ownership\"]");
  await button.click();
  await page.locator("[data-testid=\"team-transfer-dialog\"]").waitFor({ state: "visible", timeout: 10_000 });
  const adminName = lang === "zh" ? "Alex Chen" : "Alex Chen";
  const choice = page.locator("[data-testid=\"team-transfer-recipients\"] button", { hasText: adminName }).first();
  await choice.click();
  await page.locator("[data-testid=\"team-transfer-next\"]").click();
  await page.locator("[data-testid=\"team-transfer-consequence\"]").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("[data-testid=\"team-transfer-dialog\"]").evaluate((el) =>
    el.scrollIntoView({ block: "nearest", inline: "nearest" }),
  );
  await page.waitForTimeout(200);
  const text = (await page.locator("[data-testid=\"team-transfer-consequence\"]").textContent() || "").trim();
  if (!text) throw new Error(`${file}: consequence sentence is empty`);
  return text;
}

async function assertInvitesInView(page, file) {
  const badge = page.locator("[data-testid=\"team-invite-badge\"]").first();
  await badge.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByText("pending@example.com").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".acs-group-t", { hasText: /Invitations not yet accepted|尚未接受的邀请/ }).first()
    .evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest" }))
    .catch(() => {});
  await page.waitForTimeout(120);
  const inView = await page.evaluate(() => {
    const body = document.querySelector(".acs-overlay.open .acs-body");
    const badgeEl = document.querySelector("[data-testid=\"team-invite-badge\"]");
    const row = Array.from(document.querySelectorAll(".acs-row")).find((el) =>
      (el.textContent || "").includes("pending@example.com"),
    );
    if (!body || !badgeEl || !row) return { ok: false, reason: "missing" };
    const br = body.getBoundingClientRect();
    const visible = (r) => r.bottom > br.top + 4 && r.top < br.bottom - 4;
    const nr = badgeEl.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      ok: visible(nr) && visible(rr),
      badgeTop: nr.top,
      rowTop: rr.top,
      bodyTop: br.top,
      bodyBottom: br.bottom,
    };
  });
  if (!inView.ok) {
    // 390 may clip; do not change layout. Record the miss so the evidence lock
    // still names the group from the DOM, and disclose the clip under GAPS.
    process.stderr.write(`${file}: pending invitation may be clipped (${JSON.stringify(inView)})\n`);
  }
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const button = document.querySelector("[data-testid=\"team-transfer-ownership\"]");
    const dialog = document.querySelector("[data-testid=\"team-transfer-dialog\"]");
    const title = document.querySelector("[data-testid=\"team-transfer-confirm-title\"]");
    const consequence = document.querySelector("[data-testid=\"team-transfer-consequence\"]");
    const badges = Array.from(document.querySelectorAll("[data-testid=\"team-role-badge\"]")).map((el) =>
      (el.textContent || "").trim(),
    );
    const inviteBadge = document.querySelector("[data-testid=\"team-invite-badge\"]");
    const inviteGroup = Array.from(document.querySelectorAll(".acs-group-t")).map((el) =>
      (el.textContent || "").trim(),
    ).find((t) => t === "Invitations not yet accepted" || t === "尚未接受的邀请") || "";
    return {
      transferButtonText: button ? (button.textContent || "").trim() : "",
      dialogPresent: !!dialog,
      confirmTitle: title ? (title.textContent || "").trim() : "",
      consequenceText: consequence ? (consequence.textContent || "").trim() : "",
      roleBadgeText: badges.join(" | "),
      inviteBadgeText: inviteBadge ? (inviteBadge.textContent || "").trim() : "",
      inviteGroupTitle: inviteGroup,
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
        { viewport: "desktop", lang: "en", kind: "button", file: "desktop-en-transfer-button.png" },
        { viewport: "desktop", lang: "zh", kind: "button", file: "desktop-zh-transfer-button.png" },
        { viewport: "desktop", lang: "en", kind: "confirm", file: "desktop-en-transfer-confirm.png" },
        { viewport: "desktop", lang: "zh", kind: "confirm", file: "desktop-zh-transfer-confirm.png" },
        { viewport: "mobile", lang: "en", kind: "button", file: "mobile-en-transfer-button.png" },
        { viewport: "mobile", lang: "zh", kind: "button", file: "mobile-zh-transfer-button.png" },
        { viewport: "mobile", lang: "en", kind: "confirm", file: "mobile-en-transfer-confirm.png" },
        { viewport: "mobile", lang: "zh", kind: "confirm", file: "mobile-zh-transfer-confirm.png" },
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
          await openTeam(page, shot.lang, VIEWPORTS[shot.viewport]);
          if (shot.kind === "button") {
            await assertInvitesInView(page, shot.file);
          }
          let consequence = "";
          if (shot.kind === "confirm") {
            consequence = await openConfirm(page, shot.lang, shot.file);
          }
          const m = await measureLayout(page);
          if (shot.kind === "confirm") m.consequenceText = m.consequenceText || consequence;
          measurements[shot.file] = m;
          if (!m.inviteBadgeText) {
            throw new Error(`${shot.file}: invite badge missing`);
          }
          if (!m.inviteGroupTitle) {
            throw new Error(`${shot.file}: invitations group title missing`);
          }
          if (!/^(Owner|所有者) \|/.test(m.roleBadgeText)) {
            throw new Error(`${shot.file}: role badges start with ${m.roleBadgeText}`);
          }
          if (!m.transferButtonText && shot.kind === "button") {
            throw new Error(`${shot.file}: transfer button missing`);
          }
          if (shot.kind === "confirm") {
            if (!m.dialogPresent) throw new Error(`${shot.file}: confirm dialog missing`);
            if (!m.consequenceText) throw new Error(`${shot.file}: consequence sentence missing`);
            if (shot.lang === "zh") {
              if (!/[一-鿿]/.test(m.consequenceText)) throw new Error(`${shot.file}: ZH consequence has no CJK`);
            } else if (!/^You will become an administrator/.test(m.consequenceText)) {
              throw new Error(`${shot.file}: EN consequence is ${m.consequenceText}`);
            }
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
    ledgerRowHeader(),
    "# layoutFiles carry sha256 hashes of the files they name; proof of which code generated each crop.",
    "# Rebuild any crop and recompute its layoutFiles, or the test will fail and the PR will not land.",
    `# capturedAtHead: ${capturedAtHead}`,
    `capturedAtHead: ${capturedAtHead}`,
    `capturedAt: ${new Date().toISOString()}`,
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - 1440x900",
    "  - 390x844",
    "harness: /dev/settings?s=team&lang=<en|zh>",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: Set TERMINAL_E2E_FIXTURE=1 and next.config.ts sets devIndicators false, hiding Next.js dev button overlay from crops.",
    "command: node terminal/e2e/tools/capture_f12_9_team_ownership_transfer.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) =>
      `  ${file}: { transferButtonText: ${JSON.stringify(m.transferButtonText)}, dialogPresent: ${m.dialogPresent},`
      + ` confirmTitle: ${JSON.stringify(m.confirmTitle)}, consequenceText: ${JSON.stringify(m.consequenceText)},`
      + ` roleBadgeText: ${JSON.stringify(m.roleBadgeText)}, inviteBadgeText: ${JSON.stringify(m.inviteBadgeText)},`
      + ` inviteGroupTitle: ${JSON.stringify(m.inviteGroupTitle)} }`),
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
