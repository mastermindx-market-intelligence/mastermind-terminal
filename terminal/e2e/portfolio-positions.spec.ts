import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { expectTapTarget } from "./tapTarget";
import { holdings, inspectRecord, editRecord, editor, closeInspector, discardEditor, coverage } from "./portfolioWorkspaceHelpers";

// W5 — `/portfolio` is the user's REAL portfolio (`portfolio_positions`).
//
// It replaces `portfolio-watchlists-responsive.spec.ts`, whose whole subject was the watchlist
// switcher this wave removed. What that spec proved about the viewport contract is re-proved here
// against the surface that actually ships.
//
// Every position below is created through the REAL route (`POST /api/portfolio` → lib/portfolio.ts
// → the fixture transport), and the page reads the SAME store server-side, so nothing here is a
// staged DOM: what the spec writes is what the product renders.
//
// Isolation: the fixture store is process-global and the matrix is fullyParallel across three
// viewport projects, so every test takes its own account-shaped world via `isolateWatchlistStore`
// (per-run nonce + repeatEachIndex + retry — W1b's F9 fix).

// Two multi-mount tests plus modal round-trips; the 30s default is a per-test budget, and the
// config's 120_000 is the webServer START timeout, not this one (W1b residual (b)).
test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2, currency: "USD" },
    AAPL: { name: "Apple", zh: "苹果", col: "#8e8e93", last: 228.1, chg: -0.4, currency: "USD" },
    MSFT: { name: "Microsoft", zh: "微软", col: "#00a4ef", last: 511.8, chg: 0.7, currency: "USD" },
  },
};

// Mathematical controls use explicitly recorded fictional USD units.
// NVDA quotes live (and differs from the manifest, so the test can tell which one won). AAPL has
// no live quote and falls back to the manifest. `ZZUNKNOWN` is in NEITHER — it must render dashes.
const QUOTES = { quotes: { NVDA: { last: 180, chg: 2.5, currency: "USD" } } };

const BRIEF = {
  schema: "portfolio_brief.v1",
  asof: "2026-08-12",
  generated_at: "2026-08-12T06:37:00Z",
  stale: false,
  weighting: { mode: "cost_basis", label_en: "by cost basis", label_zh: "按成本权重" },
  book: { n: 2, covered: 2, uncovered: [] },
  headline: { en: "Your book is concentrated in semis.", zh: "你的账本集中在半导体。" },
  sections: [{
    key: "exposure",
    title_en: "Exposure",
    title_zh: "敞口",
    lines: [{ en: "Two names carry the book.", zh: "两只标的构成账本主体。" }],
  }],
};

type Draft = { ticker: string; shares?: string; entryPrice?: string; entryCurrency?: string; entryDate?: string; notes?: string };

/** Create a position through the product's own route, as the signed-in fixture user. */
async function seedPosition(page: Page, draft: Draft) {
  const response = await page.request.post("/api/portfolio", { data: { action: "create", entryCurrency: "USD", ...draft } });
  expect(response.ok(), `seeding ${draft.ticker} failed: ${response.status()}`).toBe(true);
  return (await response.json()).position as { id: string; ticker: string };
}

async function readBook(page: Page) {
  const response = await page.request.get("/api/portfolio");
  expect(response.ok()).toBe(true);
  return (await response.json()).positions as { id: string; ticker: string; status: string; shares: number | null }[];
}

async function readWatchlists(page: Page) {
  const response = await page.request.get("/api/watchlist");
  expect(response.ok()).toBe(true);
  return (await response.json()).lists as { name: string; symbols: { symbol: string }[] }[];
}

