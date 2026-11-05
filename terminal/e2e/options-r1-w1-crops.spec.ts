import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { exposureMapT } from "../components/exposure-map/exposureMapStrings";
import { reportedGammaBook } from "../lib/__tests__/fixtures/reportedGammaBooks";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";
import { HASH_A, HASH_B, exposureHrefFor, originStrip, prepareSectorJourney, type JourneyLang } from "./helpers/optionsR1Journey";

// Options R1 W1 PR crop packet: regenerates docs/pr-crops/options-r1-w1 on synthetic sources.
// Opt-in only (OPTIONS_R1_CROPS=1); the journey spec, not this packet, is the behavioral gate.
//   OPTIONS_R1_CROPS=1 npx playwright test e2e/options-r1-w1-crops.spec.ts --project=desktop --workers=1
const OUT = path.resolve(__dirname, "../docs/pr-crops/options-r1-w1");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/exposure-map/ExposureOriginStrip.tsx",
  "terminal/components/exposure-map/ExposureChangeInspector.tsx",
  "terminal/components/exposure-map/ExposureChangeInspector.module.css",
  "terminal/components/exposure-map/ExposureChartReference.tsx",
  "terminal/components/exposure-map/ExposureMap.tsx",
  "terminal/components/exposure-map/exposureMapStrings.ts",
  "terminal/components/exposure-map/exposureChangeInspectorStrings.ts",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/options-companion/GexMarketMemory.tsx",
  "terminal/components/sector-intelligence/SectorCompanyComparison.tsx",
  "terminal/components/sector-intelligence/SectorRotationMap.tsx",
  "terminal/components/sector-intelligence/SectorRotationMap.module.css",
  "terminal/lib/exposureChangeInspector.ts",
  "terminal/lib/exposureOrigin.ts",
  "terminal/lib/rotationEligibility.ts",
];
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 820: { width: 820, height: 1180 }, 390: { width: 390, height: 844 } } as const;
type Width = keyof typeof VIEWPORTS;
const LANGS: JourneyLang[] = ["en", "zh"];
const crops: { file: string; viewport: string; lang: JourneyLang; state: string; theme: "dark" | "light" }[] = [];

