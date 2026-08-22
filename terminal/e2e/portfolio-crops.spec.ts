import { expect, test, type Page, type TestInfo } from "./fixtures";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

// W5 visual-evidence generator — the crops committed under `docs/pr-crops/wp-w5-portfolio/`.
//
// OPT-IN. It writes into the repo, so it must never run as part of `test:e2e:responsive`:
//
//   rm -rf .next && TERMINAL_E2E_PORT=3190 TERMINAL_CROPS=1 \
//     npx playwright test e2e/portfolio-crops.spec.ts --project=desktop --project=tablet --project=mobile
//
// Kept in the repo rather than thrown away so the next wave can regenerate the same shots from the
// same states instead of hand-composing new ones. Everything below is real fixture data written
// through `POST /api/portfolio`, and every interaction is browser-driven.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "wp-w5-portfolio");
mkdirSync(OUT, { recursive: true });

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2 },
    AAPL: { name: "Apple", zh: "苹果", col: "#8e8e93", last: 228.1, chg: -0.4 },
    GLD: { name: "SPDR Gold Shares", zh: "SPDR黄金ETF", col: "#e8b339", last: 318.4, chg: 0.6 },
    TLT: { name: "iShares 20+ Treasury", zh: "20年期以上美债ETF", col: "#4d82ff", last: 89.2, chg: -0.3 },
    // Not held and not watched — the realistic subject for the "Add to…" crop, and the search hub
    // can only find what the manifest carries.
    AMD: { name: "Advanced Micro Devices", zh: "超威半导体", col: "#ed1c24", last: 168.9, chg: 1.8 },
  },
};
const QUOTES = {
  quotes: {
    NVDA: { last: 180.2, chg: 2.5 },
    AAPL: { last: 231.4, chg: -0.9 },
    GLD: { last: 320.1, chg: 0.7 },
  },
};
const BRIEF = {
  schema: "portfolio_brief.v1",
  asof: "2026-08-12",
  generated_at: "2026-08-12T06:37:00Z",
  stale: false,
  weighting: { mode: "cost_basis", label_en: "by cost basis", label_zh: "按成本权重" },
  book: { n: 4, covered: 4, uncovered: [] },
  headline: {
    en: "Semis carry your book; gold and duration are the ballast.",
    zh: "半导体是账本的主体，黄金与久期是压舱物。",
  },
  sections: [{
    key: "exposure",
    title_en: "Exposure",
    title_zh: "敞口",
    lines: [{
      en: "Two technology names are the largest single block you hold.",
      zh: "两只科技股是你持仓中最大的单一板块。",
    }],
  }],
};

const shot = (page: Page, name: string, testInfo: TestInfo) =>
  page.screenshot({ path: join(OUT, `${name}-${testInfo.project.name}.png`), fullPage: false });

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("data-lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) => route.fulfill({ json: BRIEF }));
}

async function seedBook(page: Page) {
  const rows = [
    { ticker: "NVDA", shares: "120", entryPrice: "138.40", entryDate: "2026-01-05", notes: "core semis" },
    { ticker: "AAPL", shares: "60", entryPrice: "244.10", entryDate: "2026-03-18" },
    { ticker: "GLD", shares: "40", entryPrice: "296.00", entryDate: "2025-11-02" },
    { ticker: "TLT", shares: "150", entryPrice: "94.30", entryDate: "2026-02-11" },
  ];
  for (const row of rows) {
    const response = await page.request.post("/api/portfolio", { data: { action: "create", ...row } });
    expect(response.ok()).toBe(true);
  }
}

test("crop — populated book, EN and ZH", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedBook(page);
  await page.goto("/portfolio");
  await expect(page.getByTestId("portfolio-open").locator("tr[data-ticker]")).toHaveCount(4);
  await expect(page.getByTestId("brief-population")).toBeVisible({ timeout: 20_000 });
  // Let the first quote poll land so the crop shows LIVE values, not the manifest's.
  await expect.poll(async () => page.locator("tr[data-ticker='NVDA'] td").nth(4).innerText())
    .toContain("180.20");
  await shot(page, "positions-en", testInfo);
});