/** Routes + language, installed before any navigation. */
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, opts: { zh?: boolean; brief?: boolean } = {}) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    const setDocumentLanguage = () => {
      const root = document.documentElement;
      if (!root) return;
      root.setAttribute("data-lang", useZh ? "zh" : "en");
      root.setAttribute("lang", useZh ? "zh-CN" : "en");
    };
    if (document.documentElement) setDocumentLanguage();
    else document.addEventListener("DOMContentLoaded", setDocumentLanguage, { once: true });
  }, !!opts.zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) => (opts.brief
    ? route.fulfill({ json: BRIEF })
    : route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ tier: "free" }) })));
}

async function setMutationNoop(page: Page, on: boolean, baseURL: string | undefined) {
  await page.context().addCookies([{
    name: "mm_e2e_fault",
    value: on ? "positions_mutation_noop" : "",
    url: baseURL ?? "http://127.0.0.1:3108",
  }]);
}

// The OPEN table specifically. `.panel .pf-table` alone also matches the closed section's
// table, so a row that merely MOVED between the two would read as if nothing happened.
const table = (page: Page) => page.getByTestId("portfolio-open").locator(".pf-table tbody");
const row = (page: Page, ticker: string) => page.getByTestId("portfolio-open").locator(`.pf-table tbody tr[data-ticker='${ticker}']`);


test("/portfolio renders positions only — no watchlist rows, no watchlist switcher, no Conviction Book", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "10", entryPrice: "150" });
  await seedPosition(page, { ticker: "AAPL", shares: "4", entryPrice: "240" });
  await page.goto("/portfolio"); await holdings(page);
  await expect(table(page).locator("tr[data-ticker]")).toHaveCount(2);
  await expect(table(page).locator(".pf-tk")).toHaveText(["NVDA", "AAPL"]);
  const watched = (await readWatchlists(page)).flatMap(list => list.symbols.map(s => s.symbol));
  expect(watched).toContain("MSFT"); expect(watched.length).toBeGreaterThanOrEqual(6);
  for (const symbol of watched.filter(symbol => !["NVDA", "AAPL"].includes(symbol))) {
    await expect(table(page).locator(`tr[data-ticker='${symbol}']`)).toHaveCount(0);
  }
  await expect(page.locator(".portfolio-wl-switch, .portfolio-wl-tabs, .portfolio-wl-pill")).toHaveCount(0);
  await expect(page.locator("[data-portfolio] [role=tab]")).toHaveCount(4);
  const text = await page.locator("[data-portfolio]").innerText();
  expect(text.toLowerCase()).not.toContain("conviction"); expect(text).not.toContain("Suggested tilt");
});

test("live values come from the quote hub, and an unresolved symbol dashes instead of guessing", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "10", entryPrice: "150" });
  await seedPosition(page, { ticker: "AAPL", shares: "2", entryPrice: "200" });
  await seedPosition(page, { ticker: "ZZUNKNOWN", shares: "5", entryPrice: "10" });
  await page.goto("/portfolio"); await holdings(page);
  const nvda = row(page, "NVDA").locator("td");
  await expect(nvda.nth(3)).toHaveText("180.00USD", { timeout: 20_000 });
  await expect(nvda.nth(4)).toHaveText("USD 1,800.00");
  await expect(nvda.nth(5)).toHaveText("+20.00%");
  await expect(row(page, "AAPL").locator("td").nth(3)).toHaveText("228.10USD");
  for (const index of [3, 4, 5]) await expect(row(page, "ZZUNKNOWN").locator("td").nth(index)).toHaveText("—");
  const detail = await coverage(page);
  await expect(detail).toContainText("2/3"); await expect(detail).toContainText("ZZUNKNOWN");
});

test("an unsized position is a labelled state, not a broken row", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL); await seedPosition(page, { ticker: "NVDA" });
  await page.goto("/portfolio"); await holdings(page);
  await expect(row(page, "NVDA").locator("td").nth(1).locator("small")).toBeVisible();
  await expect(row(page, "NVDA").locator("td").nth(4)).toHaveText("—");
  await expect(page.getByTestId("portfolio-market-value").locator("strong")).toHaveText("—");
});

