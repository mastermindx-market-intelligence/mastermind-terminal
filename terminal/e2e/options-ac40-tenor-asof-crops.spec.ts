import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import volFixture from "./fixtures/options-r1-w3b-vol.json";
import movesFixture from "./fixtures/options-r1-w3-moves.json";
// AC40 Option B crop packet: regenerates docs/pr-crops/options-ac40-tenor-asof on synthetic
// sources. Opt-in only (OPTIONS_AC40_CROPS=1); the behavioural gate is the vitest suite
// lib/__tests__/volCompareTenorAsofClock.test.tsx — this packet is review evidence, not a gate.
//   OPTIONS_AC40_CROPS=1 npx playwright test e2e/options-ac40-tenor-asof-crops.spec.ts --project=desktop --workers=1
//
// The W3B comparison panel (VolView mount, the same mocks as options-r1-w3-crops) in the three
// AC40 acceptance states, per language and IA viewport:
//   (a) old-read-on-today — the 2026-10-20 read viewed on 2026-10-27, with the read's 7D
//       expiry withheld so 7D is interpolated: the row is dated 27 Oct (asof + 7), equal to
//       the viewer's ET today, and says it is not ahead of today and names the 20 Oct read;
//   (b) today-read        — the same read viewed on its own day: every interpolated date is
//       after today and unlabeled, identical to the viewer-clock output;
//   (c) asof-missing      — the read without `asof`: interpolated rows show no date, and the
//       reason ("clock not stated by source").
// The fixtures are synthetic test data, not market data or a claim about any source.
const OUT = path.resolve(__dirname, "../docs/pr-crops/options-ac40-tenor-asof");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/vol/VolComparePanel.tsx",
  "terminal/components/vol/VolView.tsx",
  "terminal/components/vol/volShared.tsx",
  "terminal/components/vol/volStrings.ts",
  "terminal/lib/volTenorComparison.ts",
];
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 820: { width: 820, height: 1180 }, 390: { width: 390, height: 844 } } as const;
type Width = keyof typeof VIEWPORTS;
type Lang = "en" | "zh";
const crops: { file: string; viewport: string; lang: Lang; state: string; clock: string }[] = [];

// The read without its supplied 7D expiry: 7D is then interpolated between 2D and 10D.
const withoutSeven = { ...volFixture, term: volFixture.term.filter((row) => row.dte !== 7) };
const withoutAsof: Omit<typeof withoutSeven, "asof"> & { asof?: string } = { ...withoutSeven };
delete withoutAsof.asof;

const STATES = {
  "old-read-on-today": { clock: "2026-10-27T15:00:00Z", payload: withoutSeven },
  "today-read": { clock: "2026-10-20T15:00:00Z", payload: withoutSeven },
  "asof-missing": { clock: "2026-10-21T15:00:00Z", payload: withoutAsof },
} as const;
type State = keyof typeof STATES;

const EXPECT: Record<State, Record<Lang, { seven: string; absent?: string }>> = {
  "old-read-on-today": {
    en: { seven: "27 Oct · not ahead of today · from the 20 Oct read" },
    zh: { seven: "10月27日 · 不晚于今日 · 来自10月20日的读数" },
  },
  "today-read": {
    en: { seven: "27 Oct", absent: "not ahead of today" },
    zh: { seven: "10月27日", absent: "不晚于今日" },
  },
  "asof-missing": {
    en: { seven: "— · clock not stated by source" },
    zh: { seven: "— · 来源未说明时钟" },
  },
};

