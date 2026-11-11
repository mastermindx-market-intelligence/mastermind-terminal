// Crops for the Statements "Full history" gap notice (#364): the deep-history note plus the
// first page of backfilled years, where EBITDA reads as a dash.
//
// Needs a dev server started with the playwright webServer env (ANALYSIS_LOCAL_PREVIEW=1 and the
// e2e fixture/entitlement vars) and a merged AAPL.fund.json in public/data, which is git-excluded:
//   BASE_URL=http://127.0.0.1:<port> STATE=after node docs/pr-crops/fund-deep-history-gap-notice/capture.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3377";
const state = process.env.STATE ?? "after";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];

mkdirSync(here, { recursive: true });
const browser = await chromium.launch();
for (const vp of viewports) {
  for (const lang of ["en", "zh"]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    // localStorage only: documentElement is still null when an init script runs.
    await ctx.addInitScript((l) => { try { localStorage.setItem("mm.lang", l); } catch {} }, lang);
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/analysis?symbol=AAPL&page=statements`, { waitUntil: "domcontentloaded" });
    const note = page.locator(".fin-chart-note").filter({ hasText: lang === "zh" ? "深度历史" : "Deep history" });
    await note.waitFor({ timeout: 120_000 });
    // The crop is taken only once the localised string is on screen, never from SSR English.
    await page.locator(".fin-pg-chev").first().click();
    await page.locator("tr").filter({ hasText: "2021" }).first().waitFor();
    // Heading + note, centred: at 390px the shell scrolls an inner pane and a sticky bar covers
    // the top, so a section-top clip would show the table but not the note.
    await note.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const head = note.locator("xpath=ancestor::section[1]").locator(".fin-sec-h").first();
    const h = await head.boundingBox();
    const n = await note.boundingBox();
    const pad = 8;
    await page.screenshot({
      path: `${here}/${vp.name}-${lang}-dark-${state}.png`,
      clip: { x: h.x - pad, y: h.y - pad, width: h.width + 2 * pad, height: n.y + n.height - h.y + 2 * pad },
    });
    if (vp.name === "desktop") {
      // The backfilled years themselves: line items present, EBITDA a dash.
      const ebitda = page.locator("tr").filter({ hasText: /EBITDA/ }).first();
      await ebitda.scrollIntoViewIfNeeded();
      const h2 = await head.boundingBox();
      const r = await ebitda.boundingBox();
      await page.screenshot({
        path: `${here}/${vp.name}-${lang}-dark-${state}-years.png`,
        clip: { x: h2.x - pad, y: h2.y - pad, width: h2.width + 2 * pad, height: r.y + r.height - h2.y + 2 * pad },
      });
    }
    const text = (await note.textContent()).trim();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(JSON.stringify({ vp: vp.name, lang, state, overflow, text }));
    await ctx.close();
  }
}
await browser.close();
