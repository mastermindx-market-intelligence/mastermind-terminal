import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { holdings, editRecord, closeInspector, coverage } from "./portfolioWorkspaceHelpers";

test.setTimeout(120_000);
for (const zh of [false, true]) {
  test(`native money units round-trip without guessing legacy currency ${zh ? "ZH" : "EN"}`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await page.addInitScript(useZh => localStorage.setItem("mm.lang", useZh ? "zh" : "en"), zh);
    await page.route("**/data/manifest.json", route => route.fulfill({ json: { symbols: {
      AAA: { name: "Currency control A", last: 100, currency: "USD" }, BBB: { name: "Currency control B", last: 100, currency: "HKD" },
    } } }));
    await page.route("**/api/quote**", route => route.fulfill({ json: { quotes: {
      AAA: { last: 110, chg: 10, currency: "USD" }, BBB: { last: 110, chg: 10, currency: "HKD" },
    } } }));
    await page.route("**/api/portfolio-brief", route => route.fulfill({ status: 403, json: { tier: "free" } }));
    const create = async (ticker: string, entryCurrency?: string) => {
      const response = await page.request.post("/api/portfolio", { data: { action: "create", ticker, shares: 1, entryPrice: 100, ...(entryCurrency === undefined ? {} : { entryCurrency }) } });
      expect(response.ok()).toBe(true);
      return (await response.json()).position as { id: string; entryCurrency: string | null };
    };
    const a = await create("AAA", "USD"), b = await create("BBB");
    expect(a.entryCurrency).toBe("USD"); expect(b.entryCurrency).toBeNull();
    await page.goto("/portfolio"); await holdings(page);
    const row = (ticker: string) => page.getByTestId("portfolio-open").locator(`tr[data-ticker='${ticker}']`);
    await expect(row("AAA")).toContainText("USD");
    await expect(row("BBB")).toContainText(zh ? "未记录币种" : "Currency not recorded");
    await coverage(page);
    await expect(page.getByTestId("portfolio-currency-coverage")).toBeVisible();
    await expect(page.getByTestId("portfolio-market-value").locator("strong")).toHaveText("—");

    const modal = await editRecord(page, "BBB");
    const field = modal.getByLabel(zh ? "入场价格币种" : "Currency of entry price");
    await expect(field).toHaveValue("");
    await field.fill("HKD");
    await modal.getByRole("button", { name: /Save position|保存持仓/ }).click();
    await expect(modal).not.toBeVisible(); await closeInspector(page);
    let read = await page.request.get("/api/portfolio");
    expect((await read.json()).positions.find((p: { id: string }) => p.id === b.id).entryCurrency).toBe("HKD");
    await page.reload(); await holdings(page);
    await expect(row("BBB")).not.toContainText(zh ? "未记录币种" : "Currency not recorded");
    await expect(page.getByTestId("portfolio-market-value").locator("strong")).toHaveText("—");

    // An older writer sends no currency receipt. The real route must clear a
    // price-changing unit, and changing that price back cannot restore it.
    for (const entryPrice of [200, 100]) {
      const update = await page.request.post("/api/portfolio", { data: { action: "update", id: b.id, entryPrice } });
      expect(update.ok()).toBe(true);
      expect((await update.json()).position.entryCurrency).toBeNull();
    }
    read = await page.request.get("/api/portfolio");
    expect((await read.json()).positions.find((p: { id: string }) => p.id === b.id).entryCurrency).toBeNull();
    await page.reload(); await holdings(page);
    await expect(row("BBB")).toContainText(zh ? "未记录币种" : "Currency not recorded");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow).toBe(false);
  });

  test(`per-record money is independent of percentage and quote-unit gaps ${zh ? "ZH" : "EN"}`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await page.addInitScript(useZh => localStorage.setItem("mm.lang", useZh ? "zh" : "en"), zh);
    const quotes = {
      ZERO: { last: 120, currency: "USD" }, FLAT: { last: 120, currency: "USD" },
      SHORT: { last: 50, currency: "USD" }, UNSIZED: { last: 120, currency: "USD" },
      UNKNOWN: { last: 120, currency: "USD" }, MIXED: { last: 120, currency: "USD" },
      NOUNIT: { last: 120 },
    };
    // The fallback has a unit even for NOUNIT. It must not repair the selected quote's unit.
    const symbols = Object.fromEntries(Object.entries(quotes).map(([ticker, quote]) =>
      [ticker, { name: ticker, last: quote.last, currency: "USD" }]));
    await page.route("**/data/manifest.json", route => route.fulfill({ json: { symbols } }));
    await page.route("**/api/quote**", route => route.fulfill({ json: { quotes } }));
    await page.route("**/api/portfolio-brief", route => route.fulfill({ status: 403, json: { tier: "free" } }));
    const cases = [
      { ticker: "ZERO", shares: 10, entryPrice: 0, entryCurrency: "USD", pct: "—", money: "USD +1,200.00" },
      { ticker: "FLAT", shares: 10, entryPrice: 120, entryCurrency: "USD", pct: "+0.00%", money: "USD +0.00" },
      { ticker: "SHORT", shares: -2, entryPrice: 100, entryCurrency: "USD", pct: "-50.00%", money: "USD +100.00" },
      { ticker: "UNSIZED", shares: null, entryPrice: 100, entryCurrency: "USD", pct: "+20.00%", money: null },
      { ticker: "UNKNOWN", shares: 10, entryPrice: 100, entryCurrency: null, pct: "—", money: null },
      { ticker: "MIXED", shares: 10, entryPrice: 100, entryCurrency: "HKD", pct: "—", money: null },
      { ticker: "NOUNIT", shares: 10, entryPrice: 100, entryCurrency: "USD", pct: "—", money: null },
    ];
    for (const { ticker, shares, entryPrice, entryCurrency } of cases) {
      const response = await page.request.post("/api/portfolio", {
        data: { action: "create", ticker, shares, entryPrice, entryCurrency },
      });
      expect(response.ok()).toBe(true);
    }
    await page.goto("/portfolio"); await holdings(page);
    const cell = (ticker: string) => page.getByTestId("portfolio-open")
      .locator(`tr[data-ticker='${ticker}']`).locator("td").nth(5);
    for (const expected of cases) {
      await expect(cell(expected.ticker).locator("span")).toHaveText(expected.pct);
      if (expected.money === null) await expect(cell(expected.ticker).locator("small")).toHaveCount(0);
      else await expect(cell(expected.ticker).locator("small")).toHaveText(expected.money);
    }
    const positive = await cell("ZERO").locator("small").evaluate(node => getComputedStyle(node).color);
    const shortMoney = await cell("SHORT").locator("small").evaluate(node => getComputedStyle(node).color);
    const shortPrice = await cell("SHORT").locator("span").evaluate(node => getComputedStyle(node).color);
    expect(shortMoney).toBe(positive);
    expect(shortPrice).not.toBe(shortMoney);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
}
