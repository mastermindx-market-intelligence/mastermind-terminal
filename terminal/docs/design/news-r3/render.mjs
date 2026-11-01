/**
 * News R3 board renderer — 36 full-page crops.
 *
 *   node docs/design/news-r3/render.mjs
 *
 * For each board (A|B|C) × viewport (desktop 1440×900, tablet 834×1194,
 * mobile 390×844) × lang (en|zh) × theme (dark|light) it writes
 * docs/design/news-r3/crops/<board>-<viewport>-<lang>-<theme>.png.
 *
 * Boards are loaded by file:// URL (no server, no network). The playwright
 * module is resolved from, in order: the normal resolution paths, then
 * $PLAYWRIGHT_DIR, then the npx cache (each ~/.npm/_npx/&lt;hash&gt;/node_modules
 * entry that contains playwright) — wherever `npx playwright` left it.
 * Browsers install with `npx playwright install chromium`.
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const boardsDir = join(here, "boards");
const outDir = join(here, "crops");
mkdirSync(outDir, { recursive: true });

function loadPlaywright() {
  try { return createRequire(import.meta.url)("playwright"); } catch { /* fall through */ }
  if (process.env.PLAYWRIGHT_DIR) {
    return createRequire(join(resolve(process.env.PLAYWRIGHT_DIR), "package.json"))("playwright");
  }
  const npx = join(process.env.HOME ?? "", ".npm", "_npx");
  if (existsSync(npx)) {
    for (const entry of readdirSync(npx)) {
      const cand = join(npx, entry, "node_modules", "playwright");
      if (existsSync(cand)) return createRequire(join(cand, "package.json"))("playwright");
    }
  }
  throw new Error("playwright not found — run `npx playwright install chromium` or set PLAYWRIGHT_DIR");
}

const { chromium } = loadPlaywright();

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1194 },
  mobile: { width: 390, height: 844 },
};
const LANGS = ["en", "zh"];
const THEMES = ["dark", "light"];
const BOARDS = ["A", "B", "C"];

const browser = await chromium.launch();
let written = 0;
try {
  for (const board of BOARDS) {
    const url = "file://" + join(boardsDir, `${board}.html`);
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      for (const lang of LANGS) {
        for (const theme of THEMES) {
          await page.goto(`${url}?lang=${lang}&theme=${theme}`, { waitUntil: "load" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(60);
          const out = join(outDir, `${board}-${vpName}-${lang}-${theme}.png`);
          await page.screenshot({ path: out, fullPage: true });
          written += 1;
          console.log(`✓ ${board}-${vpName}-${lang}-${theme}.png`);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${written} crops written to ${outDir}`);
