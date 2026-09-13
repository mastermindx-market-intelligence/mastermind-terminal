#!/usr/bin/env node
// PR #435 (D7 billing-fail-closed) — MAJOR evidence-matrix capture.
//
// Captures four dark-theme PNGs (EN/ZH x 1440x900/390x844) of the billing-outcome states this
// PR changes, rendering the REAL production StepBilling/StepDone components under the REAL app
// shell (no palette/CSS fork). See _harness_page.tsx's header for exactly what is real vs
// reproduced. Self-contained and reproducible: this script writes the throwaway route, starts a
// dev server, captures, and removes the route again — nothing under app/ is left behind.
//
// Usage: node e2e/proof/pr-435/capture.cjs   (run from terminal/)
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { chromium } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const HARNESS_SRC = path.join(__dirname, "_harness_page.tsx");
const HARNESS_DIR = path.join(ROOT, "app", "pr435proof");
const HARNESS_DEST = path.join(HARNESS_DIR, "page.tsx");
const OUT_DIR = __dirname;
const PORT = Number(process.env.PR435_PROOF_PORT || 3417);
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
];
const LANGS = ["en", "zh"];

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`dev server did not come up at ${url}`));
        else setTimeout(tick, 1000);
      });
    };
    tick();
  });
}

async function main() {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.copyFileSync(HARNESS_SRC, HARNESS_DEST);

  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => { serverLog += d.toString(); });
  child.stderr.on("data", (d) => { serverLog += d.toString(); });

  let browser;
  try {
    await waitForServer(`${BASE}/pr435proof`, 120_000);

    browser = await chromium.launch();
    for (const lang of LANGS) {
      const context = await browser.newContext({ colorScheme: "dark" });
      // Both StepBilling instances on the page share fetch; branch the mocked response on the
      // request body's `tier` so the "essential" instance sees a generic non-2xx (-> obBillErr)
      // and the "pro" instance sees the 409 "already subscribed" contract (-> obBillAlready).
      await context.route("**/api/billing/config", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publishable_key: "pk_test_proof" }) })
      );
      await context.route("**/api/billing/subscribe/init", (route) => {
        let tier = "essential";
        try { tier = JSON.parse(route.request().postData() || "{}").tier || tier; } catch { /* keep default */ }
        if (tier === "pro") {
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "already_subscribed" }) });
        }
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "proof_forced_error" }) });
      });

      const page = await context.newPage();
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.goto(`${BASE}/pr435proof?lang=${lang}`, { waitUntil: "networkidle" });
        await page.waitForSelector(`[data-pr435-ready="${lang}"]`, { timeout: 15_000 });
        // Let both StepBilling instances resolve their intercepted fetch chain and settle phase.
        await page.waitForFunction(
          () => document.querySelectorAll(".ob-bill-state").length >= 2,
          null,
          { timeout: 15_000 }
        );
        const outFile = path.join(OUT_DIR, `dark-${lang}-${vp.w}x${vp.h}.png`);
        await page.screenshot({ path: outFile, fullPage: true });
        console.log(`captured ${outFile}`);
      }
      await context.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(HARNESS_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
    if (process.exitCode && process.exitCode !== 0) {
      console.error("---- dev server log (tail) ----\n" + serverLog.slice(-4000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  try { fs.rmSync(HARNESS_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
});
