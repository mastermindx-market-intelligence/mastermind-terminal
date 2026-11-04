import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { exposureMapT } from "../components/exposure-map/exposureMapStrings";
import { sectorFixture } from "./fixtures/sector-company-v3";
import { exposureHrefFor, prepareSectorJourney, type JourneyLang } from "./helpers/optionsR1Journey";
import { CORRECTED_HASH, ResearchStore, SAVED_HASH, routeResearch } from "./helpers/optionsR1Research";

// Options R1 W2 PR crop packet: regenerates docs/pr-crops/options-r1-w2 on synthetic sources.
// Opt-in only (OPTIONS_R1_CROPS=1); the rotation-relative-trend and options-research-continuity specs are the gates.
//   OPTIONS_R1_CROPS=1 npx playwright test e2e/options-r1-w2-crops.spec.ts --project=desktop --workers=1
const OUT = path.resolve(__dirname, "../docs/pr-crops/options-r1-w2");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/exposure-map/ExposureChartReference.tsx",
  "terminal/components/exposure-map/exposureMapStrings.ts",
  "terminal/components/sector-intelligence/SectorCompanyComparison.tsx",
  "terminal/components/sector-intelligence/SectorIntelligenceWorkspace.tsx",
  "terminal/components/sector-intelligence/SectorRotationMap.tsx",
  "terminal/components/sector-intelligence/SectorRotationMap.module.css",
  "terminal/components/workspaces/InvestigationWorkspace.tsx",
  "terminal/components/workspaces/InvestigationWorkspace.module.css",
  "terminal/lib/exposureChartRead.ts",
  "terminal/lib/investigationEvidenceOptions.ts",
  "terminal/lib/optionsEvidenceCurrent.ts",
  "terminal/lib/rotationEligibility.ts",
  "terminal/lib/rotationRelativeTrend.ts",
  "terminal/lib/sectorHoldingsCoverage.ts",
  "terminal/lib/sectorIntelligenceLex.ts",
];
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 820: { width: 820, height: 1180 }, 390: { width: 390, height: 844 } } as const;
type Width = keyof typeof VIEWPORTS;
const LANGS: JourneyLang[] = ["en", "zh"];
const NOW = Date.parse("2026-10-19T14:00:00Z");
const crops: { file: string; viewport: string; lang: JourneyLang; state: string; theme: "dark" | "light" }[] = [];
const COPY = {
  en: { group: "Rotation method", trend: "Relative trend · weekly EMA", title: "Title", question: "Research question", save: "Save research", saved: "Saved · Revision 1" },
  zh: { group: "轮动方法", trend: "相对趋势 · 周EMA", title: "标题", question: "研究问题", save: "保存研究", saved: "已保存 · 修订 1" },
} as const;

