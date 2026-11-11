import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { computePortfolioRisk } from "../lib/portfolioRisk";
import type { Position } from "../lib/portfolio";

async function readBook(page: Page) {
  const response = await page.request.get("/api/portfolio?view=positions");
  expect(response.ok()).toBe(true);
  return await response.json() as { positions: Position[]; bookKey: string };
}

// A positive cost and readable security data do not establish entry currency.
// Light checks Portfolio's existing Paper tokens, not a global theme switch.
for (const lang of ["en", "zh"]) for (const theme of ["dark", "light"]) {
  test(`Risk explains unavailable currency weights — ${lang} ${theme}`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
    const symbols = { ZZTA: { name: "Synthetic currency control", last: 110, chg: 10, currency: "USD" } };
    await page.route("**/data/manifest.json", route => route.fulfill({ json: { symbols } }));
    await page.route("**/api/quote**", route => route.fulfill({ json: { quotes: symbols } }));
    await page.route("**/api/portfolio-brief", route => route.fulfill({ json: { malformed: true } }));
    await page.route("**/api/portfolio/risk-history", async route => {
      const book = await readBook(page);
      await route.fulfill({ json: { bookKey: book.bookKey, history: null } });
    });
    await page.route("**/api/portfolio", async route => {
      if (route.request().method() !== "GET") return route.continue();
      const book = await readBook(page);
      const artifacts = Object.fromEntries(book.positions.map(position => [position.ticker, {
        kind: "read" as const,
        facts: { ticker: position.ticker, sector: "Information Technology", marketCap: 1e12, thinlyTraded: false },
      }]));
      const risk = computePortfolioRisk(book.positions, artifacts, false);
      expect(risk.counts).toEqual({ total: 1, sized: 1, read: 1 });
      expect(risk.totalCost).toBeNull();
      await route.fulfill({ json: { ...book, risk } });
    });

    const create = await page.request.post("/api/portfolio", {
      data: { action: "create", ticker: "ZZTA", shares: 2, entryPrice: 100 },
    });
    expect(create.ok()).toBe(true);
    expect((await create.json()).position.entryCurrency).toBeNull();

    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/portfolio");
    await expect(page.locator("[data-portfolio]")).toHaveAttribute("data-position-count", "1");
    await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
    await expect(page.locator("[data-portfolio]")).toHaveCSS(
      "background-color", theme === "light" ? "rgb(247, 248, 250)" : "rgb(10, 11, 14)",
    );
    await page.locator("#portfolio-tab-risk").click();
    const shape = page.getByTestId("portfolio-shape");
    await expect(shape).toHaveAttribute("data-shape-read", "1");
    const reason = lang === "zh"
      ? "未记录入场币种，成本权重不可用"
      : "entry currency is not recorded; cost weights are unavailable";
    const cards = shape.locator("[data-card]");
    await expect(cards).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(cards.nth(i)).toContainText(reason);
    // The existing liquidity-unavailable explanation lives under About exposure.
    const about = shape.locator("details").first();
    await about.locator("summary").click();
    await expect(about).toContainText(reason);
    await expect(shape.getByTestId("shape-coverage")).toContainText(lang === "zh" ? "1 只证券中 1 只" : "1 of 1 securities");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);

    if (process.env.TERMINAL_CROPS) {
      const out = join(process.cwd(), "docs", "verification", "portfolio-risk-reasons-20261022", "crops");
      mkdirSync(out, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await shape.screenshot({ path: join(out, `${info.project.name}-${lang}-${theme}.png`), animations: "disabled" });
    }
  });
}