test("a position with no entry price is kept out of P&L and NAMED, not folded into profit", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "150" });
  await seedPosition(page, { ticker: "AAPL", shares: "100" });
  await page.goto("/portfolio");
  await expect(page.getByTestId("portfolio-market-value").locator("strong")).toHaveText("USD 40,810.00", { timeout: 20_000 });
  await expect(page.getByTestId("portfolio-since-entry")).toContainText("+3,000.00");
  await expect(page.getByTestId("portfolio-since-entry")).toContainText("+20.00%");
  await coverage(page);
  const noBasis = page.getByTestId("portfolio-coverage-nobasis");
  await expect(noBasis).toBeVisible(); await expect(noBasis).toContainText("1/2"); await expect(noBasis).toContainText("AAPL");
});

test("add · edit · close · reopen · delete preserve the record and never change the watchlist", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL); await page.goto("/portfolio");
  const watchlistBefore = await readWatchlists(page);
  await expect(page.getByTestId("portfolio-empty")).toBeVisible();
  await page.getByRole("button", { name: "Add position", exact: true }).first().click();
  const modal = editor(page);
  await modal.locator("input[name='ticker']").fill("nvda");
  await modal.locator("input[name='shares']").fill("10");
  await modal.locator("input[name='entryPrice']").fill("150");
  await modal.locator("input[name='entryCurrency']").fill("USD");
  await modal.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await holdings(page); await expect(row(page, "NVDA")).toBeVisible();
  expect(await readWatchlists(page)).toEqual(watchlistBefore);
  const id = (await readBook(page))[0].id;
  const edit = await editRecord(page, "NVDA");
  await edit.locator("input[name='shares']").fill("25");
  await edit.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(edit).not.toBeVisible(); await closeInspector(page);
  await expect(row(page, "NVDA").locator("td").nth(1)).toHaveText("25");
  await expect(row(page, "NVDA").locator("td").nth(2)).toHaveText("150.00USD");
  await page.request.post("/api/watchlist", { data: { action: "add", symbols: ["NVDA"], section: "Equities" } });
  let inspector = await inspectRecord(page, "NVDA");
  await inspector.getByRole("button", { name: "Close NVDA", exact: true }).click();
  await expect.poll(async () => (await readBook(page)).find(p => p.id === id)?.status).toBe("closed");
  await expect(inspector.getByRole("button", { name: "Reopen NVDA", exact: true })).toBeEnabled();
  await closeInspector(page); await holdings(page, "closed");
  await expect(page.getByTestId("portfolio-closed").locator(`tr[data-position-id="${id}"]`)).toHaveAttribute("data-status", "closed");
  expect((await readWatchlists(page)).flatMap(l => l.symbols.map(s => s.symbol))).toContain("NVDA");
  inspector = await inspectRecord(page, "NVDA", "closed");
  await inspector.getByRole("button", { name: "Reopen NVDA", exact: true }).click();
  await expect.poll(async () => (await readBook(page)).find(p => p.id === id)?.status).toBe("open");
  await expect(inspector.getByRole("button", { name: "Close NVDA", exact: true })).toBeEnabled();
  await closeInspector(page);
  inspector = await inspectRecord(page, "NVDA");
  await inspector.getByRole("button", { name: "Delete NVDA", exact: true }).click();
  await inspector.getByRole("group").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(inspector).not.toBeVisible();
  expect(await readBook(page)).toEqual([]);
  expect((await readWatchlists(page)).flatMap(l => l.symbols.map(s => s.symbol))).toContain("NVDA");
  await seedPosition(page, { ticker: "AAPL", shares: "3" }); const before = await readBook(page);
  await page.request.post("/api/watchlist", { data: { action: "add", symbols: ["TSLA"], section: "Equities" } });
  expect(await readBook(page)).toEqual(before);
});

