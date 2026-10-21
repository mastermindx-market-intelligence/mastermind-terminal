import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import flowFixture from "./fixtures/options-r1-w3a-flow.json";
import volFixture from "./fixtures/options-r1-w3b-vol.json";
import movesFixture from "./fixtures/options-r1-w3-moves.json";

// Options R1 W3 PR crop packet: regenerates docs/pr-crops/options-r1-w3 on synthetic
// sources. Opt-in only (OPTIONS_R1_CROPS=1); the behavioural gates stay the W3A/W3B
// journey specs plus the W3S vitest suites — this packet is review evidence, not a gate.
//   OPTIONS_R1_CROPS=1 npx playwright test e2e/options-r1-w3-crops.spec.ts --project=desktop --workers=1
//
// Three views per language and viewport:
//   (a) flow-desk-inspector — the W3A desk with the print inspector open on fixture
//       event e1 (the same mocks as e2e/options-r1-w3a-flow-inspector.spec.ts);
//   (b) vol-compare-band   — the W3B comparison panel with the W3S wiring live: a
//       mocked `moves:AAPL` payload renders the published band, and a mocked
//       `/data/AAPL.fund.json` renders the earnings event row;
//   (c) eod-expmove-method — the EOD belt's expMove cell carrying the W3S method line.
// The fixtures are synthetic test data, not market data or a claim about any source.
const OUT = path.resolve(__dirname, "../docs/pr-crops/options-r1-w3");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/app/observatory.css",
  // W3A (flow print inspector)
  "terminal/components/flowdesk/FeedPane.tsx",
  "terminal/components/flowdesk/FlowCard.tsx",
  "terminal/components/flowdesk/FlowDeskView.tsx",
  "terminal/components/flowdesk/PrintInspector.tsx",
  "terminal/lib/flowPrintInspector.ts",
  // W3B (constant-tenor comparison)
  "terminal/components/vol/VolComparePanel.tsx",
  "terminal/components/vol/volStrings.ts",
  "terminal/lib/volTenorComparison.ts",
  // W3S wiring and the belt/legend surfaces it touched
  "terminal/components/ChartPanel.tsx",
  "terminal/components/eodcontext/StructureStrip.tsx",
  "terminal/components/eodcontext/eodStrings.ts",
  "terminal/components/vol/VolView.tsx",
  "terminal/lib/eodContext.ts",
  "terminal/lib/i18n.tsx",
  "terminal/lib/optionsLevels.ts",
];
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 820: { width: 820, height: 1180 }, 390: { width: 390, height: 844 } } as const;
type Width = keyof typeof VIEWPORTS;
type Lang = "en" | "zh";
const crops: { file: string; viewport: string; lang: Lang; state: string }[] = [];