test.describe("Options R1 W1 crop packet", () => {
  test.skip(!process.env.OPTIONS_R1_CROPS, "Set OPTIONS_R1_CROPS=1 to regenerate docs/pr-crops/options-r1-w1");
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
      // Options and Discover scroll inside the app shell at tablet and desktop widths, so an element
      // taller than the contract viewport would be clipped: grow the height until the whole element fits.
      for (let attempt = 0; attempt < 4; attempt++) {
        await target.scrollIntoViewIfNeeded(); await settle(page);
        const box = await target.boundingBox();
        if (!box) throw new Error(`${file}: target has no bounding box`);
        const needed = Math.ceil(box.y + box.height + 72); // clears the fixed page footer
        if (needed <= height) break;
        height = Math.min(6000, needed);
        await page.setViewportSize({ width: VIEWPORTS[width].width, height }); await settle(page);
      }
      await target.screenshot({ path: path.join(OUT, file) });
    } else await page.screenshot({ path: path.join(OUT, file) });
    crops.push({ file, viewport: `${VIEWPORTS[width].width}x${height}`, lang, state, theme });
  }
  const chartReady = (page: Page) => expect(page.getByTestId("exposure-map")).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });

  for (const lang of LANGS) {
    test(`origin exact / ${lang}`, async ({ page }) => {
      await prepareSectorJourney(page, { lang });
      const { href } = await exposureHrefFor(page, "MU");
      await page.goto(href);
      await expect(originStrip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
      await chartReady(page);
      for (const width of [1440, 820, 390] as Width[]) { await originStrip(page).scrollIntoViewIfNeeded(); await capture(page, "origin-exact", width, lang); }
    });
    test(`origin changed / ${lang}`, async ({ page }) => {
      let hash = HASH_A;
      await prepareSectorJourney(page, { lang, hash: () => hash });
      const { href } = await exposureHrefFor(page, "MU");
      hash = HASH_B;
      await page.goto(href);
      await expect(originStrip(page)).toHaveAttribute("data-state", "changed", { timeout: 30_000 });
      await chartReady(page);
      for (const width of [1440, 390] as Width[]) { await originStrip(page).scrollIntoViewIfNeeded(); await capture(page, "origin-changed", width, lang); }
    });
    test(`origin with an absent options source / ${lang}`, async ({ page }) => {
      await prepareSectorJourney(page, { lang, absent: ["ADI"] });
      const { href } = await exposureHrefFor(page, "ADI");
      await page.goto(href);
      await expect(originStrip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
      await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-session", "");
      for (const width of [1440, 390] as Width[]) { await originStrip(page).scrollIntoViewIfNeeded(); await capture(page, "origin-absent", width, lang); }
    });
    test(`chart reference / ${lang}`, async ({ page }) => {
      const t = exposureMapT(lang);
      await prepareSectorJourney(page, { lang });
      const { href } = await exposureHrefFor(page, "MU");
      await page.goto(href);
      await chartReady(page);
      await expect(originStrip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
      await page.getByTestId("exposure-map").getByRole("button", { name: new RegExp(t("largestNet")) }).click();
      await page.getByTestId("exposure-node-inspector").getByRole("button", { name: t("openOnMainChart"), exact: true }).click();
      await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
      const reference = page.getByTestId("exposure-chart-reference");
      await expect(reference).toBeVisible({ timeout: 30_000 });
      await expect(reference.getByTestId("exposure-reference-sector")).toHaveAttribute("href", /sectorCompany=MU/);
      for (const width of [1440, 820, 390] as Width[]) { await reference.scrollIntoViewIfNeeded(); await capture(page, "chart-reference", width, lang); }
    });
    test(`matched reported change inspector / ${lang}`, async ({ page }) => {
      const t = exposureMapT(lang);
      const current = reportedGammaBook("2026-10-19"), previous = reportedGammaBook("2026-10-16", 2);
      await prepareSectorJourney(page, { lang, spots: { SPY: current.spot_ref } });
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", route => route.fulfill({ json: current }));
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY", route => route.fulfill({ json: { root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" } }));
      await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-16", route => route.fulfill({ json: previous }));
      await page.goto("/options?tab=prism&symbol=SPY&view=chart");
      await chartReady(page);
      const map = page.getByTestId("exposure-map");
      await map.getByRole("button", { name: t("changes"), exact: true }).click();
      const memory = map.getByTestId("options-market-memory");
      await expect(memory.getByTestId("options-memory-reported-change")).toBeVisible({ timeout: 30_000 });
      await expect(memory.getByTestId("exposure-change-inspector")).toBeVisible();
      for (const width of [1440, 820, 390] as Width[]) await capture(page, "change-inspector", width, lang, memory);
    });
    for (const theme of ["dark", "light"] as const) {
      test(`rotation map with boundary and unavailable placements / ${lang} / ${theme}`, async ({ page }) => {
        const sectorRow = (id: string, ticker: string, name: string, nameZh: string, rs21: number, rs63: number | null) => ({
          id, ticker, name, name_zh: nameZh, accent: "#38bdf8",
          momentum: { rs_21d: rs21, ...(rs63 === null ? {} : { rs_63d: rs63 }), above_200d: rs21 > 0 },
          heat: { heat_1M: rs21, breadth_pct: 50 + rs21 * 3, adv: 20 + Math.max(0, rs21), dec: 20 - Math.min(0, rs21) }, rotation: {},
        });
        const sector = { as_of: "2026-10-07", sectors: [
          sectorRow("xlk", "XLK", "Technology", "科技", 3, 6), sectorRow("xlf", "XLF", "Financials", "金融", 1.5, 2.5),
          sectorRow("xle", "XLE", "Energy", "能源", 2, -3), sectorRow("xlv", "XLV", "Health Care", "医疗保健", -1.5, 2),
          sectorRow("xli", "XLI", "Industrials", "工业", -2, -4), sectorRow("xlp", "XLP", "Consumer Staples", "必需消费", 1, 0),
          sectorRow("xlu", "XLU", "Utilities", "公用事业", -2, null),
        ] };
        await page.addInitScript(({ lang, now }) => {
          localStorage.setItem("mm.lang", lang);
          document.documentElement?.setAttribute("data-lang", lang);
          Date.now = () => now;
        }, { lang, now: MARKET_RISK_NOW });
        const envelope = riskEnvelopeFixture();
        await page.route("**/api/sector-intelligence?**", route => {
          const source = new URL(route.request().url()).searchParams.get("source")!;
          const data = source === "sector" ? sector : source === "risk" ? envelope : null;
          return route.fulfill({ status: data ? 200 : 404, json: { data, receipt: { source, status: data ? "ready" : "unavailable",
            path: source === "risk" ? "/riskdata/risk_envelope.json" : "/sectordata/sector_central.json",
            asOf: "2026-10-07", observedAt: "2026-10-08T12:00:00Z", stale: false, contentHash: "synthetic-fixture" } } });
        });
        const source = marketRiskSourceFixture();
        await page.route("**/data/market_risk.json", route => route.fulfill({ json: { ...source, schema: "market_risk/v1", risk_envelope: envelope } }));
        await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}`);
        const rotation = page.getByTestId("sector-rotation");
        await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(6);
        await expect(rotation.getByTestId("rotation-unplaced")).toBeVisible();
        await expect(rotation.getByTestId("rotation-unplaced")).toContainText("XLU");
        await expect(rotation.getByTestId("rotation-unplaced")).toContainText("XLP");
        for (const width of [1440, 820, 390] as Width[]) await capture(page, "rotation-map", width, lang, rotation, theme);
      });
    }
  }

  test.afterAll(() => {
    const root = path.resolve(__dirname, "../..");
    const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    const lines = [
      `capturedAtHead: ${head}`,
      `command: "OPTIONS_R1_CROPS=1 npx playwright test e2e/options-r1-w1-crops.spec.ts --project=desktop --workers=1"`,
      `theme: Terminal and Options routes are dark-only; the Discover rotation workspace is captured in both sectorTheme=dark and sectorTheme=light.`,
      `sources: synthetic (e2e/helpers/optionsR1Journey.ts, lib/__tests__/fixtures/reportedGammaBooks.ts, lib/__tests__/marketRiskFixture.ts); not provider evidence.`,
      "layoutFiles:", ...LAYOUT_FILES.flatMap(file => [`  - path: ${file}`, `    sha256: ${sha(file)}`]),
      "crops:", ...crops.flatMap(crop => [`  - file: ${crop.file}`, `    viewport: ${crop.viewport}`, `    lang: ${crop.lang}`, `    state: ${crop.state}`, `    theme: ${crop.theme}`,
        `    sha256: ${createHash("sha256").update(readFileSync(path.join(OUT, crop.file))).digest("hex")}`]),
    ];
    writeFileSync(path.join(OUT, "EVIDENCE.yml"), lines.join("\n") + "\n");
  });
});