test("success-shaped zero-row mutations stay visibly failed and never reduce the authoritative book", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "10", entryPrice: "150", notes: "core" });
  const canonical = await readBook(page), watchlists = await readWatchlists(page);
  await page.goto("/portfolio"); await setMutationNoop(page, true, baseURL);
  const modal = await editRecord(page, "NVDA");
  await modal.locator("input[name='shares']").fill("25");
  await modal.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("couldn't confirm");
  expect(await readBook(page)).toEqual(canonical);
  await discardEditor(page);
  const inspector = page.getByRole("dialog").filter({ has: page.locator("#portfolio-record-title") });
  await inspector.getByRole("button", { name: "Close NVDA", exact: true }).click();
  await expect(inspector.getByRole("alert")).toHaveText("position mutation not confirmed");
  await expect(row(page, "NVDA")).toHaveAttribute("data-status", "open");
  await inspector.getByRole("button", { name: "Delete NVDA", exact: true }).click();
  await inspector.getByRole("group").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(inspector.getByRole("alert")).toHaveText("position mutation not confirmed");
  expect(await readBook(page)).toEqual(canonical); expect(await readWatchlists(page)).toEqual(watchlists);
  await closeInspector(page); await page.reload(); await holdings(page);
  await expect(table(page).locator("tr[data-ticker]")).toHaveCount(1);
});

test("a 2xx receipt with an absent authoritative postcondition is still a visible failure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const seeded = await seedPosition(page, { ticker: "NVDA", shares: "10", entryPrice: "150" });
  await page.goto("/portfolio");
  await page.route("**/api/portfolio", async route => {
    if (route.request().method() === "POST") return route.fulfill({ json: { ok: true, deletedId: seeded.id } });
    return route.continue();
  });
  const inspector = await inspectRecord(page, "NVDA");
  await inspector.getByRole("button", { name: "Delete NVDA", exact: true }).click();
  await inspector.getByRole("group").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(inspector.getByRole("alert")).toContainText("couldn't confirm");
  expect((await readBook(page)).map(position => position.id)).toEqual([seeded.id]);
});

test("the brief states which names it is reading, and flags a population it did not read", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { brief: true });
  await seedPosition(page, { ticker: "NVDA", shares: "10", entryPrice: "150" });
  await seedPosition(page, { ticker: "AAPL", shares: "4", entryPrice: "240" });
  await page.goto("/portfolio");
  await page.locator("summary").filter({ hasText: "From the desk" }).click();
  const disclosure = page.getByTestId("brief-population");
  await expect(disclosure).toBeVisible(); await expect(disclosure).toContainText("2");
  await expect(disclosure.locator(".pbrief-population-gap")).toHaveCount(0);
  await seedPosition(page, { ticker: "MSFT", shares: "1" }); await page.reload();
  await page.locator("summary").filter({ hasText: "From the desk" }).click();
  await expect(disclosure.locator(".pbrief-population-gap")).toBeVisible();
  await expect(disclosure).toContainText("3"); await expect(disclosure.locator(".pbrief-population-gap")).toContainText("2");
});

test("the page holds its shape and exposes reachable record actions at this viewport, in zh", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { zh: true });
  await seedPosition(page, { ticker: "NVDA", shares: "10", entryPrice: "150" });
  await seedPosition(page, { ticker: "ZZUNKNOWN", shares: "5" });
  await page.goto("/portfolio");
  await expect(page.locator("[data-portfolio] h1")).toHaveText("投资组合");
  await expectTapTarget(page.getByRole("button", { name: "添加持仓", exact: true }).first(), { height: 44 });
  await holdings(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(row(page, "NVDA").locator(".pf-tk")).toBeVisible();
  const review = row(page, "NVDA").getByRole("button"); await expectTapTarget(review, { height: 44 });
  await review.click();
  const dialog = page.getByRole("dialog");
  for (const name of [/^编辑 NVDA$/, /^平仓 NVDA$/, /^删除 NVDA$/]) {
    await expectTapTarget(dialog.getByRole("button", { name }), { height: 44 });
  }
});
