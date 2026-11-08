#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Incumbent capture tools and the Node test runner use CommonJS require/exports. */
/**
 * B-F13-6 Claim authoring form — dark evidence crops.
 *
 * Playwright against the real /analysis?view=theses harness. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f13_6_claim_form.cjs
 *   node e2e/tools/capture_b_f13_6_claim_form.cjs --light-claim
 * The fixed light mode writes ONE separately labelled observation under
 * light-native-controls/ through the real PresentationOwner; dark12 is unchanged.
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f13-6-claim-form/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const runtime = require("./thesis_capture_runtime.cjs");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const TARGET = join(ROOT, "docs", "pr-crops", "b-f13-6-claim-form");
let OUT;
const LIGHT_MODE = "shared-shell-light-en-1440";
const LIGHT_FILE = "light-en-1440-native-controls.png";
const LAYOUT_FILES = [
  "terminal/components/workspaces/ClaimAuthoringForm.tsx",
  "terminal/components/workspaces/ClaimAuthoringForm.module.css",
  "terminal/lib/claimAuthoring.ts",
  "terminal/components/workspaces/ThesisWorkspace.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3556);
const BASE = `http://127.0.0.1:${PORT}`;
const SYM = "NVDA";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  { viewport: "desktop", lang: "en", filled: false, file: "desktop-en-empty.png", kind: "modal" },
  { viewport: "desktop", lang: "zh", filled: false, file: "desktop-zh-empty.png", kind: "modal" },
  { viewport: "desktop", lang: "en", filled: true, file: "desktop-en-filled.png", kind: "modal" },
  { viewport: "desktop", lang: "zh", filled: true, file: "desktop-zh-filled.png", kind: "modal" },
  { viewport: "mobile", lang: "en", filled: false, file: "mobile-en-empty.png", kind: "modal" },
  { viewport: "mobile", lang: "zh", filled: false, file: "mobile-zh-empty.png", kind: "modal" },
  { viewport: "mobile", lang: "en", filled: true, file: "mobile-en-filled.png", kind: "modal" },
  { viewport: "mobile", lang: "zh", filled: true, file: "mobile-zh-filled.png", kind: "modal" },
  { viewport: "desktop", lang: "en", filled: false, file: "desktop-en-entry.png", kind: "entry" },
  { viewport: "desktop", lang: "zh", filled: false, file: "desktop-zh-entry.png", kind: "entry" },
  { viewport: "mobile", lang: "en", filled: false, file: "mobile-en-entry.png", kind: "entry" },
  { viewport: "mobile", lang: "zh", filled: false, file: "mobile-zh-entry.png", kind: "entry" },
];

function captureMode(args) {
  if(args.length === 0)return "dark";
  if(args.length === 1 && args[0] === "--light-claim")return LIGHT_MODE;
  throw Error("THESIS_CAPTURE_PRESENTATION_SCOPE");
}

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
}

function utcTomorrow() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
}

async function startServer(mode) { return runtime.start(ROOT, PORT, OUT, mode); }
async function stopServer(owner) { return owner.stop(); }
async function waitForServer(timeoutMs, owner) { return owner.ready(timeoutMs); }

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

async function openWorkspace(page, lang, viewport, clickEntry) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/analysis?view=theses&symbol=${SYM}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("thesis-workspace").waitFor({ state: "visible", timeout: 45_000 });
  const btn = page.getByTestId("claim-entry-button");
  await btn.waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="claim-entry-button"]');
    return !!(el && !el.disabled);
  }, null, { timeout: 45_000 });
  if (clickEntry) {
    await btn.click();
    await page.getByTestId("claim-authoring-form").waitFor({ state: "visible", timeout: 15_000 });
  } else {
    await page.getByTestId("thesis-context-actions").waitFor({ state: "visible", timeout: 15_000 });
  }
  await stripDevOverlay(page);
}

async function fillForm(page, lang) {
  const form = page.getByTestId("claim-authoring-form");
  const cmpLabel = lang === "zh" ? "方向" : "Direction";
  await form.getByLabel(cmpLabel).selectOption({ index: 1 });
  const levelLabel = lang === "zh" ? "数值" : "Level";
  await form.getByLabel(levelLabel).fill("150");
  const dateLabel = lang === "zh" ? "结算日期" : "Settles on";
  await form.getByLabel(dateLabel).fill(utcTomorrow());
  const toggle = lang === "zh" ? "我也想说明我的把握程度" : "I also want to state how sure I am";
  await form.getByText(toggle, { exact: true }).click();
  await form.locator('input[type="range"]').waitFor({ state: "visible", timeout: 5_000 });
  const noteLabel = lang === "zh" ? "添加备注（可选）" : "Add a note (optional)";
  await form.getByLabel(noteLabel).fill(lang === "zh" ? "若需求维持。" : "If demand holds.");
}

async function shoot(page, file, kind) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const target = kind === "entry"
    ? page.getByTestId("thesis-context-actions")
    : page.getByTestId("claim-authoring-form");
  await runtime.captureCanonicalScreenshot(page, target, { path: join(OUT, file) });
}

// One separately labelled observation through the incumbent PresentationOwner.
// No init-script theme assignment and no account metadata or Claim submission.
async function openLightWorkspace(page) {
  await page.context().addCookies([
    {name:"mm_e2e_rs30",value:"1",url:BASE},
    {name:"mm_e2e_guest",value:"1",url:BASE},
  ]);
  await page.goto(`${BASE}/analysis?view=theses&symbol=${SYM}&lang=en`, {
    waitUntil:"domcontentloaded",timeout:90_000,
  });
  await page.locator('[data-shared-shell="beta"]').waitFor({state:"visible",timeout:45_000});
  const light = page.getByRole("button",{name:"Light theme",exact:true});
  await light.waitFor({state:"visible"});
  if(await light.getAttribute("aria-pressed") !== "true")await light.click();
  await page.waitForFunction(() => {
    const root = document.documentElement;
    return root.dataset.mmxSharedShell === "1" && root.dataset.theme === "light"
      && root.dataset.lang === "en";
  },null,{timeout:15_000});
  const entry = page.getByTestId("claim-entry-button");
  await entry.waitFor({state:"visible",timeout:45_000});
  await page.waitForFunction(() => {
    const entry = document.querySelector('[data-testid="claim-entry-button"]');
    return !!entry && !entry.disabled;
  },null,{timeout:45_000});
  await entry.click();
  await page.getByTestId("claim-authoring-form").waitFor({state:"visible"});
}
function assertLightObservation(facts) {
  if(facts.sharedShell !== "1" || facts.theme !== "light" || facts.lang !== "en"
      || facts.lightPressed !== "true" || facts.viewport.width !== 1440 || facts.viewport.height !== 900
      || facts.panelToken !== "#ffffff" || facts.panelBackground !== "rgb(255, 255, 255)"
      || facts.panelText !== "rgb(32, 38, 50)" || facts.dateBackground !== "rgb(238, 241, 246)"
      || facts.dateScheme !== "light" || facts.checkboxScheme !== "light"
      || !/^\d{4}-\d{2}-\d{2}$/.test(facts.dateValue) || facts.checkboxChecked !== true)
    throw Error("THESIS_CAPTURE_LIGHT_PRESENTATION");
  return facts;
}
async function observeLight(page) {
  return page.evaluate(() => {
    const root = document.documentElement, form = document.querySelector('[data-testid="claim-authoring-form"]');
    const date = form.querySelector('input[type="date"]'), checkbox = form.querySelector('input[type="checkbox"]');
    const panel = getComputedStyle(form), dateStyle = getComputedStyle(date), checkStyle = getComputedStyle(checkbox);
    return {sharedShell:root.dataset.mmxSharedShell,theme:root.dataset.theme,lang:root.dataset.lang,
      lightPressed:document.querySelector('button[aria-label="Light theme"]')?.getAttribute("aria-pressed"),
      viewport:{width:innerWidth,height:innerHeight},panelToken:panel.getPropertyValue("--panel").trim(),
      panelBackground:panel.backgroundColor,panelText:panel.color,dateBackground:dateStyle.backgroundColor,
      dateScheme:dateStyle.colorScheme,checkboxScheme:checkStyle.colorScheme,
      dateValue:date.value,checkboxChecked:checkbox.checked,checkboxAccent:checkStyle.accentColor,
      dateAppearance:dateStyle.appearance,checkboxAppearance:checkStyle.appearance};
  });
}
function retainLightStyles(page) {
  const pending = [], delivered = []; let failed;
  page.on("response",response => {
    try {
      const request = response.request(), url = new URL(response.url());
      if(request.resourceType() !== "stylesheet")return;
      if(url.origin !== BASE || url.username || url.password || !url.pathname.startsWith("/_next/static/") || pending.length >= 32)
        throw Error("THESIS_CAPTURE_LIGHT_CSS_SCOPE");
      pending.push((async () => {
      const body = await response.body();
      if(response.status() !== 200 || body.length > 4*1024*1024)throw Error("THESIS_CAPTURE_LIGHT_CSS_SCOPE");
      const text = body.toString();
      delivered.push({path:url.pathname,bytes:body.length,sha256:createHash("sha256").update(body).digest("hex"),
        sharedShell:text.includes("data-mmx-shared-shell"),claimForm:text.includes("ClaimAuthoringForm")});
      })().catch(error => {failed ||= error;}));
    } catch(error) { failed ||= error; }
  });
  return async () => {
    await Promise.all(pending);if(failed)throw failed;
    if(!delivered.some(file => file.sharedShell) || !delivered.some(file => file.claimForm))
      throw Error("THESIS_CAPTURE_LIGHT_CSS_MISSING");
    return delivered.sort((a,b) => a.path.localeCompare(b.path));
  };
}

async function main(args = process.argv.slice(2)) {
  if (process.env.CAPTURE_ONLY) throw Error("THESIS_CAPTURE_PARTIAL_REFUSED");
  const mode = captureMode(args), light = mode === LIGHT_MODE;
  const chromium = runtime.getChromium();
  OUT = runtime.staging(ROOT, light ? "b-f13-6-claim-light" : "b-f13-6-claim-form");
  mkdirSync(OUT, {recursive:true});
  const capturedAtHead = currentGitHead();
  const child = await startServer(mode);
  const shots = light ? [{viewport:"desktop",lang:"en",filled:true,file:LIGHT_FILE,kind:"modal"}] : SHOTS;
  let lightObservation, deliveredStyles;
  const files = [];
  let primaryError;
  try {
    await waitForServer(180_000, child);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const shot of shots) {
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: VIEWPORTS[shot.viewport],
          hasTouch: shot.viewport === "mobile",
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
          colorScheme: light ? "light" : "dark",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        try {
          const styles = light ? retainLightStyles(page) : null;
          if(light)await openLightWorkspace(page);
          else await openWorkspace(page, shot.lang, VIEWPORTS[shot.viewport], shot.kind !== "entry");
          if (shot.kind === "modal" && shot.filled) await fillForm(page, shot.lang);
          if(light) {
            lightObservation = await observeLight(page);
            console.log("THESIS_CAPTURE_LIGHT_OBSERVATION "+JSON.stringify(lightObservation));
            assertLightObservation(lightObservation);deliveredStyles = await styles();
          }
          await shoot(page, shot.file, shot.kind);
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
  } catch(error) {
    primaryError=error;child.failure(error);throw error;
  } finally {
    await runtime.cleanupPreserving(primaryError,()=>stopServer(child));
  }

  const evidence = light ? [
    "# One focused Shared Shell light Claim native-controls observation; separate from dark40",
    `# capturedAtHead: ${capturedAtHead}`,
    "theme: light", "languages: [en]", "viewports: [{ name: desktop, width: 1440, height: 900 }]",
    "layoutFiles:",...layoutFilesBlock(),
    ...["terminal/components/chrome/shared-shell/shared-shell.css","terminal/components/chrome/shared-shell/SharedShellPresentation.tsx","terminal/app/(shell)/layout.tsx"].map(rel => `  ${rel}: "${sha256File(rel)}"`),
    `observation: ${JSON.stringify(lightObservation)}`,`deliveredStyles: ${JSON.stringify(deliveredStyles)}`,
    "command: node e2e/tools/capture_b_f13_6_claim_form.cjs --light-claim",
    "files:",`  - ${LIGHT_FILE}`,
  ] : [
    "# B-F13-6 Claim authoring form — capture evidence",
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
    ...SHOTS.map((s) => `  ${s.file}: { url: "/analysis?view=theses&symbol=${SYM}&lang=${s.lang}", state: ${s.kind === "entry" ? "entry" : (s.filled ? "filled" : "empty")} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f13_6_claim_form.cjs",
    "files:",
    ...SHOTS.map((s) => `  - ${s.file}`),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), `${evidence.join("\n")}\n`);
  runtime.publish(OUT, light ? join(TARGET,"light-native-controls") : TARGET, files, { ...child.summary(), counts: chromium.counts, toolchain: chromium.toolchain, capturedAtHead, ...(light ? {presentation:mode,lightObservation,deliveredStyles} : {}) });
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at ${capturedAtHead}`);
}

module.exports = {captureMode,assertLightObservation,openLightWorkspace,retainLightStyles,SHOTS,LIGHT_MODE,LIGHT_FILE};

if(require.main === module)main().catch((err) => {
  console.error(err);
  process.exit(1);
});
