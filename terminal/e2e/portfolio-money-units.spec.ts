import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";

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
    await page.goto("/portfolio");
    const row = (ticker: string) => page.getByTestId("portfolio-open").locator(`tr[data-ticker='${ticker}']`);
    await expect(row("AAA")).toContainText("USD");
    await expect(row("BBB")).toContainText(zh ? "未记录币种" : "Currency not recorded");
    await expect(page.getByTestId("portfolio-currency-coverage")).toBeVisible();
    await expect(page.locator("[data-portfolio='w5-positions'] .kpis .kpi").first().locator("b")).toHaveText("—");

    await row("BBB").getByRole("button", { name: /Edit|编辑/ }).click();
    const modal = page.getByRole("dialog");
    const field = modal.getByLabel(zh ? "入场价格币种" : "Currency of entry price");
    await expect(field).toHaveValue("");
    await field.fill("HKD");
    await modal.getByRole("button", { name: /Save position|保存持仓/ }).click();
    await expect(modal).toHaveCount(0);
    let read = await page.request.get("/api/portfolio");
    expect((await read.json()).positions.find((p: { id: string }) => p.id === b.id).entryCurrency).toBe("HKD");
    await page.reload();
    await expect(row("BBB")).not.toContainText(zh ? "未记录币种" : "Currency not recorded");
    await expect(page.locator("[data-portfolio='w5-positions'] .kpis .kpi").first().locator("b")).toHaveText("—");

    // An older writer sends no currency receipt. The real route must clear a
    // price-changing unit, and changing that price back cannot restore it.
    for (const entryPrice of [200, 100]) {
      const update = await page.request.post("/api/portfolio", { data: { action: "update", id: b.id, entryPrice } });
      expect(update.ok()).toBe(true);
      expect((await update.json()).position.entryCurrency).toBeNull();
    }
    read = await page.request.get("/api/portfolio");
    expect((await read.json()).positions.find((p: { id: string }) => p.id === b.id).entryCurrency).toBeNull();
    await page.reload();
    await expect(row("BBB")).toContainText(zh ? "未记录币种" : "Currency not recorded");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow).toBe(false);
  });
}
