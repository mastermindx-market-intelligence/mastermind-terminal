import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const base = process.env.PROOF_BASE_URL || "https://app.mastermind-x.com";
const expected = process.env.PROOF_RELEASE;
if (!expected || !/^[0-9a-f]{40}$/.test(expected)) throw new Error("PROOF_RELEASE must be the exact deployed SHA");
const output = "docs/pr-crops/terminal-visual-intelligence/candles-production";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipt = { capturedAt: new Date().toISOString(), base, expectedRelease: expected, isolatedAnonymousContexts: true, cases: [] };
try {
  for (const scenario of ["fresh", "existing"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    if (scenario === "existing") await page.addInitScript(() => {
      if (sessionStorage.getItem("candles-live-proof-seeded")) return;
      localStorage.setItem("mm.inds", JSON.stringify(["ema", "trend"]));
      localStorage.setItem("mm.indParams", JSON.stringify({ trend: {
        "te.on": true, "fb.on": false, "vb.on": false, "cp.on": false, "dash.on": false, "cp.mode": "trendVolume",
      } }));
      localStorage.setItem("mm.indHidden", JSON.stringify(["trend"]));
      sessionStorage.setItem("candles-live-proof-seeded", "1");
    });
    const response = await page.goto(base + "/terminal?symbol=NVDA", { waitUntil: "domcontentloaded", timeout: 45000 });
    assert.equal(response.status(), 200);
    const html = await response.text();
    assert.ok(html.includes(`data-dpl-id="${expected}"`), "The actual served HTML must identify the requested release");
    await page.locator(".chart-wrap canvas").first().waitFor({ state: "visible", timeout: 25000 });
    const openLibrary = async () => {
      await page.locator(".indicator-library-trigger").click();
      const library = page.locator(".imodal-library");
      await library.waitFor({ state: "visible" });
      await library.locator(".im-nav-item").filter({ hasText: "Trend Waves" }).click();
      return library.getByRole("switch", { name: "Mastermind Candles", exact: true });
    };
    const toggle = await openLibrary();
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    const state = await page.evaluate(() => ({ marker: localStorage.getItem("mm.mastermindCandles.v1"),
      params: JSON.parse(localStorage.getItem("mm.indParams") || "{}"), hidden: JSON.parse(localStorage.getItem("mm.indHidden") || "[]") }));
    assert.equal(state.marker, "1");
    assert.equal(state.params.trend["cp.on"], true);
    assert.equal(state.hidden.includes("suite:trend/cp"), false);
    if (scenario === "existing") {
      assert.equal(state.params.trend["cp.mode"], "trendVolume");
      assert.equal(state.params.trend["te.on"], true);
      assert.equal(state.hidden.includes("suite:trend/te"), true);
    } else assert.equal(state.params.trend["te.on"], false);
    await page.screenshot({ path: `${output}/${scenario}-default-on.png` });
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".chart-wrap canvas").first().waitFor({ state: "visible", timeout: 25000 });
    const after = await openLibrary();
    assert.equal(await after.getAttribute("aria-checked"), "false");
    receipt.cases.push({ scenario, onAfterRollout: true, offAfterRemovalAndReload: true, siblingSettingsPreserved: true });
    await context.close();
  }
  writeFileSync(`${output}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
} finally { await browser.close(); }