test.describe("Options AC40 tenor-asof crop packet", () => {
  test.skip(!process.env.OPTIONS_AC40_CROPS, "Set OPTIONS_AC40_CROPS=1 to regenerate docs/pr-crops/options-ac40-tenor-asof");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function capture(page: Page, state: State, width: Width, lang: Lang, target: ReturnType<Page["getByTestId"]>) {
    let height: number = VIEWPORTS[width].height;
    await page.setViewportSize(VIEWPORTS[width]);
    await settle(page);
    const file = `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
    // Same convention as options-r1-w3-crops: rest the scroll ancestors at their top and grow
    // the viewport height until the whole panel fits, so the sticky chrome never paints over it.
    let box: { y: number; height: number } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await target.evaluate((el) => {
        for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) if (n.scrollTop > 0) n.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await settle(page);
      box = await target.boundingBox();
      if (!box) throw new Error(`${file}: target has no bounding box`);
      const needed = Math.ceil(box.y + box.height + 72);
      if (needed <= height) break;
      height = Math.min(6000, needed);
      await page.setViewportSize({ width: VIEWPORTS[width].width, height }); await settle(page);
    }
    if (box && box.y + box.height > height) { await target.scrollIntoViewIfNeeded(); await settle(page); }
    await target.screenshot({ path: path.join(OUT, file) });
    crops.push({ file, viewport: `${VIEWPORTS[width].width}x${height}`, lang, state, clock: STATES[state].clock });
  }

  for (const state of Object.keys(STATES) as State[]) {
    for (const lang of ["en", "zh"] as Lang[]) {
      test(`volatility compare panel · ${state} / ${lang}`, async ({ page }) => {
        const { clock, payload } = STATES[state];
        await page.addInitScript((locale) => { localStorage.setItem("mm.lang", locale); }, lang);
        await page.clock.setFixedTime(new Date(clock));
        await page.route("**/api/flow?*", async (route) => {
          const f = new URL(route.request().url()).searchParams.get("f");
          if (f === "vol:AAPL") await route.fulfill({ json: payload });
          else if (f === "moves:AAPL") await route.fulfill({ json: movesFixture });
          else if (f === "agg:AAPL") await route.fulfill({ json: {} });
          else if (f === "vol:SPY") await route.fulfill({ status: 404, json: {} });
          else await route.fallback();
        });
        await page.route("**/data/AAPL.fund.json", route => route.fulfill({
          json: { earnings: { next_date: "2026-10-30", next_period: "Q4 2026" } },
        }));
        await page.goto("/options?tab=volatility");
        const ticker = page.getByRole("combobox", { name: lang === "zh" ? "代码" : "Ticker", exact: true });
        await ticker.fill("AAPL");
        await ticker.press("Enter");
        const panel = page.getByTestId("vol-compare");
        await expect(panel).toBeVisible();
        // The 7D row's expiry cell is the state this crop exists to show.
        const seven = panel.locator("table").first().locator("tbody tr").filter({ has: page.locator("td:first-child", { hasText: /^7D$/ }) });
        await expect(seven.locator("td").nth(1)).toHaveText(EXPECT[state][lang].seven);
        const absent = EXPECT[state][lang].absent;
        if (absent) await expect(panel).not.toContainText(absent);
        for (const width of [1440, 820, 390] as Width[]) await capture(page, state, width, lang, panel);
      });
    }
  }

  test.afterAll(() => {
    const root = path.resolve(__dirname, "../..");
    const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    const lines = [
      `capturedAtHead: ${head}`,
      `command: "OPTIONS_AC40_CROPS=1 npx playwright test e2e/options-ac40-tenor-asof-crops.spec.ts --project=desktop --workers=1"`,
      `theme: Terminal and Options routes are dark-only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).`,
      `sources: synthetic (e2e/fixtures/options-r1-w3b-vol.json less its 7D row, and less asof for asof-missing; e2e/fixtures/options-r1-w3-moves.json; mocked /data/AAPL.fund.json); not provider evidence.`,
      "layoutFiles:", ...LAYOUT_FILES.flatMap(file => [`  - path: ${file}`, `    sha256: ${sha(file)}`]),
      "crops:", ...crops.flatMap(crop => [`  - file: ${crop.file}`, `    viewport: ${crop.viewport}`, `    lang: ${crop.lang}`, `    state: ${crop.state}`,
        `    clock: ${crop.clock}`,
        `    sha256: ${createHash("sha256").update(readFileSync(path.join(OUT, crop.file))).digest("hex")}`]),
    ];
    writeFileSync(path.join(OUT, "EVIDENCE.yml"), lines.join("\n") + "\n");
  });
});