test("crop — populated book in Chinese", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, true);
  await seedBook(page);
  await page.goto("/portfolio");
  await expect(page.getByTestId("portfolio-open").locator("tr[data-ticker]")).toHaveCount(4);
  await expect(page.locator(".pg-head h2")).toHaveText("投资组合");
  await shot(page, "positions-zh", testInfo);
});

test("crop — empty book and the add-position modal", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.goto("/portfolio");
  await expect(page.locator(".pf-empty")).toBeVisible();
  await shot(page, "empty", testInfo);

  await page.locator(".pf-empty .pf-add-btn").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.locator("input[name='ticker']").fill("NVDA");
  await modal.locator("input[name='shares']").fill("120");
  await modal.locator("input[name='entryPrice']").fill("138.40");
  await shot(page, "add-modal", testInfo);
});

test("crop — closed section, and a position with no size", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedBook(page);
  await page.request.post("/api/portfolio", { data: { action: "create", ticker: "RKLB" } });
  await page.goto("/portfolio");
  await page.locator("tr[data-ticker='TLT']").getByRole("button", { name: /^Close TLT$/ }).click();
  await expect(page.getByTestId("portfolio-closed")).toBeVisible();
  await page.getByTestId("portfolio-closed").locator("summary").click();
  await expect(page.locator(".pf-closed tr[data-ticker='TLT']")).toBeVisible();
  await shot(page, "closed-and-unsized", testInfo);
});

test("crop — P&L coverage when a position carries no entry price", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.request.post("/api/portfolio", { data: { action: "create", ticker: "NVDA", shares: "120", entryPrice: "138.40", entryDate: "2026-01-05" } });
  // Held and sized, but the entry price was never recorded — it has a market value and no knowable
  // P&L. Round-2 review: its market value used to be booked as profit, and nothing said so.
  await page.request.post("/api/portfolio", { data: { action: "create", ticker: "GLD", shares: "40" } });
  await page.goto("/portfolio");
  await expect(page.getByTestId("portfolio-coverage-nobasis")).toBeVisible({ timeout: 20_000 });
  await shot(page, "pnl-coverage", testInfo);
});

test("crop — the Add-to split and the rail source toggle", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The picker is a pointer affordance and the rail is desktop chrome.");
  await prepare(page, testInfo, baseURL);
  await seedBook(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

  // Rail source toggle → the book, read from portfolio_positions and never from mm.wls.
  const tabs = page.getByTestId("rail-source-tabs");
  await expect(tabs).toBeVisible();
  await tabs.getByRole("tab", { name: "Portfolio" }).click();
  await expect(page.locator(".pf-board-row").first()).toBeVisible({ timeout: 20_000 });
  await shot(page, "rail-portfolio", testInfo);

  await tabs.getByRole("tab", { name: "Watchlists" }).click();
  await expect(page.locator(".wl-board:not(.rail-hidden)")).toBeVisible();
  await shot(page, "rail-watchlists", testInfo);

  // "Add to…" — Portfolio above the rule, watchlists below it. The search hub opens from the
  // symbol pill, exactly as `search-add-to-list.spec.ts` drives it.
  await page.locator(".pair").first().click();
  await page.locator(".sh input").click();
  await page.keyboard.type("AMD");
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".sres .r .add").first().click();
  await expect(page.getByTestId("add-to-portfolio")).toBeVisible();
  await shot(page, "add-to-split", testInfo);

  // The picker is a small popover in a busy workspace, so the full-viewport shot cannot show
  // whether the split actually READS. Crop tight to it, and prove it is the topmost element at its
  // own centre rather than something drawn under the search scrim.
  const picker = page.locator(".s-pick");
  const box = await picker.boundingBox();
  expect(box).not.toBeNull();
  const topmost = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".s-pick")!;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return !!hit?.closest(".s-pick");
  });
  expect(topmost).toBe(true);
  await page.screenshot({
    path: join(OUT, `add-to-split-closeup-${testInfo.project.name}.png`),
    clip: { x: box!.x - 10, y: box!.y - 10, width: box!.width + 20, height: box!.height + 20 },
  });
});
