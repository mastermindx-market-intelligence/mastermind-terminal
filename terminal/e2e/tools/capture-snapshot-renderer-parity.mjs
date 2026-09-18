import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.PROOF_BASE_URL;
if (!base) throw new Error("PROOF_BASE_URL is required");

const output = join(import.meta.dirname, "../../docs/pr-crops/snapshot-renderer-parity-20260918");
mkdirSync(output, { recursive: true });

const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

const cases = [
  { name: "desktop", width: 1440, height: 900, hasTouch: false },
  { name: "tablet", width: 820, height: 1180, hasTouch: true },
  { name: "mobile", width: 390, height: 844, hasTouch: true },
];

const receipt = {
  capturedAt: new Date().toISOString(),
  capturedAtHead: head,
  base,
  theme: "dark",
  cases: [],
};

function pngDimensions(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of cases) {
    for (const lang of ["en", "zh"]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.hasTouch,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      await page.addInitScript(({ language }) => {
        localStorage.setItem("mm.lang", language);
        localStorage.setItem("mm.startTf", JSON.stringify("D"));
        localStorage.setItem("mm.inds", JSON.stringify(["ema", "vol", "macd", "stochrsi"]));
        localStorage.removeItem("mm.chartSettings");
        window.__snapshotProofReady = null;
        window.addEventListener("mm:terminal-visual-ready", (event) => {
          const detail = event.detail;
          if (detail?.symbol === "NVDA" && detail?.state === "data") window.__snapshotProofReady = detail;
        });
      }, { language: lang });

      const response = await page.goto(`${base}/terminal?symbol=NVDA`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      assert.equal(response?.status(), 200);
      await page.locator(".chart-wrap canvas").first().waitFor({ state: "visible", timeout: 25_000 });
      await page.waitForFunction(() => window.__snapshotProofReady != null, null, { timeout: 25_000 });
      assert.equal(await page.locator("html").getAttribute("data-lang"), lang);

      const legend = page.locator(".lg-name:visible").first();
      if (!(await legend.isVisible().catch(() => false))) {
        const toggle = page.locator(".lg-collapse").first();
        if (await toggle.isVisible().catch(() => false)) await toggle.click();
      }
      await page.locator(".lg-name:visible").first().waitFor({ state: "visible", timeout: 10_000 });

      const stem = `${viewport.name}-dark-${lang}`;
      const livePath = join(output, `${stem}-live.png`);
      const exportPath = join(output, `${stem}-export.png`);
      await page.screenshot({ path: livePath, fullPage: false });

      const downloadPromise = page.waitForEvent("download");
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } }));
      });
      const download = await downloadPromise;
      await download.saveAs(exportPath);

      const liveDimensions = pngDimensions(livePath);
      const exportDimensions = pngDimensions(exportPath);
      assert.deepEqual(liveDimensions, [viewport.width, viewport.height]);
      assert.ok(exportDimensions[0] >= viewport.width, "export should preserve the 2x chart raster");
      assert.ok(exportDimensions[1] >= 500, "export should contain a substantive chart body");

      receipt.cases.push({
        viewport: viewport.name,
        language: lang,
        live: `${stem}-live.png`,
        export: `${stem}-export.png`,
        liveDimensions,
        exportDimensions,
        indicatorTitle: await page.locator(".lg-name:visible").first().textContent(),
      });
      await context.close();
    }
  }
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}