test.describe("Options R1 W3 crop packet", () => {
  test.skip(!process.env.OPTIONS_R1_CROPS, "Set OPTIONS_R1_CROPS=1 to regenerate docs/pr-crops/options-r1-w3");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function capture(page: Page, state: string, width: Width, lang: Lang, target?: ReturnType<Page["getByTestId"]>) {
    let height: number = VIEWPORTS[width].height;
    await page.setViewportSize(VIEWPORTS[width]);
    await settle(page);
    const file = `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
    if (target) {
      // The options shell scrolls inside the app at tablet/desktop widths, so a target
      // taller than the contract viewport is clipped: grow the height until it fits.
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
    crops.push({ file, viewport: `${VIEWPORTS[width].width}x${height}`, lang, state });
  }

  for (const lang of ["en", "zh"] as Lang[]) {
    test(`flow desk with the print inspector open on e1 / ${lang}`, async ({ page }) => {
      const feed = (flowFixture as { feed: unknown }).feed;
      await page.addInitScript((locale) => {
        localStorage.setItem("mm.lang", locale);
        localStorage.setItem("flowdesk.tutorial.seen", "1");
      }, lang);
      await page.route(/\/api\/flow(?:\/stream)?\?/, (route) => {
        const url = route.request().url();
        if (url.includes("/stream")) {
          return route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(feed)}\n\n` });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feed) });
      });
      await page.goto("/options?tab=desk");
      await expect(page.locator('[data-testid="flow-coverage"]')).toBeVisible();
      await page.locator('[data-tut="flow-card"]', { hasText: "$504.0K" }).click();
      const inspector = page.locator('[data-testid="flow-print-inspector"]');
      await expect(inspector).toBeVisible();
      for (const width of [1440, 820, 390] as Width[]) await capture(page, "flow-desk-inspector", width, lang, inspector);
    });

    test(`volatility compare panel with the published band wired / ${lang}`, async ({ page }) => {
      await page.addInitScript((locale) => { localStorage.setItem("mm.lang", locale); }, lang);
      // Freeze the clock at the W3B fixture's read day + 1 (2026-10-21) so tenor labels
      // and horizons stay deterministic at every viewport.
      await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
      await page.route("**/api/flow?*", async (route) => {
        const f = new URL(route.request().url()).searchParams.get("f");
        if (f === "vol:AAPL") await route.fulfill({ json: volFixture });
        else if (f === "moves:AAPL") await route.fulfill({ json: movesFixture });
        else if (f === "agg:AAPL") await route.fulfill({ json: {} });
        else if (f === "vol:SPY") await route.fulfill({ status: 404, json: {} });
        else await route.fallback();
      });
      // The earnings day VolView reads for the panel's event window.
      await page.route("**/data/AAPL.fund.json", route => route.fulfill({
        json: { earnings: { next_date: "2026-10-30", next_period: "Q4 2026" } },
      }));
      await page.goto("/options?tab=volatility");
      const ticker = page.getByRole("textbox", { name: lang === "zh" ? "代码" : "Ticker", exact: true });
      await ticker.fill("AAPL");
      await ticker.press("Enter");
      const panel = page.getByTestId("vol-compare");
      await expect(panel).toBeVisible();
      // The W3S wiring is what this crop exists to show: the producer's band column,
      // its clock, and the earnings event row.
      await expect(panel).toContainText(lang === "zh" ? "来源发布的单日区间" : "Published one-day band");
      await expect(panel.getByTestId("vol-compare-move")).toContainText("±4.55 %");
      await expect(panel.getByTestId("vol-compare-events")).toContainText(lang === "zh" ? "财报" : "AAPL earnings");
      for (const width of [1440, 820, 390] as Width[]) await capture(page, "vol-compare-band", width, lang, panel);
    });

    test(`eod belt expMove cell with the band method line / ${lang}`, async ({ page }) => {
      await page.addInitScript((locale) => { localStorage.setItem("mm.lang", locale); }, lang);
      await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z"));
      await page.route("**/api/flow?*", async (route) => {
        const f = new URL(route.request().url()).searchParams.get("f") ?? "";
        if (f === "moves:SPY") await route.fulfill({ json: { ...movesFixture, root: "SPY", spot_ref: 672.78 } });
        else if (f === "vol:SPY") await route.fulfill({ json: { ...volFixture, root: "SPY" } });
        else if (f === "gex:SPY") {
          await route.fulfill({ json: {
            schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-20", spot_ref: 672.78,
            net_gex_bn: 1.2, gamma_flip: 668.5, call_wall: 690, put_wall: 650,
            by_strike: [], by_expiry: [], convention: "per +1% spot move",
          } });
        } else await route.fallback();
      });
      await page.goto("/options?tab=gex&symbol=SPY");
      const cell = page.getByTestId("eod-cell-expMove");
      await expect(cell).toBeVisible({ timeout: 30_000 });
      // The method line is the W3S subject of this crop; it must be visible text.
      await expect(cell).toContainText(lang === "zh" ? "来源未说明方法" : "method not stated by source");
      for (const width of [1440, 820, 390] as Width[]) await capture(page, "eod-expmove-method", width, lang, cell);
    });
  }

  test.afterAll(() => {
    const root = path.resolve(__dirname, "../..");
    const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    const lines = [
      `capturedAtHead: ${head}`,
      `command: "OPTIONS_R1_CROPS=1 npx playwright test e2e/options-r1-w3-crops.spec.ts --project=desktop --workers=1"`,
      `theme: Terminal and Options routes are dark-only.`,
      `sources: synthetic (e2e/fixtures/options-r1-w3a-flow.json, e2e/fixtures/options-r1-w3b-vol.json, e2e/fixtures/options-r1-w3-moves.json, mocked /data/AAPL.fund.json); not provider evidence.`,
      "layoutFiles:", ...LAYOUT_FILES.flatMap(file => [`  - path: ${file}`, `    sha256: ${sha(file)}`]),
      "crops:", ...crops.flatMap(crop => [`  - file: ${crop.file}`, `    viewport: ${crop.viewport}`, `    lang: ${crop.lang}`, `    state: ${crop.state}`,
        `    sha256: ${createHash("sha256").update(readFileSync(path.join(OUT, crop.file))).digest("hex")}`]),
    ];
    writeFileSync(path.join(OUT, "EVIDENCE.yml"), lines.join("\n") + "\n");
  });
});
