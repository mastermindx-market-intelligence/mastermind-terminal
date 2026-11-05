#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * B-F11-10a Analysis context-bar theses entry — dark evidence crops.
 *
 * Playwright against the /analysis?symbol=NVDA company view, capturing the new
 * theses control in the Analysis context bar. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-10-analysis-theses-entry/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, lstatSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-10-analysis-theses-entry");
const LAYOUT_FILES = [
  "terminal/components/workspaces/AnalysisWorkspace.tsx",
  "terminal/app/company-intelligence.css",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3565);
const BASE = `http://127.0.0.1:${PORT}`;
const SYM = "NVDA";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  { viewport: "desktop", lang: "en", file: "desktop-en.png" },
  { viewport: "desktop", lang: "zh", file: "desktop-zh.png" },
  { viewport: "tablet", lang: "en", file: "tablet-en.png" },
  { viewport: "tablet", lang: "zh", file: "tablet-zh.png" },
  { viewport: "mobile", lang: "en", file: "mobile-en.png" },
  { viewport: "mobile", lang: "zh", file: "mobile-zh.png" },
];

// This provider-closed capture uses the real app, with no local dotenv authority.
// Do not read or print dotenv values, and do not turn absence into an auth claim.
function assertNoCaptureDotenv(root = ROOT) {
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    try { lstatSync(join(root, name)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw new Error("F11_DOTENV_PRESENT");
  }
}

function captureServerEnv(parent = process.env) {
  const inherited = {};
  for (const name of ["PATH", "HOME", "LANG", "TMPDIR", "TMP", "TEMP"]) {
    if (typeof parent[name] === "string") inherited[name] = parent[name];
  }
  return {
    ...inherited,
    NODE_ENV: "development",
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    TERMINAL_REQUIRE_AUTH: "0",
    MMX_SHARED_SHELL: "0",
    MMX_INVESTOR_SHELL_PREVIEW: "0",
    RATE_LIMIT_MAX: "100000",
    HUB_REALTIME_QUOTES: "1",
    FLOW_FIXTURE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
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

function startServer() {
  assertNoCaptureDotenv();
  const env = captureServerEnv();
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
      const res = await fetch(`${BASE}/analysis?symbol=${SYM}`, { redirect: "manual", headers: { Cookie: "mm_e2e_rs30=1" } });
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

async function installCaptureBoundary(context, base = BASE) {
  const { classifyRequest, typedUnavailablePayload } = require("./f11_provider_closed_policy.cjs");
  const counts = { forwarded: 0, unavailable: 0, businessUnavailable: 0, componentFundUnavailable: 0, aborted: 0, webSocketsBlocked: 0, redirectOrBadStatus: 0, failedAllowedResponses: [] };
  let signalBusinessRequest;
  const observedBusinessRequest = new Promise(resolve => { signalBusinessRequest = resolve; });
  Object.defineProperty(counts, "waitForBusinessRequest", { value: async (timeoutMs = 10_000) => {
    let timer;
    try {
      await Promise.race([observedBusinessRequest, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED")), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  } });
  if (typeof context.routeWebSocket !== "function") throw new Error("F11_WEBSOCKET_BOUNDARY_UNSUPPORTED");
  // The crop needs no live stream, including dev HMR. Block before a socket connects.
  await context.routeWebSocket("**/*", (socket) => { counts.webSocketsBlocked++; socket.close(); });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const decision = classifyRequest({ url: request.url(), method: request.method(), resourceType: request.resourceType() }, base);
    if (decision.decision === "fulfill") {
      counts.unavailable++;
      await route.fulfill({ status: 503, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(typedUnavailablePayload()) });
      // Observe only the component's normal business reads, never issue a probe.
      const intercepted = new URL(request.url());
      if (intercepted.pathname.startsWith("/api/") || intercepted.pathname.startsWith("/data/")) counts.businessUnavailable++;
      // AnalysisWorkspace calls getFund(sym) from its settled-symbol effect;
      // fund.ts owns this exact URL. Chrome/other-symbol reads are not this proof.
      if (intercepted.origin === base && intercepted.pathname === `/data/${SYM}.fund.json`) {
        counts.componentFundUnavailable++;
        signalBusinessRequest();
      }
      return;
    }
    if (decision.decision === "continue") {
      // Only policy-qualified loopback documents/assets reach this call. Do not
      // allow a redirect from an otherwise allowed URL to escape the boundary.
      const response = await route.fetch({ maxRedirects: 0 });
      const status = response.status();
      if (status !== 200) {
        counts.redirectOrBadStatus++;
        // Diagnose a failed public asset without retaining URLs, queries,
        // headers or bodies. The positive200/event guards remain unchanged.
        if (counts.failedAllowedResponses.length < 8) {
          const resourceType = request.resourceType();
          const families = { document: "analysis-document", script: "next-script", stylesheet: "next-style", font: "next-font", image: "static-image", manifest: "static-manifest" };
          counts.failedAllowedResponses.push({ family: families[resourceType] || "unknown", resourceType: Object.hasOwn(families, resourceType) ? resourceType : "unknown", status });
        }
        return route.abort("blockedbyclient");
      }
      counts.forwarded++;
      return route.fulfill({ response });
    }
    counts.aborted++;
    return route.abort("blockedbyclient");
  });
  return counts;
}

async function openAnalysis(page, lang, viewport) {
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
  await page.goto(`${BASE}/analysis?symbol=${SYM}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  // Wait for the context bar and the theses control to be visible.
  const entry = page.getByLabel(lang === "zh" ? "你的研究论点：NVDA" : "Your theses on NVDA");
  await entry.waitFor({ state: "visible", timeout: 45_000 });
  if (await entry.count() !== 1) throw new Error("F11_THESES_ENTRY_NOT_UNIQUE");
  const href = new URL(await entry.getAttribute("href"), BASE);
  if (href.origin !== BASE || href.pathname !== "/analysis"
      || href.searchParams.get("view") !== "theses" || href.searchParams.get("symbol") !== SYM) {
    throw new Error("F11_THESES_ENTRY_IDENTITY_MISMATCH");
  }
  const bounds = await entry.boundingBox();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error("F11_THESES_ENTRY_EMPTY");
  await stripDevOverlay(page);
  return { symbol: SYM, lang, state: "context-bar-with-theses-control", href: href.pathname + href.search, entryBounds: bounds };
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  return page.screenshot({ path: join(OUT, file) });
}

async function main() {
  const { chromium } = require("@playwright/test");
  assertNoCaptureDotenv();
  mkdirSync(OUT, { recursive: true });
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  const entryObservations = [];
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const shot of SHOTS) {
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: VIEWPORTS[shot.viewport],
          hasTouch: shot.viewport !== "desktop", // tablet + mobile: pointer:coarse, so the 44px floor is what the crops show
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
          colorScheme: "dark",
          serviceWorkers: "block",
        });
        const boundaryCounts = await installCaptureBoundary(context);
        await context.addCookies([{ name: "mm_e2e_rs30", value: "1", url: BASE }]);
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        const pageErrorNames = [];
        page.on("pageerror", error => {
          const known = ["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError"];
          pageErrorNames.push(known.includes(error.name) ? error.name : "Error");
        });
        try {
          const entry = await openAnalysis(page, shot.lang, VIEWPORTS[shot.viewport]);
          await boundaryCounts.waitForBusinessRequest();
          if (pageErrorNames.length) throw new Error("F11_PAGE_SCRIPT_ERROR");
          const image = await shoot(page, shot.file);
          if (boundaryCounts.componentFundUnavailable < 1) throw new Error("F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED");
          if (boundaryCounts.redirectOrBadStatus !== 0) throw new Error("F11_ALLOWED_ROUTE_DID_NOT_RETURN_200");
          files.push(shot.file);
          entryObservations.push({ file: shot.file, viewport: VIEWPORTS[shot.viewport], ...entry, requestBoundary: { ...boundaryCounts }, pageErrorNames, image: { bytes: image.length, sha256: createHash("sha256").update(image).digest("hex") } });
          console.log("ok");
        } catch (err) {
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          console.error("F11_CAPTURE_DIAGNOSTICS " + JSON.stringify({ file: shot.file, requestBoundary: { ...boundaryCounts }, pageErrorNames }));
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

  writeFileSync(join(OUT, "FIXTURE.json"), JSON.stringify({
    schema: "terminal.f11-source-component-fixture.v1",
    capturedAtHead,
    fixtureSources: Object.fromEntries([
      "terminal/e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs",
      "terminal/e2e/tools/f11_provider_closed_policy.cjs",
      "terminal/app/(shell)/analysis/page.tsx",
      "terminal/app/(shell)/layout.tsx",
      "terminal/lib/supabase/middleware.ts",
      ".github/workflows/ci.yml",
      ...LAYOUT_FILES,
    ].map((rel) => [rel, sha256File(rel)])),
    scope: "Real source component, synthetic fixture identity and unavailable market inputs; no authenticated, provider, installed or account proof",
    entryObservations,
  }, null, 2) + "\n");

  const evidence = [
    "# B-F11-10a Analysis context-bar theses entry — capture evidence",
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
    "  - { name: tablet, width: 820, height: 1180 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { url: "/analysis?symbol=${SYM}&lang=${s.lang}", state: context-bar-with-theses-control }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs",
    "files:",
    ...SHOTS.map((s) => `  - ${s.file}`),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), `${evidence.join("\n")}\n`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at ${capturedAtHead}`);
}

module.exports = { assertNoCaptureDotenv, captureServerEnv, installCaptureBoundary };

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