test.describe("Options R1 W2 crop packet", () => {
  test.skip(!process.env.OPTIONS_R1_CROPS, "Set OPTIONS_R1_CROPS=1 to regenerate docs/pr-crops/options-r1-w2");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function capture(page: Page, state: string, width: Width, lang: JourneyLang, target?: ReturnType<Page["getByTestId"]>, theme: "dark" | "light" = "dark") {
    let height: number = VIEWPORTS[width].height;
    await page.setViewportSize(VIEWPORTS[width]);
    await settle(page);
    const file = `${state}-${width}${lang === "zh" ? "-zh" : ""}${theme === "light" ? "-light" : ""}.png`;
    if (target) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await target.scrollIntoViewIfNeeded(); await settle(page);
        const box = await target.boundingBox();
        if (!box) throw new Error(`${file}: target has no bounding box`);
        const needed = Math.ceil(box.y + box.height + 72);
        if (needed <= height) break;
        height = Math.min(6000, needed);
        await page.setViewportSize({ width: VIEWPORTS[width].width, height }); await settle(page);
      }
      await target.screenshot({ path: path.join(OUT, file) });
    } else await page.screenshot({ path: path.join(OUT, file) });
    crops.push({ file, viewport: `${VIEWPORTS[width].width}x${height}`, lang, state, theme });
  }
  async function discover(page: Page, lang: JourneyLang, trend: "ready" | "unavailable" = "ready") {
    await page.addInitScript(({ lang, now }) => {
      localStorage.setItem("mm.lang", lang);
      document.documentElement?.setAttribute("data-lang", lang);
      Date.now = () => now;
    }, { lang, now: NOW });
    await page.route("**/api/sector-intelligence?**", route => {
      const source = new URL(route.request().url()).searchParams.get("source") || "";
      if (source === "relative_trend" && trend === "unavailable") return route.fulfill({ status: 404, json: { data: null, receipt: {
        source, status: "unavailable", path: null, asOf: null, observedAt: null, stale: false, contentHash: null } } });
      return sectorFixture(route);
    });
  }

  for (const lang of LANGS) {
    const c = COPY[lang];
    for (const theme of ["dark", "light"] as const) {
      test(`relative trend method / ${lang} / ${theme}`, async ({ page }) => {
        await discover(page, lang);
        await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}&sectorRotationMethod=relative_trend_ema`);
        const rotation = page.getByTestId("sector-rotation");
        await expect(rotation.getByRole("group", { name: c.group }).getByRole("button", { name: c.trend })).toHaveAttribute("aria-pressed", "true");
        await expect(rotation.getByTestId("rotation-trend-trail")).toBeVisible();
        for (const width of [1440, 820, 390] as Width[]) await capture(page, "rotation-trend", width, lang, rotation, theme);
      });
      test(`holdings coverage line / ${lang} / ${theme}`, async ({ page }) => {
        await discover(page, lang);
        await page.goto(`/discover?tab=sectors&sector=xlk&group=semiconductors&sectorTheme=${theme}`);
        const coverage = page.getByTestId("sector-holdings-coverage");
        await expect(coverage).toContainText(lang === "zh" ? "覆盖 20/68" : "Covers 20 of 68");
        const comparison = coverage.locator("xpath=ancestor::section[1]");
        for (const width of [1440, 820, 390] as Width[]) await capture(page, "holdings-coverage", width, lang, comparison, theme);
      });
    }
    test(`relative trend feed unavailable / ${lang}`, async ({ page }) => {
      await discover(page, lang, "unavailable");
      await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=dark&sectorRotationMethod=relative_trend_ema`);
      const rotation = page.getByTestId("sector-rotation");
      await expect(rotation.getByTestId("rotation-method-unavailable")).toBeVisible();
      for (const width of [1440, 390] as Width[]) await capture(page, "rotation-trend-unavailable", width, lang, rotation);
    });
    test(`chart reference with Save to research, the saved revision and a corrected source / ${lang}`, async ({ page, context, browser }, testInfo) => {
      const store = new ResearchStore();
      await routeResearch(context, store);
      await prepareSectorJourney(page, { lang, hash: () => SAVED_HASH });
      const { href } = await exposureHrefFor(page, "MU");
      await page.goto(href);
      const map = page.getByTestId("exposure-map");
      await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
      const t = exposureMapT(lang);
      await map.getByRole("button", { name: new RegExp(t("largestNet")) }).click();
      await page.getByTestId("exposure-node-inspector").getByRole("button", { name: t("openOnMainChart"), exact: true }).click();
      await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
      const reference = page.getByTestId("exposure-chart-reference");
      await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      for (const width of [1440, 390] as Width[]) { await reference.scrollIntoViewIfNeeded(); await capture(page, "chart-reference-save", width, lang); }
      await page.setViewportSize(VIEWPORTS[1440]);
      await reference.getByTestId("exposure-reference-save").click();
      await expect(page).toHaveURL(/\/analysis\?view=investigations&symbol=MU/, { timeout: 30_000 });
      const card = page.getByTestId("options-evidence");
      await expect(card.locator("[data-options-ref]")).toHaveCount(2);
      for (const width of [1440, 390] as Width[]) await capture(page, "research-draft", width, lang, card);
      await page.setViewportSize(VIEWPORTS[1440]);
      await page.getByLabel(c.title, { exact: true }).fill(lang === "zh" ? "MU 到期前的做市商持仓" : "MU dealer positioning into expiry");
      await page.getByLabel(c.question, { exact: true }).fill(lang === "zh" ? "最大的已覆盖净节点能否撑过下一交易日？" : "Does the largest covered net node hold through the next session?");
      await page.getByRole("button", { name: c.save, exact: true }).click();
      await expect(page.getByText(c.saved)).toBeVisible({ timeout: 30_000 });
      await expect(card.getByTestId("options-evidence-state")).toHaveCount(2, { timeout: 30_000 });
      for (const width of [1440, 820, 390] as Width[]) await capture(page, "research-saved", width, lang);
      const revisionUrl = page.url();
      const { viewport, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent } = testInfo.project.use;
      const other = await browser.newContext({ viewport: viewport ?? undefined, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent });
      await routeResearch(other, store);
      const otherPage = await other.newPage();
      await prepareSectorJourney(otherPage, { lang, hash: () => CORRECTED_HASH });
      await otherPage.goto(revisionUrl);
      const otherCard = otherPage.getByTestId("options-evidence");
      await expect(otherCard.locator('[data-options-ref="sector_origin"]').getByTestId("options-evidence-state")).toHaveText(lang === "zh" ? "来源在此版本后已修正" : "Source corrected since this revision", { timeout: 30_000 });
      for (const width of [1440, 390] as Width[]) await capture(otherPage, "research-corrected", width, lang, otherCard);
      await other.close();
    });
  }

  test.afterAll(() => {
    const root = path.resolve(__dirname, "../..");
    const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    const lines = [
      `capturedAtHead: ${head}`,
      `command: "OPTIONS_R1_CROPS=1 npx playwright test e2e/options-r1-w2-crops.spec.ts --project=desktop --workers=1"`,
      `theme: Terminal, Options and Saved research routes are dark-only; the Discover rotation workspace and company comparison are captured in both sectorTheme=dark and sectorTheme=light.`,
      `sources: synthetic (e2e/helpers/optionsR1Journey.ts, e2e/helpers/optionsR1Research.ts, e2e/fixtures/sector-company-v3.ts, lib/__tests__/fixtures/sector-rotation-relative-trend.v1.json, lib/__tests__/fixtures/sector-holdings-coverage.v1.json); not provider evidence.`,
      "layoutFiles:", ...LAYOUT_FILES.flatMap(file => [`  - path: ${file}`, `    sha256: ${sha(file)}`]),
      "crops:", ...crops.flatMap(crop => [`  - file: ${crop.file}`, `    viewport: ${crop.viewport}`, `    lang: ${crop.lang}`, `    state: ${crop.state}`, `    theme: ${crop.theme}`,
        `    sha256: ${createHash("sha256").update(readFileSync(path.join(OUT, crop.file))).digest("hex")}`]),
    ];
    writeFileSync(path.join(OUT, "EVIDENCE.yml"), lines.join("\n") + "\n");
  });
});
